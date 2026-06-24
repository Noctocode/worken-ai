"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchPrompts, type PromptSummary } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useResetOnClose } from "@/lib/hooks/use-reset-on-close";

/**
 * "Prompt Library" composer button.
 *
 * Opens a picker over the user's prompt library and inserts the body
 * of the chosen prompt into the composer textarea via `onPick`.
 *
 * Read-only by design: nothing in this dialog mutates the prompt — if
 * a user wants to edit a prompt they navigate to /resources/prompt-
 * library where the full CRUD lives. The chat composer just consumes
 * them.
 */
export function PromptLibraryDialog({
  children,
  onPick,
}: {
  children: React.ReactNode;
  onPick: (body: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Clear the search when the dialog closes, so it reopens unfiltered.
  useResetOnClose(open, () => setQuery(""));

  // Lazy-load the prompt list when the dialog opens. Fresh query
  // each open instead of caching across mounts — the prompt library
  // is a low-volume read and staleness here would confuse users who
  // just added a prompt in another tab.
  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ["prompts"],
    queryFn: fetchPrompts,
    enabled: open,
  });

  const filtered = useMemo<PromptSummary[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) => {
      const haystack = `${p.title} ${p.description ?? ""} ${(p.tags ?? []).join(" ")}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [prompts, query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("promptLib.title")}</DialogTitle>
          <DialogDescription>
            {t("promptLib.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            placeholder={t("promptLib.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto pr-1">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-text-3" />
            </div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <BookOpen className="h-8 w-8 text-text-3" strokeWidth={1.5} />
              <p className="text-[13px] text-text-2">
                {prompts.length === 0
                  ? t("promptLib.noPrompts")
                  : t("promptLib.noMatch")}
              </p>
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(p.body);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full rounded-lg border border-border-2 bg-bg-white px-3 py-3 text-left transition-colors hover:border-primary-5 hover:bg-primary-1/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[14px] font-semibold text-text-1">
                      {p.title}
                    </p>
                    {p.category && (
                      <span className="shrink-0 rounded-md bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-2">
                        {p.category}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-[12px] text-text-2">
                      {p.description}
                    </p>
                  )}
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[12px] text-text-3">
                    {p.body}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
