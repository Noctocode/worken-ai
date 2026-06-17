"use client";

import { useRef } from "react";
import {
  BookOpen,
  FileText,
  ImagePlus,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { PromptLibraryDialog } from "./prompt-library-dialog";
import { SkillsDialog } from "./skills-dialog";
import { useLanguage } from "@/lib/i18n";
import type { ChatAttachment } from "@/lib/api";

/** Formats the chat ingestion pipeline can parse (docx / xls / xlsx /
 *  pdf). Legacy .doc is excluded — the parser is .docx-only. */
const ACCEPTED_FILE_TYPES = ".pdf,.docx,.xls,.xlsx";

interface Props {
  projectId: string;
  message: string;
  onMessageChange: (next: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  isSending: boolean;
  /** Files attached to the next message (uploaded to KC already). */
  pendingAttachments: ChatAttachment[];
  onAddFiles: (files: FileList) => void;
  onRemoveAttachment: (fileId: string) => void;
  attachmentUploading: boolean;
  /** Skill ids the user pinned for this conversation — sent with each
   *  message so the router force-includes them. */
  pinnedSkillIds: string[];
  onTogglePinnedSkill: (id: string) => void;
}

/**
 * Composer matching the Figma `Frame 44 / Input field` instance from
 * 250:21487 and 30:10464. Two-row layout inside a shadowed white
 * card:
 *  - Row 1: the textarea (the original autoresizing one, identical
 *    behavior — Enter to send, Shift+Enter for newline, max-height
 *    clamp, disabled-while-sending).
 *  - Row 2: two outline pill buttons on the left ([Attach File]
 *    [Prompt Library]) and the send/stop icon on the right. The icon
 *    swaps to a destructive-red Square mid-stream so the user can
 *    interrupt the model. Stop calls `onStop()` which fires the
 *    AbortController back in page.tsx — exact same plumbing as
 *    before, just wrapped in a tidier shell.
 *
 * Attach File opens a file picker; picked files upload into the
 * project's Knowledge Core and ride with the next message as chips.
 * Restricted to Word / Excel / PDF documents.
 */
export function ChatComposer({
  projectId,
  message,
  onMessageChange,
  onSubmit,
  onStop,
  isSending,
  pendingAttachments,
  onAddFiles,
  onRemoveAttachment,
  attachmentUploading,
  pinnedSkillIds,
  onTogglePinnedSkill,
}: Props) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(message.trim()) || pendingAttachments.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Fire a real form submit rather than calling onSubmit with the
      // KeyboardEvent — onSubmit expects a FormEvent, and requestSubmit
      // also runs native validation and the form's onSubmit path once.
      formRef.current?.requestSubmit();
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
        ref={formRef}
        onSubmit={onSubmit}
        // Full-width composer (no max-w cap) so the input spans the
        // chat column edge-to-edge. The shadowed white card sits
        // directly inside the bg-bg-1 frame; horizontal padding lives
        // on the outer wrapper so the card itself can fill it.
        className="flex w-full flex-col gap-0 rounded-2xl border border-border-2 bg-bg-white shadow-[0px_4px_4px_rgba(0,0,0,0.06)]"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onAddFiles(e.target.files);
            }
            // Reset so re-picking the same filename fires onChange again.
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />

        {/* Pending attachment chips — files already uploaded to KC,
            waiting to ride with the next message. */}
        {(pendingAttachments.length > 0 || attachmentUploading) && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            {pendingAttachments.map((a) => (
              <span
                key={a.fileId}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-2 bg-bg-1 py-1 pl-2 pr-1 text-[12px] text-text-2"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-text-3" />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.fileId)}
                  title={t("chatComp.removeAttachment")}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-3 hover:bg-bg-3 hover:text-danger-6"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {attachmentUploading && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("chatComp.uploadingAttachment")}
              </span>
            )}
          </div>
        )}

        {/* Row 1 — the textarea. Kept exactly as the old composer
            (autoresize, max-height clamp, Enter/Shift+Enter) so the
            streaming + Stop semantics in page.tsx are unaffected. */}
        <div className="px-4 pt-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("chatComp.askAnything")}
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
            <ComposerPill
              icon={Paperclip}
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending || attachmentUploading}
            >
              {t("chatComp.attachFile")}
            </ComposerPill>
            {/* Image upload is not wired yet — shown disabled with a
                "coming soon" tag so the affordance is visible without
                promising functionality. */}
            <ComposerPill
              icon={ImagePlus}
              disabled
              title={t("chatComp.uploadImageSoon")}
            >
              {t("chatComp.uploadImage")}
              <span className="rounded bg-bg-1 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-3">
                {t("chatComp.comingSoon")}
              </span>
            </ComposerPill>
            <PromptLibraryDialog onPick={insertPromptBody}>
              <ComposerPill icon={BookOpen}>{t("chatComp.promptLibrary")}</ComposerPill>
            </PromptLibraryDialog>
            <SkillsDialog
              pinnedIds={pinnedSkillIds}
              onTogglePin={onTogglePinnedSkill}
              projectId={projectId}
            >
              <ComposerPill icon={Sparkles}>
                {t("chatComp.skills")}
                {pinnedSkillIds.length > 0 && (
                  <span className="rounded-full bg-primary-6 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {pinnedSkillIds.length}
                  </span>
                )}
              </ComposerPill>
            </SkillsDialog>
          </div>
          {isSending ? (
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={onStop}
              title={t("chatComp.stopGenerating")}
            >
              <Square className="h-3.5 w-3.5" fill="currentColor" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full bg-primary-6 hover:bg-primary-7"
              disabled={!canSend}
              title={t("chatComp.send")}
            >
              <Send className={`h-4 w-4 ${canSend ? "" : "opacity-60"}`} />
            </Button>
          )}
        </div>
      </form>
      <p className="mt-2 text-center text-[11px] text-text-3">
        {isSending ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("chatComp.generating")}
          </span>
        ) : (
          <>{t("chatComp.shiftEnter")}</>
        )}
      </p>
    </div>
  );
}

function ComposerPill({
  icon: Icon,
  children,
  onClick,
  disabled = false,
  title,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-8 items-center gap-2 rounded-lg border border-border-2 bg-bg-white px-3 text-[12px] font-medium text-text-2 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:border-primary-5 hover:text-text-1"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
