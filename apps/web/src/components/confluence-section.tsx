"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";

import {
  connectConfluence,
  deleteConfluenceSource,
  disconnectConfluence,
  fetchConfluenceImportProgress,
  fetchConfluenceSources,
  fetchConfluenceStatus,
  resyncConfluenceSource,
  type ConfluenceImportProgress,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportFromConfluenceDialog } from "@/components/import-from-confluence-dialog";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

function makeRelativeTime(t: (k: TranslationKey) => string) {
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("confluence.justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${t("confluence.mAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("confluence.hAgo")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${t("confluence.dAgo")}`;
    return new Date(iso).toLocaleDateString();
  };
}

/**
 * Confluence section on the /knowledge-core page. Mirrors the Google Drive
 * section (single OAuth connection) — three states: not connected, connected
 * with no sources, connected with ≥1 imported source (Re-sync rows).
 *
 * Also owns the OAuth callback toast: reads `?confluence=connected` /
 * `?confluence=error=...` on mount, toasts, and scrubs the param.
 */
export function ConfluenceSection() {
  const { t } = useLanguage();
  const relativeTime = makeRelativeTime(t);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["confluence", "status"],
    queryFn: fetchConfluenceStatus,
  });

  const connected = status?.connected === true;

  const { data: sources = [] } = useQuery({
    queryKey: ["confluence", "sources"],
    queryFn: fetchConfluenceSources,
    enabled: connected,
  });

  const { data: importProgress } = useQuery<ConfluenceImportProgress | null>({
    queryKey: ["confluence", "import-progress"],
    queryFn: fetchConfluenceImportProgress,
    enabled: connected,
    refetchInterval: (query) => {
      const p = query.state.data;
      if (p && (p.phase === "scanning" || p.phase === "importing")) return 2000;
      return false;
    },
    staleTime: 0,
  });

  useEffect(() => {
    const flag = searchParams.get("confluence");
    if (!flag) return;
    if (flag === "connected") {
      toast.success(t("confluence.connected"));
      void queryClient.invalidateQueries({ queryKey: ["confluence"] });
    } else if (flag.startsWith("error=")) {
      const reason = flag.slice("error=".length);
      toast.error(`${t("confluence.connectErr")} ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("confluence");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const disconnectMutation = useMutation({
    mutationFn: disconnectConfluence,
    onSuccess: () => {
      toast.success(t("confluence.disconnected"));
      void queryClient.invalidateQueries({ queryKey: ["confluence"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("confluence.failedDisconnect"),
      ),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncConfluenceSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info(t("confluence.upToDate"));
      } else {
        toast.success(
          `${t("confluence.importedN1")} ${result.added} ${result.added === 1 ? t("confluence.importedN2") : t("confluence.importedN2Plural")}.`,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["confluence", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("confluence.resyncFailed"),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConfluenceSource(id),
    onSuccess: () => {
      toast.success(t("confluence.sourceRemoved"));
      void queryClient.invalidateQueries({
        queryKey: ["confluence", "sources"],
      });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("confluence.couldntRemove"),
      ),
  });

  const importInProgress =
    importProgress?.phase === "scanning" ||
    importProgress?.phase === "importing" ||
    resyncMutation.isPending;

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">
          {t("confluence.checking")}
        </span>
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <BookOpen className="h-4 w-4 text-primary-6" />
          </span>
          <div className="flex flex-col">
            <p className="text-[14px] font-medium text-text-1">
              {t("confluence.connectTitle")}
            </p>
            <p className="text-[12px] text-text-3">
              {t("confluence.connectDesc")}
            </p>
          </div>
        </div>
        <Button
          onClick={() => connectConfluence()}
          variant="outline"
          className="cursor-pointer gap-2 text-[13px]"
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t("confluence.connect")}
        </Button>
      </section>
    );
  }

  const reauthRequired = status?.status === "reauth_required";

  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                reauthRequired ? "bg-warning-1" : "bg-primary-1"
              }`}
            >
              {reauthRequired ? (
                <AlertTriangle className="h-4 w-4 text-warning-7" />
              ) : (
                <BookOpen className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired
                  ? t("confluence.needsReconnect")
                  : t("confluence.title")}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? t("confluence.cantReach")
                  : status?.accountEmail
                    ? `${t("confluence.connectedAs")} ${status.accountEmail}`
                    : t("confluence.connectedSimple")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reauthRequired ? (
              <Button
                onClick={() => connectConfluence()}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px]"
              >
                {t("confluence.reconnect")}
              </Button>
            ) : (
              <DisabledReasonTooltip
                disabled={importInProgress}
                reason={t("confluence.importInProgress")}
              >
                <Button
                  onClick={() => setImportOpen(true)}
                  disabled={importInProgress}
                  variant="outline"
                  className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {t("confluence.importFromConfluence")}
                </Button>
              </DisabledReasonTooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label={t("confluence.options")}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => disconnectMutation.mutate()}
                  className="text-danger-6 focus:text-danger-6"
                >
                  <Unplug className="mr-2 h-3.5 w-3.5" />
                  {t("confluence.disconnect")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
              {t("confluence.importedSources")}
            </p>
            <ul className="flex flex-col gap-1">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-1"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text-1">
                      {s.scope === "space"
                        ? `${s.spaceName} · ${t("confluence.entireSpace")}`
                        : (s.pageTitle ?? s.spaceName)}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.fileCountAtLastSync}{" "}
                      {s.fileCountAtLastSync === 1
                        ? t("confluence.pageSing")
                        : t("confluence.pagePlural")}{" "}
                      · {t("confluence.synced")} {relativeTime(s.lastSyncedAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <DisabledReasonTooltip
                      disabled={importInProgress}
                      reason={t("confluence.importInProgress")}
                    >
                      <button
                        type="button"
                        onClick={() => resyncMutation.mutate(s.id)}
                        disabled={importInProgress}
                        className="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-border-2 px-2 text-[12px] text-text-1 hover:bg-bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {resyncMutation.isPending &&
                        resyncMutation.variables === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {t("confluence.resync")}
                      </button>
                    </DisabledReasonTooltip>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(s.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-white hover:text-danger-6"
                      title={t("confluence.removeSourceTitle")}
                      aria-label={t("confluence.removeSource")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ImportFromConfluenceDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </>
  );
}
