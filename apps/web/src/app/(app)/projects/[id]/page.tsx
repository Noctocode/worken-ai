"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Send,
  Paperclip,
  ImageIcon,
  Sparkles,
  Bot,
  Loader2,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProject,
  fetchConversation,
  createConversation,
  streamChatMessage,
  type ConversationMessage,
} from "@/lib/api";
import { ChatHistorySidebar } from "@/components/chat-history-sidebar";
import { useAuth } from "@/components/providers";
import { humanizeChatError } from "@/lib/chat-errors";

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** OpenRouter / Anthropic "thinking" text the model produced before
   *  the visible answer. Accumulated from `reasoning` SSE events
   *  during the stream, and hydrated from metadata.reasoning_details
   *  on conversation reload. Non-empty → renders a collapsible
   *  "Show thinking" disclosure under the bubble. */
  reasoning?: string;
  /** True when the user pressed Stop mid-stream and the BE persisted
   *  whatever was buffered. Drives the "Stopped" badge so the
   *  conversation history reflects that the response was cut short. */
  partial?: boolean;
  userId?: string | null;
  userName?: string | null;
  userPicture?: string | null;
}

function getTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getInitials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function ProjectChatPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: project,
    isLoading: isLoadingProject,
    error,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Holds the AbortController for the in-flight stream so the Stop
  // button can cancel mid-token. Null when no stream is active.
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation messages when activeConversationId changes
  const { data: conversationData, isLoading: isLoadingConversation } = useQuery(
    {
      queryKey: ["conversation", activeConversationId],
      queryFn: () => fetchConversation(activeConversationId!),
      enabled: !!activeConversationId,
    },
  );

  // Sync fetched messages to local state
  useEffect(() => {
    if (conversationData?.messages) {
      setMessages(
        conversationData.messages.map((m: ConversationMessage) => {
          // Pull both reasoning_details and the partial flag out of
          // the jsonb metadata blob in one go. Both are optional and
          // typed as `unknown` on the wire, so narrow defensively.
          const meta =
            m.metadata && typeof m.metadata === "object"
              ? (m.metadata as Record<string, unknown>)
              : null;
          return {
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            timestamp: new Date(m.createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            }),
            reasoning:
              // BE persists thinking text under metadata.reasoning_details
              // as a plain string (the stream accumulator stringifies
              // every `reasoning` SSE delta into one buffer). Defensive
              // narrowing covers legacy non-stream rows that may have
              // stored a structured object instead.
              typeof meta?.reasoning_details === "string"
                ? (meta.reasoning_details as string)
                : undefined,
            partial: meta?.partial === true,
            userId: m.userId,
            userName: m.userName,
            userPicture: m.userPicture,
          };
        }),
      );
    }
  }, [conversationData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSending || !project) return;

    const content = message.trim();
    setMessage("");
    setIsSending(true);

    // Optimistic user message
    const optimisticMsg: LocalMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      timestamp: getTimestamp(),
      userId: user?.id,
      userName: user?.name,
      userPicture: user?.picture,
    };
    // Placeholder assistant bubble — gets filled token-by-token as
    // SSE deltas arrive. Holding a stable id so we can update only
    // this row on every event without re-rendering the whole list.
    const assistantId = `resp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      optimisticMsg,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: getTimestamp(),
      },
    ]);

    // AbortController exposed via abortRef so the Stop button (and
    // any future Esc-key binding) can cancel the in-flight stream.
    // BE listens on req.close → propagates abort to the upstream
    // LLM SDK, persists what we got, returns a final `done` event
    // with partial:true.
    const controller = new AbortController();
    abortRef.current = controller;
    let buffer = "";
    // Accumulator for `reasoning` SSE events. Updated alongside
    // `buffer` and pushed into the assistant message on every delta
    // so the disclosure pane fills in real-time even before the
    // visible answer starts.
    let reasoningBuffer = "";
    let stoppedByUser = false;
    // Track whether we got any signal from the stream at all so we
    // can show a clear "no response" message if the BE closes the
    // connection without ever yielding an event (e.g. proxy
    // misconfiguration, hot-reload race where the route disappeared
    // mid-flight). Without this, the bubble would just be empty and
    // the Stop button would vanish silently — confusing UX.
    let receivedAnyEvent = false;

    try {
      // Create conversation if this is a new chat
      let convId = activeConversationId;
      if (!convId) {
        const newConvo = await createConversation(projectId);
        convId = newConvo.id;
        setActiveConversationId(convId);
      }

      for await (const event of streamChatMessage(
        convId,
        content,
        project.model,
        projectId,
        controller.signal,
      )) {
        receivedAnyEvent = true;
        if (event.type === "delta") {
          buffer += event.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: buffer } : m,
            ),
          );
        } else if (event.type === "replace") {
          // Final guardrail fix-rule fired — overwrite the bubble
          // with the redacted text. Discard our local buffer so
          // future state stays in sync if (somehow) more deltas
          // arrive after this; BE doesn't emit further deltas
          // after replace today, but the guard is cheap.
          buffer = event.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: buffer } : m,
            ),
          );
        } else if (event.type === "reasoning") {
          // "Thinking" text — surfaces in the disclosure pane below
          // the bubble. Append to the local buffer and reflect on
          // the message in one setMessages call so we don't
          // re-render on every token from two separate state slots.
          reasoningBuffer += event.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, reasoning: reasoningBuffer }
                : m,
            ),
          );
        } else if (event.type === "blocked") {
          // Output guardrail BLOCK fired. Swap the in-progress
          // bubble for a humanised error message — same shape the
          // non-stream path used to throw, so chat-errors humanizer
          // routes both consistently.
          const blockedMessage = humanizeChatError(
            new Error(
              `GUARDRAIL_BLOCKED: "${event.rule}" blocked the model's response (${event.validator}).`,
            ),
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: blockedMessage }
                : m,
            ),
          );
        } else if (event.type === "error") {
          const errMessage = humanizeChatError(
            new Error(
              event.status
                ? `${event.status}: ${event.message}`
                : event.message,
            ),
          );
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: errMessage } : m,
            ),
          );
        } else if (event.type === "done") {
          // Stream concluded. BE has already persisted the
          // assistant message (possibly with partial:true if the
          // user clicked Stop). Mark the local row partial so the
          // "Stopped" badge shows immediately, without waiting for
          // a sidebar refetch round-trip. Sidebar refresh below
          // surfaces the new conversation / latest-message timestamp.
          if (event.partial) {
            stoppedByUser = true;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, partial: true } : m,
              ),
            );
          }
          queryClient.invalidateQueries({
            queryKey: ["conversations", projectId],
          });
        }
      }

      // Stream closed cleanly but we never saw a usable event AND
      // never streamed any content. The bubble would otherwise sit
      // empty forever — give the user a concrete error to act on.
      if (!receivedAnyEvent && buffer === "") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "No response from the AI gateway. The streaming endpoint may not be available — try refreshing the page, and if the problem persists, restart the API server.",
                }
              : m,
          ),
        );
      }
    } catch (err) {
      // Two failure modes:
      //   - AbortError → user pressed Stop; the BE keeps what it
      //     had and persists with partial:true. Leave the bubble
      //     as-is rather than overwriting with an error.
      //   - Anything else → pre-flight 4xx (guardrail input,
      //     budget gate, …) or network failure. Replace the
      //     placeholder bubble with the humanised message.
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: humanizeChatError(err) }
              : m,
          ),
        );
      } else {
        stoppedByUser = true;
        // FE-initiated abort. BE persists with partial=true on
        // req.close but the SSE `done` event may not reach us
        // (stream got torn down) — mark the local message partial
        // here so the badge shows without a sidebar reload.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, partial: true } : m,
          ),
        );
        // Refresh the sidebar so the new conversation + latest
        // timestamp show up despite the abort short-circuiting the
        // `done` branch above.
        queryClient.invalidateQueries({
          queryKey: ["conversations", projectId],
        });
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
      // No-op assignment to satisfy "unused" lint while preserving
      // the explicit state for future telemetry. The partial-flag
      // metadata is already persisted on the BE side.
      void stoppedByUser;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const sidebarProps = {
    projectId,
    activeConversationId,
    onSelectConversation: handleSelectConversation,
    onNewChat: handleNewChat,
  };

  if (isLoadingProject) {
    return (
      <div className="flex min-h-0 flex-1">
        <ChatHistorySidebar {...sidebarProps} />
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-text-3" />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1">
        <ChatHistorySidebar {...sidebarProps} />
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-text-2">Failed to load project</p>
            <Link href="/">
              <Button variant="link" className="mt-2">
                Go back
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <ChatHistorySidebar {...sidebarProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Project Header */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-2 bg-bg-white/60 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-2 hover:text-text-1"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="h-4 w-px bg-border-2" />
            <h1 className="text-sm font-semibold text-text-1">
              {project.name}
            </h1>
          </div>
          <Badge
            variant="secondary"
            className="gap-1 border border-border-2 bg-bg-1 text-xs font-medium text-text-2"
          >
            <Sparkles className="h-3 w-3" />
            {project.model}
          </Badge>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            <div className="space-y-6">
              {/* Empty state */}
              {messages.length === 0 && !isLoadingConversation && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Bot className="h-12 w-12 text-text-3" />
                  <h3 className="mt-4 text-sm font-medium text-text-1">
                    Start a conversation
                  </h3>
                  <p className="mt-1 text-xs text-text-3">
                    Send a message to begin chatting with your AI assistant.
                  </p>
                </div>
              )}

              {isLoadingConversation && (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-text-3" />
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${
                    msg.role === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  {/* Avatar */}
                  {msg.role === "assistant" ? (
                    <Avatar className="h-8 w-8 shrink-0 border border-border-2">
                      <AvatarFallback className="bg-bg-2 text-text-2">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Avatar className="h-8 w-8 shrink-0 border border-blue-100">
                      {msg.userPicture ? (
                        <AvatarImage
                          src={msg.userPicture}
                          alt={msg.userName || ""}
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary-1 text-xs font-medium text-primary-6">
                        {getInitials(msg.userName || user?.name)}
                      </AvatarFallback>
                    </Avatar>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    {/* Show sender name for team conversations */}
                    {msg.role === "user" &&
                      project.teamId &&
                      msg.userName &&
                      msg.userId !== user?.id && (
                        <span className="mb-1 block text-[11px] font-medium text-text-2">
                          {msg.userName}
                        </span>
                      )}
                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "assistant"
                          ? "rounded-tl-sm border border-border-2 bg-bg-white text-text-1 shadow-sm"
                          : "rounded-tr-sm bg-primary-6 text-white"
                      }`}
                    >
                      {/* While the stream hasn't produced any text
                          yet (empty assistant bubble + isSending),
                          show an inline "Thinking…" so the user
                          gets immediate feedback that the request
                          is in flight. Once the first delta arrives
                          we render the streamed content instead. */}
                      {msg.role === "assistant" &&
                      msg.content === "" &&
                      isSending ? (
                        <span className="flex items-center gap-2 text-text-3">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Thinking...
                        </span>
                      ) : (
                        // Markdown rendering for both user + assistant
                        // bubbles. GFM plugin adds tables, strike-
                        // through, task lists, autolinks — handy when
                        // a user pastes formatted text or the model
                        // emits a structured response. Each element
                        // is styled inline so the bubble theme (user
                        // = primary-6 background, assistant = white)
                        // stays consistent with the surrounding chat
                        // chrome instead of inheriting prose defaults.
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => (
                              <p className="mb-2 last:mb-0 whitespace-pre-wrap">
                                {children}
                              </p>
                            ),
                            ul: ({ children }) => (
                              <ul className="mb-2 list-disc pl-5 last:mb-0">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="mb-2 list-decimal pl-5 last:mb-0">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => (
                              <li className="mb-1 last:mb-0">{children}</li>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote
                                className={`mb-2 border-l-2 pl-3 italic last:mb-0 ${
                                  msg.role === "user"
                                    ? "border-white/40 text-white/90"
                                    : "border-border-3 text-text-2"
                                }`}
                              >
                                {children}
                              </blockquote>
                            ),
                            code: ({ children, className }) => {
                              // react-markdown emits `code` for both
                              // inline (no class) and fenced blocks
                              // (className=language-xxx). Distinguish
                              // by className presence so we get pill-
                              // style inline vs full code block.
                              const isInline = !className;
                              return isInline ? (
                                <code
                                  className={`rounded px-1 py-0.5 font-mono text-[12px] ${
                                    msg.role === "user"
                                      ? "bg-white/15"
                                      : "bg-bg-1"
                                  }`}
                                >
                                  {children}
                                </code>
                              ) : (
                                <code className="font-mono text-[12px]">
                                  {children}
                                </code>
                              );
                            },
                            pre: ({ children }) => (
                              <pre
                                className={`mb-2 overflow-x-auto rounded-lg p-3 text-[12px] last:mb-0 ${
                                  msg.role === "user"
                                    ? "bg-white/10"
                                    : "bg-bg-1"
                                }`}
                              >
                                {children}
                              </pre>
                            ),
                            a: ({ children, href }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`underline ${
                                  msg.role === "user"
                                    ? "text-white"
                                    : "text-primary-6"
                                }`}
                              >
                                {children}
                              </a>
                            ),
                            h1: ({ children }) => (
                              <h1 className="mb-2 text-base font-bold last:mb-0">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="mb-2 text-base font-bold last:mb-0">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="mb-2 text-sm font-bold last:mb-0">
                                {children}
                              </h3>
                            ),
                            hr: () => (
                              <hr
                                className={`my-2 border-t ${
                                  msg.role === "user"
                                    ? "border-white/30"
                                    : "border-border-2"
                                }`}
                              />
                            ),
                            table: ({ children }) => (
                              <div className="mb-2 overflow-x-auto last:mb-0">
                                <table className="w-full border-collapse text-[12px]">
                                  {children}
                                </table>
                              </div>
                            ),
                            th: ({ children }) => (
                              <th
                                className={`border px-2 py-1 text-left font-semibold ${
                                  msg.role === "user"
                                    ? "border-white/30"
                                    : "border-border-2"
                                }`}
                              >
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td
                                className={`border px-2 py-1 ${
                                  msg.role === "user"
                                    ? "border-white/30"
                                    : "border-border-2"
                                }`}
                              >
                                {children}
                              </td>
                            ),
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      )}
                    </div>
                    {/* Collapsible reasoning pane. Renders only on
                        assistant bubbles that have thinking text
                        (either streamed during the current session
                        or hydrated from metadata.reasoning_details
                        on conversation reload). Native <details>
                        gives us a free disclosure widget without
                        extra useState — open state lives in the
                        DOM, persists across re-renders, and is
                        keyboard-accessible by default. */}
                    {msg.role === "assistant" && msg.reasoning ? (
                      <details className="mt-2 rounded-md border border-border-2 bg-bg-1/40 text-[12px]">
                        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 font-medium text-text-2 hover:text-text-1">
                          <Sparkles className="h-3.5 w-3.5 text-primary-6" />
                          Show thinking
                        </summary>
                        <div className="border-t border-border-2 px-3 py-2 text-text-3 whitespace-pre-wrap italic">
                          {msg.reasoning}
                        </div>
                      </details>
                    ) : null}
                    <span
                      className={`mt-1 block text-[11px] text-text-3 ${
                        msg.role === "user" ? "text-right" : "text-left"
                      }`}
                    >
                      {msg.timestamp}
                      {msg.partial && (
                        // Subtle "Stopped" pill next to the
                        // timestamp on cancelled assistant
                        // responses. Sits inline with timestamp so
                        // it reads as metadata rather than as part
                        // of the message body.
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7">
                          <Square
                            className="h-2.5 w-2.5"
                            fill="currentColor"
                            strokeWidth={0}
                          />
                          Stopped
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}

              {/* Per-bubble "Thinking…" lives inside the empty
                  assistant message bubble itself — see the bubble
                  render block above. Keeps the spinner in line with
                  the rest of the message thread instead of floating
                  below as a separate row. */}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Input Area */}
        <div className="shrink-0 border-t border-border-2 bg-bg-white/60 backdrop-blur-md">
          <form
            onSubmit={handleSubmit}
            className="mx-auto max-w-3xl px-4 py-3 sm:px-6"
          >
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  rows={1}
                  disabled={isSending}
                  className="w-full resize-none rounded-xl border border-border-2 bg-bg-white/80 px-4 py-3 pr-12 text-sm text-text-1 placeholder:text-text-3 focus:border-primary-5 focus:bg-bg-white focus:outline-none focus:ring-2 focus:ring-primary-5/10 disabled:opacity-50"
                  style={{ minHeight: "44px", maxHeight: "120px" }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height =
                      Math.min(target.scrollHeight, 120) + "px";
                  }}
                />
              </div>
              {/* While streaming we swap the Send affordance for a
                  Stop button so the user can interrupt mid-token.
                  abortRef.current.abort() → fetch reader cancels →
                  BE persists what was buffered with partial:true. */}
              {isSending ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="h-11 w-11 shrink-0 rounded-xl"
                  onClick={handleStop}
                  title="Stop generating"
                >
                  <Square className="h-4 w-4" fill="currentColor" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl bg-primary-6 hover:bg-primary-7"
                  disabled={!message.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-text-3 hover:text-text-1"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-text-3 hover:text-text-1"
                >
                  <ImageIcon className="h-4 w-4" />
                </Button>
              </div>
              <span className="text-[11px] text-text-3">
                Shift + Enter for new line
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
