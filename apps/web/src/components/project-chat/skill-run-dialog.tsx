"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Play,
  Square,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelActiveSkillRun,
  fetchEffectiveModels,
  skillArtifactDownloadUrl,
  streamSkillRun,
  type Skill,
} from "@/lib/api";
import { eligibleExecutableModels } from "@/lib/executable-model";
import {
  initialSkillRunView,
  reduceSkillRun,
  type SkillRunView,
} from "@/lib/skill-run-reducer";
import { useLanguage } from "@/lib/i18n";

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
}

export function SkillRunDialog({
  skill,
  open,
  onOpenChange,
}: {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const [model, setModel] = useState("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<SkillRunView>(initialSkillRunView);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Only the user's Anthropic-native BYOK models can run an executable skill
  // (the BE rejects every other route). Fetched lazily while the dialog is open.
  const { data: allModels = [], isLoading: modelsLoading } = useQuery({
    queryKey: ["models", "effective", "executable"],
    queryFn: () => fetchEffectiveModels(),
    enabled: open,
  });
  const models = useMemo(
    () => eligibleExecutableModels(allModels),
    [allModels],
  );

  // Default to the first eligible model; clear if the current pick disappears.
  useEffect(() => {
    if (models.length === 0) {
      if (model) setModel("");
      return;
    }
    if (!models.some((m) => m.id === model)) setModel(models[0].id);
  }, [models, model]);

  const start = async () => {
    if (!skill || running) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setView({ ...initialSkillRunView, status: "running" });
    try {
      for await (const ev of streamSkillRun(
        skill.id,
        { model: model.trim(), message: message.trim() || undefined },
        ctrl.signal,
      )) {
        setView((v) => reduceSkillRun(v, ev));
      }
    } catch (err) {
      // Pre-flight failure (flag off, non-Anthropic model, …) or a dropped
      // stream — surface it as a failed run unless the user aborted.
      if (!ctrl.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        setView((v) => reduceSkillRun(v, { type: "error", message: msg }));
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  };

  const stop = async () => {
    abortRef.current?.abort();
    try {
      await cancelActiveSkillRun();
    } catch {
      /* best-effort — the abort already stopped our stream */
    }
  };

  const close = (next: boolean) => {
    if (!next && running) return; // don't close mid-run
    if (!next) {
      setView(initialSkillRunView);
      setMessage("");
    }
    onOpenChange(next);
  };

  const terminal =
    view.status === "done" ||
    view.status === "failed" ||
    view.status === "cancelled";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("skillRun.title").replace("{name}", skill?.name ?? "")}</DialogTitle>
          <DialogDescription>{t("skillRun.desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Inputs */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">
              {t("skillRun.modelField")}
            </label>
            {modelsLoading ? (
              <div className="flex h-10 items-center gap-2 rounded border border-border-2 px-3 text-[13px] text-text-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("skillRun.modelsLoading")}
              </div>
            ) : models.length === 0 ? (
              <div className="flex items-start gap-2 rounded border border-border-2 bg-bg-1 px-3 py-2 text-[12px] text-text-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" />
                <span>{t("skillRun.noModels")}</span>
              </div>
            ) : (
              <Select value={model} onValueChange={setModel} disabled={running}>
                <SelectTrigger className="h-10 rounded border-border-2 text-[13px]">
                  <SelectValue placeholder={t("skillRun.modelPh")} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} (BYOK)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-text-3">{t("skillRun.modelHint")}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">
              {t("skillRun.messageField")}
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={running}
              rows={2}
              placeholder={t("skillRun.messagePh")}
              className="rounded border-border-2 text-[13px]"
            />
          </div>

          {/* Run / Stop + cost */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-text-2">
              {view.estimatedUsd != null && !terminal && (
                <span>
                  {t("skillRun.estimate")}: {fmtUsd(view.estimatedUsd)}
                </span>
              )}
              {terminal && view.costUsd != null && (
                <span>
                  {t("skillRun.cost")}: {fmtUsd(view.costUsd)}
                </span>
              )}
            </div>
            {running ? (
              <Button
                variant="outline"
                onClick={stop}
                className="cursor-pointer gap-2"
              >
                <Square className="h-3.5 w-3.5" />
                {t("skillRun.stop")}
              </Button>
            ) : (
              <Button
                onClick={start}
                disabled={!model.trim()}
                className="cursor-pointer gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                {t("skillRun.run")}
              </Button>
            )}
          </div>

          {/* Live output */}
          {view.status !== "idle" && (
            <div className="flex max-h-[42vh] flex-col gap-3 overflow-y-auto rounded-lg border border-border-2 bg-bg-1 p-3">
              {/* Tool-step timeline */}
              {view.steps.map((s) => (
                <div key={s.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-text-1">
                    {!s.done ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-text-3" />
                    ) : s.isError ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-danger-6" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success-6" />
                    )}
                    <Wrench className="h-3 w-3 text-text-3" />
                    <span className="font-mono">{s.name}</span>
                  </div>
                  {s.done && s.output && (
                    <pre className="ml-5 line-clamp-4 whitespace-pre-wrap rounded bg-bg-white px-2 py-1 font-mono text-[11px] leading-snug text-text-2">
                      {s.output}
                    </pre>
                  )}
                </div>
              ))}

              {/* Streamed assistant text */}
              {view.text && (
                <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-1">
                  {view.text}
                </pre>
              )}

              {/* Artifacts */}
              {view.artifacts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {view.artifacts.map((a) => (
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
              )}

              {/* Status footers */}
              {running && view.steps.length === 0 && !view.text && (
                <div className="flex items-center gap-2 text-[12px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("skillRun.running")}
                </div>
              )}
              {view.error && (
                <div className="flex items-start gap-2 rounded border border-danger-3 bg-danger-1 px-2.5 py-2 text-[12px] text-danger-6">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{view.error}</span>
                </div>
              )}
              {view.status === "cancelled" && (
                <p className="text-[12px] text-text-3">
                  {t("skillRun.cancelled")}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
