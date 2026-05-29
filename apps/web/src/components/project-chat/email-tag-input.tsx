"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/lib/i18n";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export interface EmailTag {
  value: string;
  /** Set when the BE rejects this address — we keep the token visible
   *  with a red ring instead of silently dropping it so the user can
   *  see which one failed and fix it. */
  error?: string;
}

interface Props {
  tags: EmailTag[];
  onChange: (next: EmailTag[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Multi-tag email input — `Enter` or `,` commits the current token,
 * `Backspace` on an empty input removes the last tag, click × on a
 * tag to remove a specific one. Mirrors the Figma 179:16073 `Input`
 * with badges + role dropdown row.
 *
 * Validation is permissive (`\S+@\S+\.\S+`) — the BE is the source
 * of truth for "is this address invitable" (e.g. already a member,
 * unverified domain, etc.). Anything obviously malformed is rejected
 * up-front; everything else we send and let the BE answer.
 */
export function EmailTagInput({
  tags,
  onChange,
  placeholder,
  disabled,
}: Props) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const value = raw.trim().replace(/[,;]+$/, "");
    if (!value) return;
    if (tags.some((t) => t.value.toLowerCase() === value.toLowerCase())) {
      // Duplicate — just clear the draft, no error.
      setDraft("");
      return;
    }
    const error = EMAIL_PATTERN.test(value)
      ? undefined
      : t("emailTag.invalid");
    onChange([...tags, { value, error }]);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className={`flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-xl border border-border-2 bg-bg-white px-2 py-1.5 transition-colors focus-within:border-primary-5 focus-within:ring-2 focus-within:ring-primary-5/10 ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-text"
      }`}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag.value}-${i}`}
          title={tag.error ?? undefined}
          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium ${
            tag.error
              ? "bg-danger-1 text-danger-6 ring-1 ring-danger-5"
              : "bg-bg-1 text-text-1"
          }`}
        >
          {tag.value}
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChange(tags.filter((_, idx) => idx !== i));
            }}
            aria-label={`${t("emailTag.remove")} ${tag.value}`}
            className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm text-current/70 hover:bg-bg-white hover:text-current"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Soft-commit on blur: if the user typed an address then
          // clicked Send, this catches it instead of silently
          // discarding the in-progress draft.
          if (draft.trim()) commit(draft);
        }}
        disabled={disabled}
        placeholder={tags.length === 0 ? (placeholder ?? t("emailTag.placeholder")) : ""}
        className="min-w-[140px] flex-1 border-none bg-transparent text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
      />
    </div>
  );
}
