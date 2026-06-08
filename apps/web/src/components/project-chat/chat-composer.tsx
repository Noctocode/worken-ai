"use client";

import { useRef } from "react";
import {
  BookOpen,
  ImagePlus,
  Loader2,
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { AttachFileDialog } from "./attach-file-dialog";
import { PromptLibraryDialog } from "./prompt-library-dialog";
import { useLanguage } from "@/lib/i18n";

/** A locally-attached image awaiting send. `data` is bare base64 (no
 *  `data:` prefix); the preview src is rebuilt from mediaType + data. */
export interface ComposerImage {
  id: string;
  name: string;
  mediaType: string;
  data: string;
}

const MAX_IMAGES = 4;
const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB, matches the BE cap

interface Props {
  projectId: string;
  message: string;
  onMessageChange: (next: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStop: () => void;
  isSending: boolean;
  images: ComposerImage[];
  onImagesChange: (next: ComposerImage[]) => void;
}

/**
 * Composer matching the Figma `Frame 44 / Input field` instance from
 * 250:21487 and 30:10464. Two-row layout inside a shadowed white
 * card:
 *  - Row 1: the textarea (autoresizing — Enter to send, Shift+Enter
 *    for newline, max-height clamp, disabled-while-sending). Image
 *    thumbnails (if any) render above it.
 *  - Row 2: outline pill buttons on the left ([Attach File]
 *    [Upload Image] [Prompt Library]) and the send/stop icon on the
 *    right. The icon swaps to a destructive-red Square mid-stream so
 *    the user can interrupt the model.
 *
 * Attach File opens the AttachFileDialog (Word / Excel / PDF → RAG).
 * Upload Image attaches inline images to the next message (multimodal
 * models); they're held in parent state and sent with the prompt.
 */
export function ChatComposer({
  projectId,
  message,
  onMessageChange,
  onSubmit,
  onStop,
  isSending,
  images,
  onImagesChange,
}: Props) {
  const { t } = useLanguage();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const readAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the "data:<type>;base64," prefix → bare base64 the BE
        // (and both provider SDKs) expect.
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Reset the input so picking the same file again re-fires onChange.
    e.target.value = "";
    if (picked.length === 0) return;

    const next: ComposerImage[] = [];
    for (const file of picked) {
      if (images.length + next.length >= MAX_IMAGES) {
        toast.error(t("chatComp.imageTooMany"));
        break;
      }
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        toast.error(t("chatComp.imageBadType"));
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(t("chatComp.imageTooLarge"));
        continue;
      }
      try {
        const data = await readAsBase64(file);
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          mediaType: file.type,
          data,
        });
      } catch {
        toast.error(t("chatComp.imageReadFailed"));
      }
    }
    if (next.length > 0) onImagesChange([...images, ...next]);
  };

  const removeImage = (id: string) =>
    onImagesChange(images.filter((img) => img.id !== id));

  return (
    <div className="shrink-0 bg-bg-1 px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex w-full flex-col gap-0 rounded-2xl border border-border-2 bg-bg-white shadow-[0px_4px_4px_rgba(0,0,0,0.06)]"
      >
        {/* Image thumbnails — render above the textarea when present. */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-border-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt={img.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  title={t("chatComp.imageRemove")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Row 1 — the textarea. */}
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
            <AttachFileDialog projectId={projectId}>
              <ComposerPill icon={Paperclip}>{t("chatComp.attachFile")}</ComposerPill>
            </AttachFileDialog>
            <ComposerPill
              icon={ImagePlus}
              onClick={() => imageInputRef.current?.click()}
            >
              {t("chatComp.uploadImage")}
            </ComposerPill>
            <PromptLibraryDialog onPick={insertPromptBody}>
              <ComposerPill icon={BookOpen}>{t("chatComp.promptLibrary")}</ComposerPill>
            </PromptLibraryDialog>
            <input
              ref={imageInputRef}
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              multiple
              className="hidden"
              onChange={handleImagePick}
            />
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
              disabled={!message.trim() && images.length === 0}
              title={t("chatComp.send")}
            >
              <Send
                className={`h-4 w-4 ${
                  message.trim() || images.length > 0 ? "" : "opacity-60"
                }`}
              />
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
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border-2 bg-bg-white px-3 text-[12px] font-medium text-text-2 transition-colors hover:border-primary-5 hover:text-text-1"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
