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
import { Badge } from "@/components/ui/badge";
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
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-1 px-6 py-16 text-center">
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

      {prompts.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-1">
          <table className="w-full text-sm">
            <thead className="bg-bg-2 text-left text-text-2">
              <tr>
                <th className="px-4 py-3 font-medium">{t("aiCron.col.name")}</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  {t("aiCron.col.schedule")}
                </th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">
                  {t("aiCron.col.model")}
                </th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  {t("aiCron.col.nextRun")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("aiCron.col.status")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border-1 hover:bg-bg-2/50"
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-left font-medium text-text-1 hover:underline"
                      onClick={() => router.push(`/ai-cron/${p.id}/edit`)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-text-2 md:table-cell">
                    {p.cronExpression}
                    <span className="ml-1 text-text-3">({p.timezone})</span>
                  </td>
                  <td className="hidden px-4 py-3 text-text-2 lg:table-cell">
                    {getLabel(p.modelIdentifier)}
                  </td>
                  <td className="hidden px-4 py-3 text-text-2 md:table-cell">
                    {p.nextRunAt ? formatDateTime(p.nextRunAt) : t("aiCron.never")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.isEnabled}
                        onCheckedChange={() => handleToggle(p)}
                      />
                      <Badge variant={p.isEnabled ? "default" : "secondary"}>
                        {p.isEnabled
                          ? t("aiCron.status.enabled")
                          : t("aiCron.status.disabled")}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
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
                          className="text-error-7 focus:text-error-7"
                        >
                          <Trash2 className="size-4" />
                          {t("aiCron.action.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
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
