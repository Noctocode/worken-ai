"use client";

import { Bot, Sparkles } from "lucide-react";
import type { Project } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

/**
 * Empty-state hero shown when a chat has no messages yet.
 *
 * Mirrors Figma frame 250:21487 / 238:17561: a centered hero with the
 * project name as H1, the description below as supporting copy, and a
 * row of "quick prompt" cards that pre-fill the composer on click
 * (Figma "Here are a few quick prompts that fit your vibe!"). Without
 * a description we still show the title — covering projects created via
 * the older form that didn't capture one.
 *
 * `onPickPrompt` is optional: when omitted the cards aren't rendered,
 * so the component stays usable in any read-only context.
 */
export function ChatEmptyState({
  project,
  onPickPrompt,
  scope,
  onScopeChange,
  canChooseScope = false,
}: {
  project: Project;
  onPickPrompt?: (text: string) => void;
  /** Selected scope for the chat that this first message will create. */
  scope?: "personal" | "team";
  onScopeChange?: (scope: "personal" | "team") => void;
  /** Only team projects can host a shared chat — hides the toggle for
   *  personal projects (every chat there is personal anyway). */
  canChooseScope?: boolean;
}) {
  const { t } = useLanguage();
  const prompts = [
    t("chatEmpty.prompt1"),
    t("chatEmpty.prompt2"),
    t("chatEmpty.prompt3"),
  ];
  const scopeTabs: { key: "personal" | "team"; label: string }[] = [
    { key: "personal", label: t("chatEmpty.scopePersonal") },
    { key: "team", label: t("chatEmpty.scopeTeam") },
  ];
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-bg-1">
        <Bot className="h-6 w-6 text-text-3" />
      </div>
      <h2 className="text-[24px] font-bold text-text-1 sm:text-[32px]">
        {project.name}
      </h2>

      {/* New-chat scope: a personal chat stays private to you, a team
          chat is shared with the project's team. Only shown for team
          projects (and when the parent wires the handler). */}
      {canChooseScope && onScopeChange && scope && (
        <div className="mt-1 flex flex-col items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-border-2 bg-bg-1 p-0.5">
            {scopeTabs.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onScopeChange(s.key)}
                className={`cursor-pointer rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                  scope === s.key
                    ? "bg-primary-6 text-white"
                    : "text-text-2 hover:text-text-1"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-3">
            {scope === "team"
              ? t("chatEmpty.scopeTeamHint")
              : t("chatEmpty.scopePersonalHint")}
          </p>
        </div>
      )}
      {project.description ? (
        <p className="max-w-[560px] text-[14px] leading-[1.5] text-text-2 sm:text-[16px]">
          {project.description}
        </p>
      ) : (
        <p className="text-[13px] text-text-3">{t("chatEmpty.sendMessage")}</p>
      )}

      {/* Quick-prompt cards — only when the parent passes a handler to
          receive the picked text (the composer setter). */}
      {onPickPrompt && (
        <div className="mt-6 w-full max-w-[720px]">
          <p className="mb-3 flex items-center justify-center gap-1.5 text-[13px] font-medium text-text-2">
            <Sparkles className="h-3.5 w-3.5 text-primary-6" />
            {t("chatEmpty.promptsHint")}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {prompts.map((prompt, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onPickPrompt(prompt)}
                className="flex h-full cursor-pointer items-start rounded-xl border border-border-2 bg-bg-white p-4 text-left text-[13px] leading-snug text-text-2 transition-colors hover:border-primary-5 hover:text-text-1"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
