"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Pin, Search, Sparkles } from "lucide-react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchPinnableSkills, type PinnableSkill } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useResetOnClose } from "@/lib/hooks/use-reset-on-close";

/**
 * "Skills" composer button.
 *
 * Skills are auto-selected by the backend per turn, so this dialog is for
 * VISIBILITY + an optional override: the user can browse the skills
 * available to them and PIN one to force it into the conversation
 * regardless of the embedding match. Pins are tracked client-side and sent
 * with each message as `pinnedSkillIds`.
 *
 * Read-only otherwise — full CRUD lives at /toolkit/skills.
 */
export function SkillsDialog({
  children,
  pinnedIds,
  onTogglePin,
  projectId,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Trigger element (trigger mode). Omit when using controlled open. */
  children?: React.ReactNode;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  /** Current project (project chat). Scopes the list so a project's skill
   *  only shows for pinning inside that project. Omit for the arena. */
  projectId?: string;
  /** Controlled-open mode (e.g. arena opens it from a separate chip). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };
  const [query, setQuery] = useState("");

  // Clear the search when the dialog closes, so it reopens unfiltered.
  useResetOnClose(open, () => setQuery(""));

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ["skills", "pinnable", projectId ?? null],
    queryFn: () => fetchPinnableSkills(projectId),
    enabled: open,
  });

  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const filtered = useMemo<PinnableSkill[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      `${s.name} ${s.description}`.toLowerCase().includes(q),
    );
  }, [skills, query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("skillsDlg.title")}</DialogTitle>
          <DialogDescription>{t("skillsDlg.desc")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skillsDlg.search")}
            className="h-10 pl-9 pr-3 text-[13px] rounded-md border-border-2"
          />
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("skillsDlg.loading")}
            </div>
          ) : skills.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles className="h-7 w-7 text-text-3" strokeWidth={1.5} />
              <p className="max-w-[420px] text-[13px] text-text-2">
                {t("skillsDlg.empty")}
              </p>
              <Link
                href="/toolkit/skills"
                className="text-[13px] font-medium text-primary-6 hover:underline"
              >
                {t("skillsDlg.manage")}
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((s) => {
                const isPinned = pinned.has(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border-2 bg-bg-white p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-text-1">
                        {s.name}
                      </span>
                      <span className="text-[12px] leading-snug text-text-2">
                        {s.description}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTogglePin(s.id)}
                      className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors ${
                        isPinned
                          ? "border-primary-6 bg-primary-1 text-primary-7"
                          : "border-border-2 bg-bg-white text-text-2 hover:border-primary-5 hover:text-text-1"
                      }`}
                      title={isPinned ? t("skillsDlg.unpin") : t("skillsDlg.pin")}
                    >
                      <Pin
                        className="h-3.5 w-3.5"
                        fill={isPinned ? "currentColor" : "none"}
                      />
                      {isPinned ? t("skillsDlg.pinned") : t("skillsDlg.pin")}
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="py-8 text-center text-sm text-text-3">
                  {t("skillsDlg.noMatch")}
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-2 pt-3 text-[12px] text-text-3">
          <span>{t("skillsDlg.autoNote")}</span>
          <Link
            href="/toolkit/skills"
            className="font-medium text-primary-6 hover:underline"
          >
            {t("skillsDlg.manage")}
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
