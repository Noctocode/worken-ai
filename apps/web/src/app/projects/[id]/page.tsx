"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Send,
  Paperclip,
  ImageIcon,
  Sparkles,
  Bot,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { fetchProject } from "@/lib/api";

interface Message {
  id: number;
  role: "user" | "ai";
  content: string;
  timestamp: string;
  reasoning_details?: string;
}

function getTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ProjectChatPage() {
  const params = useParams();
  const projectId = params.id as string;

  const {
    data: project,
    isLoading: isLoadingProject,
    error,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "ai",
      content:
        "Hello! I'm your AI assistant. How can I help you with this project today?",
      timestamp: getTimestamp(),
    },
  ]);
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSending || !project) return;

    const userMessage: Message = {
      id: Date.now(),
      role: "user",
      content: message.trim(),
      timestamp: getTimestamp(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setMessage("");
    setIsSending(true);

    try {
      const apiMessages = updatedMessages
        .filter((m) => m.role === "user" || m.role === "ai")
        .map((m) => ({
          role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
          content: m.content,
          ...(m.reasoning_details && {
            reasoning_details: m.reasoning_details,
          }),
        }));

      const res = await fetch("http://localhost:3001/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: project.model,
          enableReasoning: true,
          projectId,
        }),
      });

      if (!res.ok) throw new Error("API request failed");

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "ai",
          content: data.content,
          timestamp: getTimestamp(),
          ...(data.reasoning_details && {
            reasoning_details: data.reasoning_details,
          }),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "ai",
          content:
            "Sorry, I encountered an error. Please make sure the API server is running and try again.",
          timestamp: getTimestamp(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  if (isLoadingProject) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-sm text-slate-600">Failed to load project</p>
          <Link href="/">
            <Button variant="link" className="mt-2">
              Go back
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Project Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="h-4 w-px bg-slate-200" />
          <h1 className="text-sm font-semibold text-slate-900">
            {project.name}
          </h1>
        </div>
        <Badge
          variant="secondary"
          className="gap-1 border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600"
        >
          <Sparkles className="h-3 w-3" />
          {project.model}
        </Badge>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div className="space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${
                  msg.role === "user" ? "flex-row-reverse" : "flex-row"
                }`}
              >
                {/* Avatar */}
                {msg.role === "ai" ? (
                  <Avatar className="h-8 w-8 shrink-0 border border-slate-200">
                    <AvatarFallback className="bg-slate-100 text-slate-600">
                      <Bot className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Avatar className="h-8 w-8 shrink-0 border border-blue-100">
                    <AvatarFallback className="bg-gradient-to-tr from-blue-100 to-blue-50 text-xs font-medium text-blue-700">
                      JD
                    </AvatarFallback>
                  </Avatar>
                )}

                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "ai"
                        ? "rounded-tl-sm border border-slate-200 bg-white text-slate-700"
                        : "rounded-tr-sm bg-slate-900 text-white"
                    }`}
                  >
                    {msg.content.split("\n").map((line, i) => (
                      <React.Fragment key={i}>
                        {line
                          .split(/(\*\*.*?\*\*)/)
                          .map((segment, j) =>
                            segment.startsWith("**") &&
                            segment.endsWith("**") ? (
                              <strong key={j}>{segment.slice(2, -2)}</strong>
                            ) : (
                              <span key={j}>{segment}</span>
                            ),
                          )}
                        {i < msg.content.split("\n").length - 1 && <br />}
                      </React.Fragment>
                    ))}
                  </div>
                  <span
                    className={`mt-1 block text-[11px] text-slate-400 ${
                      msg.role === "user" ? "text-right" : "text-left"
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isSending && (
              <div className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0 border border-slate-200">
                  <AvatarFallback className="bg-slate-100 text-slate-600">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="shrink-0 border-t border-slate-200 bg-white">
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
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/10 disabled:opacity-50"
                style={{ minHeight: "44px", maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height =
                    Math.min(target.scrollHeight, 120) + "px";
                }}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl bg-slate-900 hover:bg-slate-800"
              disabled={!message.trim() || isSending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-600"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-slate-600"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-[11px] text-slate-400">
              Shift + Enter for new line
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
