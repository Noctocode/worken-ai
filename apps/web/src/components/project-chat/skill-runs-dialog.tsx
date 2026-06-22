"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Wrench,
  XCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchSkillRun,
  fetchSkillRunArtifacts,
  fetchSkillRuns,
  skillArtifactDownloadUrl,
  type SkillRunSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { formatSmallUsd } from "@/lib/utils";

function StatusBadge({ status }: { status: SkillRunSummary["status"] }) {
  const { t } = useLanguage();
  const map = {
    running: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      cls: "text-text-2",
      label: t("skillRuns.status.running"),
    },
    done: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      cls: "text-success-6",
      label: t("skillRuns.status.done"),
    },
    failed: {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      cls: "text-danger-6",
      label: t("skillRuns.status.failed"),
    },
    cancelled: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      cls: "text-text-3",
      label: t("skillRuns.status.cancelled"),
    },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] ${map.cls}`}>
      {map.icon}
      {map.label}
    </span>
  );
}

/** Lazily-loaded detail for one run (steps timeline + usage + artifacts). */
function RunDetail({ runId }: { runId: string }) {
  const { t } = useLanguage();
  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["skill-run", runId],
    queryFn: () => fetchSkillRun(runId),
  });
  const { data: arts = [], isError: artsError } = useQuery({
    queryKey: ["skill-run-artifacts", runId],
    queryFn: () => fetchSkillRunArtifacts(runId),
  });

  // A failed detail fetch must not look like an endless "loading" state.
  if (isError) {
    return (
      <p className="px-1 py-2 text-[12px] text-danger-6">
        {t("skillRuns.loadError")}
      </p>
    );
  }
  if (isLoading || !detail) {
    return (
      <p className="px-1 py-2 text-[12px] text-text-3">
        {t("skillRuns.loadingFiles")}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border-2 pt-2">
      {/* Usage rollup */}
      <p className="text-[11px] text-text-3">
        {t("skillRuns.usage")
          .replace("{calls}", String(detail.usage.calls))
          .replace("{tokens}", detail.usage.totalTokens.toLocaleString())}{" "}
        · {formatSmallUsd(detail.usage.costUsd)}
      </p>

      {/* Step timeline */}
      {detail.steps.length > 0 && (
        <div className="flex flex-col gap-1">
          {detail.steps.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 text-[12px] text-text-2"
            >
              {s.success ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-success-6" />
              ) : (
                <AlertTriangle className="h-3 w-3 shrink-0 text-danger-6" />
              )}
              {s.stepType === "llm" ? (
                <span className="font-mono text-text-1">
                  {s.model ?? "llm"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono text-text-1">
                  <Wrench className="h-3 w-3 text-text-3" />
                  {s.tool ?? s.stepType}
                </span>
              )}
              {s.totalTokens != null && (
                <span className="text-text-3">
                  {s.totalTokens.toLocaleString()} tok
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Artifact download chips */}
      {artsError ? (
        <p className="text-[12px] text-danger-6">
          {t("skillRuns.filesError")}
        </p>
      ) : arts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {arts.map((a) => (
            <a
              key={a.id}
              href={skillArtifactDownloadUrl(a.id)}
              download={a.filename}
              className="inline-flex items-center gap-1.5 rounded-md border border-border-2 bg-bg-white px-2.5 py-1.5 text-[12px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
            >
              <Download className="h-3.5 w-3.5" />
              {a.filename}
            </a>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-text-3">{t("skillRuns.noFiles")}</p>
      )}
    </div>
  );
}

export function SkillRunsDialog({
  open,
  onOpenChange,
  skillNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** skillId → display name, for labelling each run. */
  skillNames: Record<string, string>;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["skill-runs"],
    queryFn: fetchSkillRuns,
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("skillRuns.title")}</DialogTitle>
          <DialogDescription>{t("skillRuns.desc")}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center text-[13px] text-text-3">
            {t("skillRuns.loading")}
          </div>
        ) : runs.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-text-3">
            {t("skillRuns.empty")}
          </div>
        ) : (
          <div className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
            {runs.map((run) => {
              const isOpen = expanded === run.id;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-border-2 bg-bg-white p-3"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : run.id)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0 truncate text-[13px] font-medium text-text-1">
                      {skillNames[run.skillId] ?? t("skillRuns.unknownSkill")}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-[11px] text-text-3">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                      <StatusBadge status={run.status} />
                    </span>
                  </button>
                  {run.error && (
                    <p className="mt-1 text-[12px] text-danger-6">{run.error}</p>
                  )}
                  {isOpen && run.status !== "running" && (
                    <RunDetail runId={run.id} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
