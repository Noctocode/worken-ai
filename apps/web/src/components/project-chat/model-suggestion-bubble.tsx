"use client";

import { Sparkles, X } from "lucide-react";
import type { AlternativeModelSuggestion } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

interface Props {
  suggestion: AlternativeModelSuggestion;
  onTryIt: () => void;
  onDismiss: () => void;
}

/**
 * "We think X would work better — Try It" bubble that the BE attaches
 * to certain assistant turns (Figma 168:7221). Lives directly below
 * the assistant bubble that triggered it, so it reads as a *follow-up
 * to that answer*, not as a standalone chrome chip.
 *
 * Visually intentionally lighter than a real message: bg-bg-1 (the
 * same surface as the assistant bubble in 168:7221) with a small
 * primary-tinted Sparkles glyph to signal "system nudge, not LLM
 * output". The dismiss × lets a user shut it down without dragging
 * focus to the action — the suggestion is purely opt-in.
 */
export function ModelSuggestionBubble({ suggestion, onTryIt, onDismiss }: Props) {
  const { t } = useLanguage();
  return (
    <div className="mt-3 ml-11 flex max-w-[calc(100%-2.75rem)] flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-2 bg-bg-1/70 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3 text-[13px] text-text-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-1 text-primary-6">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="leading-relaxed">
          {t("modelSugg.weThink")}{" "}
          <strong className="font-semibold text-text-1">
            {suggestion.label}
          </strong>{" "}
          {t("modelSugg.wouldWork")} {suggestion.reason} {t("modelSugg.wantTry")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onTryIt}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-6 bg-primary-6 px-3 text-[12px] font-medium text-white transition-colors hover:bg-primary-7"
        >
          {t("modelSugg.tryIt")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("modelSugg.dismiss")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
