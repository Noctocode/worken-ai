"use client";

import { useRef } from "react";
import { BookOpen, ImageIcon, Loader2, Paperclip, Send, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { AttachFileDialog } from "./attach-file-dialog";
import { PromptLibraryDialog } from "./prompt-library-dialog";

interface Props {
  projectId: string;
  message: string;
  onMessageChange: (next: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  isSending: boolean;
}

/**
 * Composer matching the Figma `Frame 44 / Input field` instance from
 * 250:21487 and 30:10464. Two-row layout inside a shadowed white
 * card:
 *  - Row 1: the textarea (the original autoresizing one, identical
 *    behavior — Enter to send, Shift+Enter for newline, max-height
 *    clamp, disabled-while-sending).
 *  - Row 2: three outline pill buttons on the left ([Attach File]
 *    [Upload Image] [Prompt Library]) and the send/stop icon on the
 *    right. The icon swaps to a destructive-red Square mid-stream so
 *    the user can interrupt the model. Stop calls `onStop()` which
 *    fires the AbortController back in page.tsx — exact same plumbing
 *    as before, just wrapped in a tidier shell.
 *
 * Upload Image is intentionally a toast-stub for now: surfacing the
 * affordance without wiring an inline image-upload pipeline keeps
 * scope tight while still telling the user the feature is on the
 * roadmap. The composer is otherwise fully functional.
 */
export function ChatComposer({
  projectId,
  message,
  onMessageChange,
  onSubmit,
  onStop,
  isSending,
}: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const insertPromptBody = (body: string) => {
    onMessageChange(body);
    // Defer focus + caret-to-end so the textarea reflects the new
    // body in the DOM first; otherwise selectionStart lands at the
    // pre-update length.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = body.length;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    });
  };

  return (
    <div className="shrink-0 bg-bg-1 px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
      <form
        onSubmit={onSubmit}
        className="mx-auto flex max-w-3xl flex-col gap-0 rounded-2xl border border-border-2 bg-bg-white shadow-[0px_4px_4px_rgba(0,0,0,0.06)]"
      >
        {/* Row 1 — the textarea. Kept exactly as the old composer
            (autoresize, max-height clamp, Enter/Shift+Enter) so the
            streaming + Stop semantics in page.tsx are unaffected. */}
        <div className="px-4 pt-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything"
            rows={1}
            disabled={isSending}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-text-1 placeholder:text-text-3 focus:outline-none disabled:opacity-50"
            style={{ minHeight: "28px", maxHeight: "200px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height =
                Math.min(target.scrollHeight, 200) + "px";
            }}
          />
        </div>

        {/* Row 2 — quick-action pills on the left, send/stop on the
            right. Matches Figma `Frame 44 / Text field` row 2. */}
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <AttachFileDialog projectId={projectId}>
              <ComposerPill icon={Paperclip}>Attach File</ComposerPill>
            </AttachFileDialog>
            <ComposerPill
              icon={ImageIcon}
              onClick={() => imageInputRef.current?.click()}
            >
              Upload Image
            </ComposerPill>
            <PromptLibraryDialog onPick={insertPromptBody}>
              <ComposerPill icon={BookOpen}>Prompt Library</ComposerPill>
            </PromptLibraryDialog>
            {/* Hidden file input for the Upload Image pill. We
                intentionally keep the multi-step upload + inline
                rendering for a follow-up — surfacing an explicit
                "coming soon" toast lets users notice the affordance
                without us silently swallowing their click. */}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  toast.info(
                    "Inline image attachments are coming soon — for now, upload via Knowledge Core and attach the file.",
                  );
                  // Reset so picking the same file twice still fires
                  // onChange (browsers debounce identical selections).
                  e.target.value = "";
                }
              }}
            />
          </div>
          {isSending ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={onStop}
              title="Stop generating"
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full bg-primary-6 hover:bg-primary-7"
              disabled={!message.trim()}
              title="Send"
            >
              {message.trim() ? (
                <Send className="h-4 w-4" />
              ) : (
                <Send className="h-4 w-4 opacity-60" />
              )}
            </Button>
          )}
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-text-3">
        {isSending ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generating — press Stop to cancel.
          </span>
        ) : (
          <>Shift + Enter for new line</>
        )}
      </p>
    </div>
  );
}

function ComposerPill({
  icon: Icon,
  children,
  onClick,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-2 bg-bg-white px-3 text-[12px] font-medium text-text-2 transition-colors hover:border-primary-5 hover:text-text-1"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
