"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  Sparkles,
  Bot,
  Check,
  Download,
  EllipsisVertical,
  FileText,
  Globe,
  Loader2,
  PanelLeft,
  PanelRight,
  Plus,
  Square,
  UserPlus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchIntegrations,
  fetchProject,
  fetchConversation,
  createConversation,
  parseCitations,
  streamChatMessage,
  submitMessageFeedback,
  updateProject,
  uploadProjectKnowledgeFiles,
  downloadKnowledgeFile,
  type AlternativeModelSuggestion,
  type ChatAttachment,
  type ConversationMessage,
  type WebCitation,
} from "@/lib/api";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { ChatHistorySidebar } from "@/components/chat-history-sidebar";
import { ProjectDetailsPanel } from "@/components/project-chat/project-details-panel";
import { ChatEmptyState } from "@/components/project-chat/chat-empty-state";
import { ChatComposer } from "@/components/project-chat/chat-composer";
import { MessageActions } from "@/components/project-chat/message-actions";
import { ModelSuggestionBubble } from "@/components/project-chat/model-suggestion-bubble";
import { InviteMembersDialog } from "@/components/project-chat/invite-members-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/components/providers";
import { useConversationLiveSync } from "@/components/realtime-provider";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { AGENTS } from "@/lib/agents";
import { humanizeChatError } from "@/lib/chat-errors";
import { useLanguage } from "@/lib/i18n";

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
  /** True when this bubble holds a client-only error message — i.e.
   *  the request never reached the BE assistant-write step. The
   *  sync-from-BE effect preserves trailing error bubbles so they
   *  don't flash for a single frame and vanish on the post-error
   *  conversation refetch. */
  isError?: boolean;
  /** Optional follow-up nudge the BE attached to this assistant turn
   *  via the SSE `done` event. Renders a "Try X instead" bubble below
   *  the message until the user clicks Try It or dismisses it.
   *  Stripped from any message the user dismisses so re-renders don't
   *  resurrect the bubble. Not persisted across reloads. */
  alternativeModel?: AlternativeModelSuggestion;
  /** Web-search sources OpenRouter attached to this answer. Streamed via
   *  the `citations` SSE event and hydrated from metadata.citations on
   *  reload; renders a "Sources" list under the bubble. */
  citations?: WebCitation[];
  /** Set only when a configured fallback model answered in place of the
   *  requested one (the requested model was dead/unavailable). Streamed via
   *  the `done` event and hydrated from metadata.model on reload; renders an
   *  "answered by …" note so the substitution is visible. */
  usedModel?: string;
  userId?: string | null;
  userName?: string | null;
  userPicture?: string | null;
  /** KC files attached to this (user) message — rendered as
   *  downloadable chips. Hydrated from metadata.attachments on reload. */
  attachments?: ChatAttachment[];
  /** Skills the router auto-applied to this answer. Hydrated from
   *  metadata.skills; renders a "Skill applied" chip so the user
   *  understands why the response follows a particular format. */
  skills?: { id: string; name: string }[];
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
  const { t } = useLanguage();
  const params = useParams();
  const projectId = params.id as string;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // Model data for the phone overflow menu's model picker — mirrors the
  // appbar: the project's agent pool, labelled + switched the same way.
  const { effective: effectiveModels, getLabel: getModelLabel } =
    useUserModels();
  const { models: availableModels } = useAvailableModels();

  const {
    data: project,
    isLoading: isLoadingProject,
    error,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  // BYOK fallback signal: the caller has at least one personal
  // integration with a key set but flipped off in the Integration
  // tab, AND the project's current model maps to that provider —
  // meaning chat-transport is going to fall through to the WorkenAI
  // default route instead of the user's own key. Surfaces as an
  // inline banner above the chat so the user knows why their
  // tokens (and not their own provider key) are getting billed.
  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
    staleTime: 60 * 1000,
  });
  const projectProvider = project?.model
    ? project.model.includes("/")
      ? project.model.slice(0, project.model.indexOf("/"))
      : null
    : null;
  const pausedByokIntegration =
    projectProvider && project
      ? integrations.find(
          (i) =>
            i.providerId === projectProvider &&
            i.hasApiKey &&
            !i.isEnabled,
        ) ?? null
      : null;

  const updateModelMutation = useMutation({
    mutationFn: (model: string) => updateProject(projectId, { model }),
    onSuccess: (updated) => {
      // Refetch so the cached project (and `project.model` used by
      // streamChatMessage on the next send) reflects the switch
      // before the user types again.
      queryClient.setQueryData(["project", projectId], updated);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("projDetail.failedChangeModel"),
      );
    },
  });

  // Label a pool entry (agent preset → its name; configured-model id →
  // its alias name / catalog label). Mirrors the appbar.
  const labelForModel = (id: string): string => {
    const alias = effectiveModels.find((m) => m.id === id);
    return alias ? alias.name : getModelLabel(id);
  };
  // Resolve a pool entry to a concrete model slug for persistence.
  const resolveSelectionModel = (id: string): string => {
    const preset = AGENTS.find((a) => a.id === id);
    if (!preset) return id;
    const inCatalog = availableModels.find((m) => m.id === preset.model);
    return (
      inCatalog?.id ??
      availableModels[0]?.id ??
      project?.model ??
      preset.model
    );
  };
  // Switch the project's active agent/model — same contract as the
  // appbar header dropdown (persists agent + resolved model).
  const switchAgentMutation = useMutation({
    mutationFn: (id: string) =>
      updateProject(projectId, { agent: id, model: resolveSelectionModel(id) }),
    onSuccess: (updated, id) => {
      queryClient.setQueryData(["project", projectId], updated);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      const preset = AGENTS.find((a) => a.id === id);
      toast.success(
        `${t("projDetail.switchedTo1")} ${preset?.label ?? labelForModel(id)} ${t("projDetail.switchedTo2")}`,
      );
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("projDetail.failedChangeModel"),
      ),
  });

  // Per-project web search toggle — mirrors the appbar's, surfaced in the
  // phone overflow menu where the appbar is hidden.
  const webSearchMutation = useMutation({
    mutationFn: (next: boolean) => updateProject(projectId, { webSearch: next }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["project", projectId], updated);
      toast.success(
        updated.webSearch ? t("appbar.webSearchOn") : t("appbar.webSearchOff"),
      );
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("appbar.webSearchFailed"),
      ),
  });

  // Right-hand "Project Details" panel (Figma 238:17561). Open by
  // default on wide screens; the panel renders a thin collapsed rail
  // when closed.
  const [detailsOpen, setDetailsOpen] = useState(true);
  // <xl / <lg slide-over drawers (Project Details / conversation history)
  // for tablet + mobile, where the inline panels are hidden.
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  // Scope for the NEXT new chat (created lazily on first send). Only
  // meaningful for team projects; personal projects always create
  // personal chats (the BE coerces it regardless).
  const [newChatScope, setNewChatScope] = useState<"personal" | "team">(
    "personal",
  );
  // Files attached to the next message — already uploaded to KC (so RAG
  // ingests them) and held here until the message is sent.
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [message, setMessage] = useState("");
  // Skills the user pinned via the composer Skills dialog — sent with each
  // message so the router force-includes them this conversation.
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  // Holds the AbortController for the in-flight stream so the Stop
  // button can cancel mid-token. Null when no stream is active.
  const abortRef = useRef<AbortController | null>(null);
  // Wall-clock of the last Stop click. Cooldown guard in
  // handleSubmit — when React tears down Stop and renders Send at
  // the same DOM coordinates mid-click, the browser dispatches the
  // submit on the freshly-rendered Send button. Without this, the
  // form re-submits and starts a fresh stream. 200ms is plenty for
  // the re-render race; intentional follow-up clicks come later.
  const lastStopAtRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch conversation messages when activeConversationId changes.
  //
  // Gated on `!isSending` to prevent a streaming-race: on a fresh
  // chat we `createConversation()` first, then call `streamChatMessage`
  // which is what actually persists the user prompt. If this query
  // fired between those two, BE would respond with 0 messages and the
  // sync effect below would wipe the optimistic + streaming-token
  // state, leaving the user staring at an empty chat. With the gate,
  // the query holds off until the stream ends (`setIsSending(false)`
  // in the finally block) and then refetches the canonical BE view
  // exactly once — swapping the local `temp-…` and `resp-…` ids for
  // the real DB rows.
  const { data: conversationData, isLoading: isLoadingConversation } = useQuery(
    {
      queryKey: ["conversation", activeConversationId],
      queryFn: () => fetchConversation(activeConversationId!),
      enabled: !!activeConversationId && !isSending,
    },
  );

  // Sync fetched messages to local state.
  //
  // Preserves a *trailing* client-only error bubble (`isError: true`)
  // that the BE doesn't know about. Without this, an error message
  // we just wrote into local state (e.g. budget gate 402, guardrail
  // input block, network failure) gets clobbered by the post-error
  // conversation refetch fired from the submit handler's finally
  // block — the bubble appears for a single frame and vanishes. The
  // length check makes sure we only re-attach the error when the BE
  // genuinely has fewer messages (i.e. the assistant write never
  // landed). On a successful retry the BE catches up, lengths align,
  // and the stale error gets dropped naturally.
  useEffect(() => {
    if (!conversationData?.messages) return;
    const beMessages = conversationData.messages.map(
      (m: ConversationMessage): LocalMessage => {
        const meta =
          m.metadata && typeof m.metadata === "object"
            ? (m.metadata as Record<string, unknown>)
            : null;
        // Validate persisted citations rather than trusting the stored
        // shape — a bad url/title (or a non-http link) must not reach the
        // Sources UI. parseCitations drops anything unsafe.
        const citations = parseCitations(meta?.citations);
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: new Date(m.createdAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          }),
          reasoning:
            typeof meta?.reasoning_details === "string"
              ? (meta.reasoning_details as string)
              : undefined,
          citations: citations.length > 0 ? citations : undefined,
          // A fallback answered only when the persisted model differs from the
          // requested one (BE stores `requestedModel` alongside `model`).
          usedModel:
            typeof meta?.model === "string" &&
            typeof meta?.requestedModel === "string" &&
            meta.model !== meta.requestedModel
              ? meta.model
              : undefined,
          partial: meta?.partial === true,
          attachments: Array.isArray(meta?.attachments)
            ? (meta.attachments as ChatAttachment[]).filter(
                (a) => a && typeof a.fileId === "string",
              )
            : undefined,
          skills: Array.isArray(meta?.skills)
            ? (meta.skills as { id: string; name: string }[]).filter(
                (s) => s && typeof s.name === "string",
              )
            : undefined,
          userId: m.userId,
          userName: m.userName,
          userPicture: m.userPicture,
        };
      },
    );
    setMessages((prev) => {
      const trailing = prev[prev.length - 1];
      if (
        trailing?.isError &&
        beMessages.length < prev.length
      ) {
        return [...beMessages, trailing];
      }
      return beMessages;
    });
  }, [conversationData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // Company profiles tag chat uploads with 'project' visibility;
  // personal profiles omit it (owner-only by scope) and rely on the
  // project link — same rule as the project Knowledge dialog.
  const isPersonal = useIsPersonal();

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setNewChatScope("personal");
    setPendingAttachments([]);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setPendingAttachments([]);
  }, []);

  // Upload picked files into the project's Knowledge Core (so RAG can
  // use them) and hold them as pending attachments for the next message.
  const handleAddFiles = useCallback(
    async (files: FileList) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setAttachmentUploading(true);
      try {
        const result = await uploadProjectKnowledgeFiles(projectId, list, {
          ...(isPersonal ? {} : { visibility: "project" as const }),
          projectIds: [projectId],
        });
        // Both freshly-uploaded and already-in-KC (duplicate) files are
        // valid attachments — collect their ids/names.
        const added: ChatAttachment[] = [
          ...result.uploaded.map((u) => ({ fileId: u.id, name: u.name })),
          ...result.duplicates
            .filter((d) => d.existing.id)
            .map((d) => ({ fileId: d.existing.id as string, name: d.name })),
        ];
        if (added.length > 0) {
          setPendingAttachments((prev) => {
            const seen = new Set(prev.map((a) => a.fileId));
            return [...prev, ...added.filter((a) => !seen.has(a.fileId))];
          });
          // Keep the right-panel "Data Sources" list in sync.
          queryClient.invalidateQueries({
            queryKey: ["project-knowledge-files", projectId],
          });
        }
        if (result.nameConflicts.length > 0) {
          toast.info(t("chatComp.attachConflict"));
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("chatComp.attachFailed"),
        );
      } finally {
        setAttachmentUploading(false);
      }
    },
    [projectId, isPersonal, queryClient, t],
  );

  const handleRemoveAttachment = useCallback((fileId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.fileId !== fileId));
  }, []);

  // Live sync (FA4): when another member posts in the open conversation,
  // pull the canonical view. The conversation query is gated on
  // `!isSending`, so this no-ops mid-stream and refetches once our own
  // send settles — own messages are skipped server-side via senderId.
  const handleRemoteMessage = useCallback(() => {
    if (activeConversationId) {
      queryClient.invalidateQueries({
        queryKey: ["conversation", activeConversationId],
      });
    }
    queryClient.invalidateQueries({ queryKey: ["conversations", projectId] });
  }, [queryClient, activeConversationId, projectId]);
  useConversationLiveSync(activeConversationId, user?.id, handleRemoteMessage);

  const handleStop = () => {
    lastStopAtRef.current = Date.now();
    abortRef.current?.abort();
  };

  /**
   * "Try It" handler for a suggestion bubble — switch the project to
   * the suggested model so the user's next message uses it. We
   * deliberately don't auto-regenerate the assistant turn that
   * triggered the suggestion: the user might want to tweak the
   * prompt, and an automatic re-fire would also burn a second model
   * call without explicit consent.
   *
   * The bubble is cleared from local state so the suggestion doesn't
   * keep nudging after the user has acted on it. The full Figma
   * 168:7221 side-by-side compare panel ("Continue with this model"
   * / "Continue the conversation with both models") is a follow-up.
   */
  const handleTrySuggestedModel = (assistantMessageId: string) => {
    const target = messages.find((m) => m.id === assistantMessageId);
    if (!target?.alternativeModel) return;
    const next = target.alternativeModel;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantMessageId ? { ...m, alternativeModel: undefined } : m,
      ),
    );
    if (!project || project.model === next.id) return;
    updateModelMutation.mutate(next.id, {
      onSuccess: () => {
        toast.success(
          `${t("projDetail.switchedTo1")} ${next.label} ${t("projDetail.switchedTo2")}`,
        );
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow sending a file-only turn (no text) when attachments are
    // present — the model answers about the attached files.
    if (
      (!message.trim() && pendingAttachments.length === 0) ||
      isSending ||
      attachmentUploading ||
      !project
    )
      return;
    // Cooldown after a Stop click — same race as the arena page.
    // React swaps Stop → Send under the cursor while the click is
    // in flight; without this, the just-rendered Send button
    // receives the submit and the form fires a fresh chat call.
    if (Date.now() - lastStopAtRef.current < 200) return;

    const content = message.trim();
    const attachments = pendingAttachments;
    setMessage("");
    setPendingAttachments([]);
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
      ...(attachments.length > 0 ? { attachments } : {}),
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
        // Team projects honor the picked scope; personal projects always
        // get a personal chat (the BE coerces it too).
        const scope = project.teamId ? newChatScope : "personal";
        const newConvo = await createConversation(projectId, scope);
        convId = newConvo.id;
        setActiveConversationId(convId);
      }

      for await (const event of streamChatMessage(
        convId,
        content,
        project.model,
        projectId,
        controller.signal,
        attachments,
        pinnedSkillIds,
      )) {
        // Defensive: BE-side bytes already buffered on the wire
        // surface here even after the user pressed Stop. Bail
        // into the catch with a synthetic AbortError so post-
        // abort tokens don't keep filling the bubble (looks like
        // the model resumed on its own).
        if (controller.signal.aborted) {
          throw new DOMException("Aborted by user", "AbortError");
        }
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
        } else if (event.type === "citations") {
          // Web-search sources — attach to the assistant turn so the
          // "Sources" list renders under the bubble.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, citations: event.citations } : m,
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
                ? { ...m, content: blockedMessage, isError: true }
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
              m.id === assistantId
                ? { ...m, content: errMessage, isError: true }
                : m,
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
          // Attach the BE's optional model suggestion to this turn.
          // Stays in local state only — not persisted across reloads;
          // the user dismissing on a refresh just makes the bubble
          // reappear if the rule still matches.
          if (event.alternativeModel) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, alternativeModel: event.alternativeModel }
                  : m,
              ),
            );
          }
          // Surface the actual model when a fallback answered in place of the
          // requested one, so the substitution is never silent.
          if (
            event.model &&
            event.requestedModel &&
            event.model !== event.requestedModel
          ) {
            const used = event.model;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, usedModel: used } : m,
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
                  content: t("projDetail.noResponse"),
                  isError: true,
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
              ? { ...m, content: humanizeChatError(err), isError: true }
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
      // Force the conversation query to refetch once `isSending` flips
      // back to false. The useQuery is gated on `!isSending`, so its
      // cached data (possibly stale or absent for a fresh chat) would
      // otherwise be used as-is by the sync effect. Invalidating here
      // guarantees the BE canonical view replaces the local
      // optimistic state — `temp-…` and `resp-…` ids get swapped for
      // real DB rows, and any guardrail input redaction the BE
      // applied to the user prompt becomes visible.
      if (activeConversationId) {
        queryClient.invalidateQueries({
          queryKey: ["conversation", activeConversationId],
        });
      }
      // No-op assignment to satisfy "unused" lint while preserving
      // the explicit state for future telemetry. The partial-flag
      // metadata is already persisted on the BE side.
      void stoppedByUser;
    }
  };

  const sidebarProps = {
    projectId,
    activeConversationId,
    onSelectConversation: handleSelectConversation,
    onNewChat: handleNewChat,
    mobileOpen: historyDrawerOpen,
    onMobileOpenChange: setHistoryDrawerOpen,
  };

  if (isLoadingProject) {
    return (
      <div className="-mx-6 flex h-[calc(100vh-3.5rem)] overflow-hidden md:h-[calc(100vh-4.5rem)]">
        <ChatHistorySidebar {...sidebarProps} />
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-text-3" />
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="-mx-6 flex h-[calc(100vh-3.5rem)] overflow-hidden md:h-[calc(100vh-4.5rem)]">
        <ChatHistorySidebar {...sidebarProps} />
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-text-2">{t("projDetail.failedLoad")}</p>
            <Link href="/">
              <Button variant="link" className="mt-2">
                {t("projDetail.goBack")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-6 flex h-[calc(100vh-3.5rem)] overflow-hidden md:h-[calc(100vh-4.5rem)]">
      <ChatHistorySidebar {...sidebarProps} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Compact header for tablet/mobile (<xl): the inline history
            (<lg) and Project Details panel (<xl) are hidden, and the
            global Appbar collapses on phones (<md) — so surface
            navigation here. md+ still relies on the Appbar for the
            project title / model / search / members. */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border-2 bg-bg-white px-3 xl:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
            <Link
              href="/"
              title={t("projDetail.goBack")}
              aria-label={t("projDetail.goBack")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <span className="truncate text-[14px] font-semibold text-text-1">
              {project.name}
            </span>
          </div>
          <div className="hidden flex-1 md:block" />
          <button
            type="button"
            onClick={() => setHistoryDrawerOpen(true)}
            title={t("chatHist.title")}
            aria-label={t("chatHist.title")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1 lg:hidden"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            title={t("chatHist.newConvo")}
            aria-label={t("chatHist.newConvo")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1 lg:hidden"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setDetailsDrawerOpen(true)}
            title={t("projDetails.title")}
            aria-label={t("projDetails.title")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1"
          >
            <PanelRight className="h-5 w-5" />
          </button>

          {/* Phone-only (<md) overflow: the appbar (model / web search /
              members + invite) is hidden on phones, so surface those here. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={t("common.actions")}
                aria-label={t("common.actions")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-3 hover:bg-bg-1 hover:text-text-1 md:hidden"
              >
                <EllipsisVertical className="h-5 w-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              {/* Model picker — the project's agent pool (same as the
                  desktop header dropdown), not every available model. */}
              <div className="border-b border-border-2 px-3 py-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  {t("appbar.model")}
                </p>
                <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                  {(project.agents?.length
                    ? project.agents
                    : project.agent
                      ? [project.agent]
                      : []
                  ).map((id) => {
                    const preset = AGENTS.find((a) => a.id === id);
                    const label = preset?.label ?? labelForModel(id);
                    const isActive = id === project.agent;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          !isActive && switchAgentMutation.mutate(id)
                        }
                        disabled={switchAgentMutation.isPending}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[13px] text-text-1 hover:bg-bg-1 disabled:cursor-not-allowed"
                      >
                        <span className="truncate">{label}</span>
                        {isActive && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-primary-6" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Web search toggle */}
              <button
                type="button"
                onClick={() => webSearchMutation.mutate(!project.webSearch)}
                disabled={
                  !(project.webSearchSupported && project.webSearchAllowed) ||
                  webSearchMutation.isPending
                }
                className="flex w-full cursor-pointer items-center justify-between gap-2 border-b border-border-2 px-3 py-2.5 text-[13px] text-text-1 hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-text-3" />
                  {t("appbar.webSearch")}
                </span>
                <span
                  className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
                    project.webSearch ? "bg-primary-6" : "bg-border-3"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                      project.webSearch ? "left-[14px]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
              {/* Invite (team projects only) */}
              {!isPersonal && project.teamId && (
                <InviteMembersDialog project={project}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-[13px] text-text-1 hover:bg-bg-1"
                  >
                    <UserPlus className="h-4 w-4 text-text-3" />
                    {t("appbar.inviteMember")}
                  </button>
                </InviteMembersDialog>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {/* No in-page header on xl+: the global Appbar (projectDetail
            variant) already renders Back / title / team chip / model
            label / search / avatar stack / Invite Member. */}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            {pausedByokIntegration && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning-2 bg-warning-1/40 px-4 py-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-warning-7"
                  strokeWidth={2}
                />
                <div className="flex-1 text-[13px] leading-relaxed text-text-2">
                  <p className="font-semibold text-text-1">
                    {t("projDetail.keyPausedPrefix")} {pausedByokIntegration.displayName} {t("projDetail.keyPausedSuffix")}
                  </p>
                  <p className="text-text-3">
                    {t("projDetail.routingViaDefault")}{" "}
                    <Link
                      href="/teams?tab=integration"
                      className="font-medium text-primary-6 hover:text-primary-7 underline"
                    >
                      {t("projDetail.integrationTab")}
                    </Link>{" "}
                    {t("projDetail.toBill")}
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-6">
              {/* Empty state — Figma 250:21487 hero: project name as
                  H1, description below, composer immediately under the
                  hero (still rendered below by the regular composer
                  block). */}
              {messages.length === 0 && !isLoadingConversation && (
                <ChatEmptyState
                  project={project}
                  onPickPrompt={setMessage}
                  scope={newChatScope}
                  onScopeChange={setNewChatScope}
                  canChooseScope={!!project.teamId}
                />
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
                      {/* Attached files (chips) on a user message —
                          click to download via the KC download endpoint. */}
                      {msg.role === "user" &&
                        msg.attachments &&
                        msg.attachments.length > 0 && (
                          <div
                            className={`flex flex-wrap gap-2 ${
                              msg.content ? "mb-2" : ""
                            }`}
                          >
                            {msg.attachments.map((a) => (
                              <button
                                key={a.fileId}
                                type="button"
                                onClick={() =>
                                  downloadKnowledgeFile(a.fileId, a.name).catch(
                                    () => toast.error(t("chatComp.attachFailed")),
                                  )
                                }
                                title={t("chatComp.downloadAttachment")}
                                className="inline-flex max-w-[220px] cursor-pointer items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-[12px] text-white transition-colors hover:bg-white/25"
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{a.name}</span>
                                <Download className="h-3 w-3 shrink-0 opacity-80" />
                              </button>
                            ))}
                          </div>
                        )}
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
                          {t("projDetail.thinking")}
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
                          {t("projDetail.showThinking")}
                        </summary>
                        <div className="border-t border-border-2 px-3 py-2 text-text-3 whitespace-pre-wrap italic">
                          {msg.reasoning}
                        </div>
                      </details>
                    ) : null}
                    {/* Web-search sources — streamed via the `citations`
                        SSE event or hydrated from metadata.citations on
                        reload. */}
                    {msg.role === "assistant" &&
                    msg.citations &&
                    msg.citations.length > 0 ? (
                      <div className="mt-2 rounded-md border border-border-2 bg-bg-1/40 px-3 py-2 text-[12px]">
                        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-text-2">
                          <Globe className="h-3.5 w-3.5 text-primary-6" />
                          {t("projDetail.sources")}
                        </div>
                        <ol className="flex flex-col gap-1">
                          {msg.citations.map((c, i) => (
                            <li
                              key={`${c.url}-${i}`}
                              className="flex gap-1.5 text-text-3"
                            >
                              <span className="tabular-nums">{i + 1}.</span>
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-primary-6 hover:underline"
                              >
                                {c.title || c.url}
                              </a>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                    {/* Skills the router auto-applied — makes the format
                        shift legible ("why did it answer like this?"). */}
                    {msg.role === "assistant" &&
                    msg.skills &&
                    msg.skills.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {msg.skills.map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-7"
                          >
                            <Sparkles className="h-3 w-3" />
                            {t("projDetail.skillApplied").replace(
                              "{name}",
                              s.name,
                            )}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {/* Per-message action row (Figma `Icons` frame —
                        30:10464, 168:7221). Hidden mid-stream so we
                        don't expose Copy of a half-rendered bubble or
                        feedback buttons for content that hasn't fully
                        arrived. Error bubbles also skip actions so a
                        humanised 402 / guardrail message doesn't get
                        thumbs-down'd as if it were a model output. */}
                    {msg.role === "assistant" &&
                      !msg.isError &&
                      msg.content !== "" && (
                        <MessageActions
                          content={msg.content}
                          isStreaming={isSending && msg.id.startsWith("resp-")}
                          onFeedback={
                            // Local optimistic id (`resp-…`) means BE
                            // hasn't persisted yet — skip the feedback
                            // call, the conversation refetch on stream-
                            // end will replace this with a real id and
                            // the user can vote then.
                            msg.id.startsWith("resp-") ||
                            msg.id.startsWith("temp-")
                              ? undefined
                              : (score) => {
                                  submitMessageFeedback(msg.id, score).catch(
                                    (err: Error) => {
                                      toast.error(
                                        err.message ||
                                          t("projDetail.couldntSaveFeedback"),
                                      );
                                    },
                                  );
                                }
                          }
                        />
                      )}
                    {/* BE-attached model suggestion (Figma 168:7221).
                        Only fires on assistant turns once the stream
                        is complete and the BE actually returned a
                        recommendation; we strip it the moment the
                        user clicks Try It or dismisses so it doesn't
                        keep nagging. */}
                    {msg.role === "assistant" &&
                      !msg.isError &&
                      msg.alternativeModel &&
                      !(isSending && msg.id.startsWith("resp-")) && (
                        <ModelSuggestionBubble
                          suggestion={msg.alternativeModel}
                          onTryIt={() => handleTrySuggestedModel(msg.id)}
                          onDismiss={() =>
                            setMessages((prev) =>
                              prev.map((m) =>
                                m.id === msg.id
                                  ? { ...m, alternativeModel: undefined }
                                  : m,
                              ),
                            )
                          }
                        />
                      )}
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
                          {t("projDetail.stopped")}
                        </span>
                      )}
                      {msg.role === "assistant" && msg.usedModel && (
                        // The requested model was unavailable; a configured
                        // fallback answered. Show which one so it's not silent.
                        <span
                          className="ml-2 inline-flex items-center rounded-full bg-warning-1 px-1.5 py-0.5 text-[10px] font-medium text-warning-7"
                          title={`${t("projDetail.answeredBy")} ${msg.usedModel}`}
                        >
                          ↳ {t("projDetail.answeredBy")} {msg.usedModel}
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

        {/* Composer — extracted so the two-row Figma layout, the
            Attach File / Upload Image / Prompt Library pills, and the
            send/stop swap all live next to each other. Streaming +
            Stop semantics are unchanged: ChatComposer is purely a
            view layer over the same `message` state, `handleSubmit`,
            and `handleStop` defined in this orchestrator. */}
        <ChatComposer
          projectId={projectId}
          message={message}
          onMessageChange={setMessage}
          onSubmit={handleSubmit}
          onStop={handleStop}
          isSending={isSending}
          pendingAttachments={pendingAttachments}
          onAddFiles={handleAddFiles}
          onRemoveAttachment={handleRemoveAttachment}
          attachmentUploading={attachmentUploading}
          pinnedSkillIds={pinnedSkillIds}
          onTogglePinnedSkill={(id) =>
            setPinnedSkillIds((prev) =>
              prev.includes(id)
                ? prev.filter((x) => x !== id)
                : [...prev, id],
            )
          }
        />
      </div>

      {/* Right "Project Details" panel (Figma 238:17561). conversationData
          is gated on !isSending, so on a fresh chat it's briefly null —
          the panel's Chat Context section handles that with its
          "start a conversation" empty state. */}
      <ProjectDetailsPanel
        projectId={projectId}
        conversation={conversationData ?? null}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        mobileOpen={detailsDrawerOpen}
        onMobileOpenChange={setDetailsDrawerOpen}
        onPickPrompt={setMessage}
      />
    </div>
  );
}
