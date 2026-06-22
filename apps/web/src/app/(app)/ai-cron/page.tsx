"use client";

import {
  CalendarClock,
  History,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useLanguage } from "@/lib/i18n";
import type { ScheduledPrompt } from "@/lib/api";
import { useUserModels } from "@/lib/hooks/use-user-models";
import {
  useDeleteScheduledPrompt,
  useRunScheduledPromptNow,
  useScheduledPrompts,
  useToggleScheduledPrompt,
} from "@/lib/hooks/use-scheduled-prompts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { RunHistoryDialog } from "./run-history-dialog";

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AiCronPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const { prompts, isLoading } = useScheduledPrompts();
  const { getLabel } = useUserModels();
  const toggleMut = useToggleScheduledPrompt();
  const deleteMut = useDeleteScheduledPrompt();
  const runMut = useRunScheduledPromptNow();

  const [pendingDelete, setPendingDelete] = useState<ScheduledPrompt | null>(
    null,
  );
  const [historyFor, setHistoryFor] = useState<ScheduledPrompt | null>(null);

  // Appbar "New schedule" action.
  useEffect(() => {
    const handler = () => router.push("/ai-cron/new");
    window.addEventListener("ai-cron:new", handler);
    return () => window.removeEventListener("ai-cron:new", handler);
  }, [router]);

  const handleToggle = (p: ScheduledPrompt) => {
    toggleMut.mutate(
      { id: p.id, isEnabled: !p.isEnabled },
      {
        onSuccess: () => toast.success(t("aiCron.toast.toggled")),
        onError: () => toast.error(t("aiCron.toast.toggleFailed")),
      },
    );
  };

  const handleRunNow = (p: ScheduledPrompt) => {
    const id = toast.loading(t("aiCron.toast.runStarted"));
    runMut.mutate(p.id, {
      onSuccess: (run) => {
        if (run.status === "success") {
          toast.success(t("aiCron.toast.runDone"), { id });
        } else {
          toast.error(run.errorMessage || t("aiCron.toast.runFailed"), { id });
        }
      },
      onError: () => toast.error(t("aiCron.toast.runFailed"), { id }),
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const name = pendingDelete.name;
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => toast.success(t("aiCron.toast.deleted")),
      onError: () => toast.error(t("aiCron.toast.deleteFailed")),
    });
    setPendingDelete(null);
    void name;
  };

  const rowActions = (p: ScheduledPrompt) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => router.push(`/ai-cron/${p.id}/edit`)}
        >
          <Pencil className="size-4" />
          {t("aiCron.action.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleRunNow(p)}
          disabled={runMut.isPending}
        >
          <Play className="size-4" />
          {t("aiCron.action.runNow")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHistoryFor(p)}>
          <History className="size-4" />
          {t("aiCron.action.history")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setPendingDelete(p)}
          className="text-danger-6 focus:text-danger-6"
        >
          <Trash2 className="size-4" />
          {t("aiCron.action.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const statusBadge = (p: ScheduledPrompt) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        p.isEnabled
          ? "bg-success-1 text-success-7"
          : "bg-bg-1 text-text-3"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${
          p.isEnabled ? "bg-success-7" : "bg-text-3"
        }`}
      />
      {p.isEnabled ? t("aiCron.status.enabled") : t("aiCron.status.disabled")}
    </span>
  );

  return (
    <div className="flex flex-col gap-3 py-3 lg:gap-6 lg:py-6">
      {/* Mobile in-page header — the desktop appbar renders the title + the
          "New schedule" action. */}
      <div className="flex items-center justify-between lg:hidden">
        <h1 className="text-lg font-semibold text-text-1">
          {t("aiCron.title")}
        </h1>
        <Button size="sm" onClick={() => router.push("/ai-cron/new")}>
          <Plus className="size-4" />
          {t("aiCron.new")}
        </Button>
      </div>

      <p className="hidden text-sm text-text-2 lg:block">
        {t("aiCron.subtitle")}
      </p>

      {!isLoading && prompts.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-border-2 bg-bg-white px-6 py-16 text-center">
          <CalendarClock className="size-8 text-text-3" />
          <div className="text-base font-medium text-text-1">
            {t("aiCron.empty.title")}
          </div>
          <div className="max-w-sm text-sm text-text-2">
            {t("aiCron.empty.desc")}
          </div>
          <Button className="mt-2" onClick={() => router.push("/ai-cron/new")}>
            <Plus className="size-4" />
            {t("aiCron.empty.cta")}
          </Button>
        </div>
      )}

      {/* Mobile: card list */}
      {prompts.length > 0 && (
        <div className="flex flex-col gap-2.5 lg:hidden">
          {prompts.map((p) => (
            <div
              key={p.id}
              className="flex flex-col gap-3 rounded-[10px] border border-border-2 bg-bg-white p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  className="text-left text-[15px] font-semibold text-text-1"
                  onClick={() => router.push(`/ai-cron/${p.id}/edit`)}
                >
                  {p.name}
                </button>
                {rowActions(p)}
              </div>
              <div className="flex flex-col gap-1 text-[13px] text-text-2">
                <span className="font-mono text-[12px] text-text-3">
                  {p.cronExpression}{" "}
                  <span className="text-text-3">({p.timezone})</span>
                </span>
                <span>{getLabel(p.modelIdentifier)}</span>
                <span className="text-text-3">
                  {t("aiCron.col.nextRun")}:{" "}
                  {p.nextRunAt ? formatDateTime(p.nextRunAt) : t("aiCron.never")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                {statusBadge(p)}
                <Switch
                  checked={p.isEnabled}
                  onCheckedChange={() => handleToggle(p)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop: table */}
      {prompts.length > 0 && (
        <div className="hidden overflow-hidden rounded-[20px] border border-border-2 bg-bg-white lg:block">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border-2 text-[14px] font-medium text-text-2">
                <th className="px-5 py-3 font-medium">{t("aiCron.col.name")}</th>
                <th className="px-5 py-3 font-medium">
                  {t("aiCron.col.schedule")}
                </th>
                <th className="px-5 py-3 font-medium">{t("aiCron.col.model")}</th>
                <th className="px-5 py-3 font-medium">
                  {t("aiCron.col.nextRun")}
                </th>
                <th className="px-5 py-3 font-medium">
                  {t("aiCron.col.status")}
                </th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border-2 transition-colors last:border-b-0 hover:bg-bg-1"
                >
                  <td className="px-5 py-4">
                    <button
                      className="text-left font-medium text-text-1 hover:text-primary-6"
                      onClick={() => router.push(`/ai-cron/${p.id}/edit`)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="px-5 py-4 font-mono text-[12px] text-text-2">
                    {p.cronExpression}
                    <span className="ml-1 text-text-3">({p.timezone})</span>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {getLabel(p.modelIdentifier)}
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {p.nextRunAt ? formatDateTime(p.nextRunAt) : t("aiCron.never")}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={p.isEnabled}
                        onCheckedChange={() => handleToggle(p)}
                      />
                      {statusBadge(p)}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">{rowActions(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("aiCron.delete.title")}</DialogTitle>
            <DialogDescription>{t("aiCron.delete.desc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("aiCron.delete.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMut.isPending}
            >
              {t("aiCron.delete.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RunHistoryDialog
        promptId={historyFor?.id}
        promptName={historyFor?.name}
        open={!!historyFor}
        onOpenChange={(open) => !open && setHistoryFor(null)}
      />
    </div>
  );
}
