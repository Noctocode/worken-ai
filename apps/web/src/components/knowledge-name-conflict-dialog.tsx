"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, AlertTriangle } from "lucide-react";
import type {
  KnowledgeUploadNameConflict,
  NameConflictAction,
} from "@/lib/api";

interface Props {
  open: boolean;
  // Names the BE rejected as same-name-different-content in the
  // target folder. Each entry has `existing.id` pointing at the
  // prior row so the BE-side overwrite path can find it.
  conflicts: KnowledgeUploadNameConflict[];
  // Called with the user's per-name choice. Caller re-uploads ONLY
  // the conflicting files with this map. Keys must match the names
  // surfaced in `conflicts`.
  onResolve: (actions: Record<string, NameConflictAction>) => void;
  onCancel: () => void;
}

/**
 * Soft warning shown after the BE flagged same-name-different-content
 * uploads. Lets the user decide per file: overwrite the prior row,
 * keep both (BE renames the new one to "<base> (N).<ext>"), or skip
 * the upload entirely. "Apply to all" shortcuts make a bulk decision
 * possible without clicking every row.
 *
 * Intentionally a single shared component — the three upload entry
 * points (Manage Context, root KC, KC folder page) all need the same
 * UI and copy, so any tweak lands in one place.
 */
export function KnowledgeNameConflictDialog({
  open,
  conflicts,
  onResolve,
  onCancel,
}: Props) {
  // Per-name action. Defaults to 'skip' so a user who clicks "Apply"
  // without touching the picker doesn't end up nuking anything they
  // didn't explicitly opt into.
  const [actions, setActions] = useState<Record<string, NameConflictAction>>(
    {},
  );

  // Re-seed defaults whenever the conflict list changes (e.g. caller
  // closed + reopened with a different batch). Keep prior choices
  // for names that are still present so a user who toggled then
  // toggled bulk doesn't lose their picks.
  useEffect(() => {
    setActions((prev) => {
      const next: Record<string, NameConflictAction> = {};
      for (const c of conflicts) {
        next[c.name] = prev[c.name] ?? "skip";
      }
      return next;
    });
  }, [conflicts]);

  const summary = useMemo(() => {
    let overwrite = 0;
    let keepBoth = 0;
    let skip = 0;
    for (const c of conflicts) {
      const a = actions[c.name] ?? "skip";
      if (a === "overwrite") overwrite++;
      else if (a === "keep_both") keepBoth++;
      else skip++;
    }
    return { overwrite, keepBoth, skip };
  }, [actions, conflicts]);

  const applyToAll = (action: NameConflictAction) => {
    setActions(() => {
      const next: Record<string, NameConflictAction> = {};
      for (const c of conflicts) next[c.name] = action;
      return next;
    });
  };

  // Dialog is *only* meaningful with at least one conflict. If the
  // caller mounts it empty, treat the next mount as a fresh start.
  if (conflicts.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border-2 px-5 py-4 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <AlertTriangle className="h-4 w-4 text-warning-7" />
            File name already in use
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {conflicts.length === 1
              ? `A file named "${conflicts[0].name}" already exists in this folder with different content. Pick what to do.`
              : `${conflicts.length} files share a name with existing files in this folder (different content). Pick what to do for each, or apply to all.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4 sm:px-6">
          {conflicts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-text-3">
                Apply to all:
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 cursor-pointer text-xs"
                onClick={() => applyToAll("overwrite")}
              >
                Overwrite
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 cursor-pointer text-xs"
                onClick={() => applyToAll("keep_both")}
              >
                Keep both
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 cursor-pointer text-xs"
                onClick={() => applyToAll("skip")}
              >
                Skip
              </Button>
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-border-2">
            <ScrollArea className="max-h-[44vh]">
              <div className="divide-y divide-border-2">
                {conflicts.map((c) => {
                  const action = actions[c.name] ?? "skip";
                  return (
                    <div
                      key={`${c.existing.id}-${c.name}`}
                      className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-text-3" />
                        <span className="min-w-0 flex-1 truncate text-sm text-text-1">
                          {c.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <ChoicePill
                          label="Overwrite"
                          active={action === "overwrite"}
                          tone="danger"
                          onClick={() =>
                            setActions((prev) => ({
                              ...prev,
                              [c.name]: "overwrite",
                            }))
                          }
                        />
                        <ChoicePill
                          label="Keep both"
                          active={action === "keep_both"}
                          tone="primary"
                          onClick={() =>
                            setActions((prev) => ({
                              ...prev,
                              [c.name]: "keep_both",
                            }))
                          }
                        />
                        <ChoicePill
                          label="Skip"
                          active={action === "skip"}
                          tone="neutral"
                          onClick={() =>
                            setActions((prev) => ({
                              ...prev,
                              [c.name]: "skip",
                            }))
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <p className="text-[11px] leading-relaxed text-text-3">
            <strong>Overwrite</strong> deletes the existing file (and its
            chat embeddings) and replaces it with the new bytes.{" "}
            <strong>Keep both</strong> saves the new file as
            &ldquo;<em>name</em> (2).<em>ext</em>&rdquo; alongside the
            existing one. <strong>Skip</strong> does nothing — the new
            file is discarded.
          </p>
        </div>

        <DialogFooter className="gap-2 border-t border-border-2 px-5 py-3 sm:px-6">
          <span className="mr-auto text-[11px] text-text-3 sm:text-xs">
            {summary.overwrite > 0 && `${summary.overwrite} overwrite · `}
            {summary.keepBoth > 0 && `${summary.keepBoth} keep both · `}
            {summary.skip > 0 && `${summary.skip} skip`}
          </span>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            onClick={() => onResolve(actions)}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoicePill({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: "danger" | "primary" | "neutral";
  onClick: () => void;
}) {
  const activeClass =
    tone === "danger"
      ? "border-danger-6 bg-danger-1 text-danger-7"
      : tone === "primary"
        ? "border-primary-6 bg-primary-1 text-primary-7"
        : "border-border-4 bg-bg-1 text-text-1";
  const inactiveClass =
    "border-border-2 bg-bg-white text-text-2 hover:border-border-4 hover:text-text-1";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 cursor-pointer items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors ${
        active ? activeClass : inactiveClass
      }`}
    >
      {label}
    </button>
  );
}
