"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useLanguage } from "@/lib/i18n";
import type { ScheduledPromptRun } from "@/lib/api";
import { useScheduledPromptRuns } from "@/lib/hooks/use-scheduled-prompts";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function statusBadgeVariant(
  status: ScheduledPromptRun["status"],
): "default" | "secondary" | "destructive" {
  if (status === "success") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function RunHistoryDialog({
  promptId,
  promptName,
  open,
  onOpenChange,
}: {
  promptId: string | undefined;
  promptName: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const { runs, isLoading } = useScheduledPromptRuns(open ? promptId : undefined);
  const [expanded, setExpanded] = useState<string | null>(null);

  const statusLabel = (s: ScheduledPromptRun["status"]) =>
    s === "success"
      ? t("aiCron.runs.statusSuccess")
      : s === "failed"
        ? t("aiCron.runs.statusFailed")
        : s === "running"
          ? t("aiCron.runs.statusRunning")
          : t("aiCron.runs.statusPending");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("aiCron.runs.title")}
            {promptName ? ` — ${promptName}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading && (
            <div className="py-8 text-center text-sm text-text-2">…</div>
          )}
          {!isLoading && runs.length === 0 && (
            <div className="py-8 text-center text-sm text-text-2">
              {t("aiCron.runs.empty")}
            </div>
          )}
          {runs.length > 0 && (
            <ul className="flex flex-col divide-y divide-border-2">
              {runs.map((run) => {
                const isOpen = expanded === run.id;
                return (
                  <li key={run.id} className="py-2">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 text-left"
                      onClick={() => setExpanded(isOpen ? null : run.id)}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4 text-text-3" />
                      ) : (
                        <ChevronRight className="size-4 text-text-3" />
                      )}
                      <Badge variant={statusBadgeVariant(run.status)}>
                        {statusLabel(run.status)}
                      </Badge>
                      <span className="text-xs text-text-2">
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                      <span className="ml-auto text-xs text-text-3">
                        {run.triggeredBy === "manual"
                          ? t("aiCron.runs.triggerManual")
                          : t("aiCron.runs.triggerSchedule")}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="mt-2 flex flex-col gap-2 pl-7">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3">
                          {run.model && (
                            <span>
                              {t("aiCron.runs.model")}: {run.model}
                            </span>
                          )}
                          {run.totalTokens != null && (
                            <span>
                              {t("aiCron.runs.tokens")}: {run.totalTokens}
                            </span>
                          )}
                          {run.deliveryStatus &&
                            Object.keys(run.deliveryStatus).length > 0 && (
                              <span>
                                {t("aiCron.runs.delivery")}:{" "}
                                {Object.entries(run.deliveryStatus)
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(", ")}
                              </span>
                            )}
                        </div>
                        {run.errorMessage && (
                          <div className="rounded-lg bg-danger-1 px-3 py-2 text-xs text-danger-6">
                            {run.errorMessage}
                          </div>
                        )}
                        {run.output && (
                          <pre className="whitespace-pre-wrap break-words rounded-lg bg-bg-2 px-3 py-2 text-xs text-text-1">
                            {run.output}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
