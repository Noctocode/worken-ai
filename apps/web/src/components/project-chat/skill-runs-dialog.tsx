"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
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
  fetchSkillRunArtifacts,
  fetchSkillRuns,
  skillArtifactDownloadUrl,
  type SkillRunSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

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

/** Lazily-loaded artifact chips for one run (only fetched when expanded). */
function RunArtifacts({ runId }: { runId: string }) {
  const { t } = useLanguage();
  const { data: arts = [], isLoading } = useQuery({
    queryKey: ["skill-run-artifacts", runId],
    queryFn: () => fetchSkillRunArtifacts(runId),
  });
  if (isLoading) {
    return (
      <p className="px-1 py-1 text-[12px] text-text-3">
        {t("skillRuns.loadingFiles")}
      </p>
    );
  }
  if (arts.length === 0) {
    return (
      <p className="px-1 py-1 text-[12px] text-text-3">
        {t("skillRuns.noFiles")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 px-1 py-1">
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
                  {isOpen && run.status === "done" && (
                    <RunArtifacts runId={run.id} />
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
