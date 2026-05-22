"use client";

import { Bot } from "lucide-react";
import type { Project } from "@/lib/api";

/**
 * Empty-state hero shown when a chat has no messages yet.
 *
 * Mirrors Figma frame 250:21487: a centered hero with the project
 * name as H1 and the description below as supporting copy. Replaces
 * the previous generic "Start a conversation" placeholder. Without a
 * description, we still show the title — covering the case where the
 * project was created via the older form that didn't capture a
 * description.
 */
export function ChatEmptyState({ project }: { project: Project }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-bg-1">
        <Bot className="h-6 w-6 text-text-3" />
      </div>
      <h2 className="text-[24px] font-bold text-text-1 sm:text-[32px]">
        {project.name}
      </h2>
      {project.description && (
        <p className="max-w-[560px] text-[14px] leading-[1.5] text-text-2 sm:text-[16px]">
          {project.description}
        </p>
      )}
      {!project.description && (
        <p className="text-[13px] text-text-3">
          Send a message to begin chatting with your AI assistant.
        </p>
      )}
    </div>
  );
}
