"use client";

import { useState } from "react";
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

interface Props {
  /** Plain-text body of the assistant message (Markdown source). */
  content: string;
  /** When true, mid-stream optimistic bubble — hide actions until the
   *  stream finishes so the user doesn't end up copying half a token. */
  isStreaming?: boolean;
  /** Optional callback to regenerate this assistant response. The
   *  caller is responsible for kicking the same prompt back through
   *  `streamChatMessage`. When omitted, the Regenerate button hides
   *  itself rather than rendering as a dead control. */
  onRegenerate?: () => void;
  /** Optional feedback hook — `score` is -1 for thumbs-down, +1 for
   *  thumbs-up. The toast confirmation is rendered by this component
   *  so the caller only needs to persist the score. */
  onFeedback?: (score: 1 | -1) => void;
}

/**
 * Action row beneath every assistant bubble (Figma `Icons` frame in
 * 30:10464 / 168:7221). Currently surfaces Copy, Regenerate, and
 * 👍/👎 feedback. Backend wiring for feedback persistence is opt-in
 * via `onFeedback`; without it the buttons still render to keep the
 * UI predictable, and the toast confirms the click without claiming
 * the data was saved.
 */
export function MessageActions({
  content,
  isStreaming,
  onRegenerate,
  onFeedback,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [score, setScore] = useState<1 | -1 | null>(null);

  if (isStreaming) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  const handleVote = (next: 1 | -1) => {
    // Toggle off when clicking the same score twice — the buttons
    // read as radio-like state instead of fire-and-forget telemetry.
    const final = score === next ? null : next;
    setScore(final);
    if (final !== null) {
      onFeedback?.(final);
      toast.success(
        final === 1 ? "Thanks for the feedback." : "Got it — we'll do better.",
      );
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1 text-text-3">
      <ActionButton onClick={handleCopy} label={copied ? "Copied" : "Copy"}>
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success-7" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </ActionButton>
      {onRegenerate && (
        <ActionButton onClick={onRegenerate} label="Regenerate">
          <RotateCcw className="h-3.5 w-3.5" />
        </ActionButton>
      )}
      <ActionButton
        onClick={() => handleVote(1)}
        label="Good response"
        active={score === 1}
      >
        <ThumbsUp
          className={`h-3.5 w-3.5 ${score === 1 ? "text-success-7" : ""}`}
        />
      </ActionButton>
      <ActionButton
        onClick={() => handleVote(-1)}
        label="Bad response"
        active={score === -1}
      >
        <ThumbsDown
          className={`h-3.5 w-3.5 ${score === -1 ? "text-danger-6" : ""}`}
        />
      </ActionButton>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-bg-1 hover:text-text-1 ${
        active ? "bg-bg-1 text-text-1" : ""
      }`}
    >
      {children}
    </button>
  );
}
