"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Cloud,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";

import {
  connectDrive,
  deleteDriveSource,
  disconnectDrive,
  fetchDriveImportProgress,
  fetchDriveSources,
  fetchDriveStatus,
  resyncDriveSource,
  type DriveImportProgress,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportFromDriveDialog } from "@/components/import-from-drive-dialog";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

function makeRelativeTime(t: (k: TranslationKey) => string) {
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("drive.justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${t("drive.mAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("drive.hAgo")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${t("drive.dAgo")}`;
    return new Date(iso).toLocaleDateString();
  };
}

/**
 * Google Drive section on the /knowledge-core page. Three states:
 *   - not connected: "Connect Google Drive" CTA
 *   - connected, no sources yet: "Import from Drive" prompt
 *   - connected, ≥1 source: import button + per-source Re-sync rows
 *
 * Mounted just below the upload dropzone so the user's eye lands on
 * KC's two onboarding paths in order: drag-drop (left/top), Drive
 * import (right/below).
 *
 * Also owns the OAuth callback toast: reads `?drive=connected` /
 * `?drive=error=...` on mount, toasts accordingly, and scrubs the
 * param so a refresh doesn't re-toast.
 */
export function DriveSection({ mode }: { mode: "connection" | "import" }) {
  const { t } = useLanguage();
  const relativeTime = makeRelativeTime(t);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["drive", "status"],
    queryFn: fetchDriveStatus,
  });

  const connected = status?.connected === true;

  const { data: sources = [] } = useQuery({
    queryKey: ["drive", "sources"],
    queryFn: fetchDriveSources,
    // Only ask the BE for sources once we know the user has a
    // connection — saves a wasted round-trip for first-time visitors.
    enabled: connected && mode === "import",
  });

  // Background Entire-Drive import status. Shared cache key with the
  // import dialog, so a job started there reflects here too. Keeps
  // polling on its own while a job is scanning/importing even after the
  // dialog is closed, so the trigger buttons stay locked until it ends.
  const { data: importProgress } = useQuery<DriveImportProgress | null>({
    queryKey: ["drive", "import-progress"],
    queryFn: fetchDriveImportProgress,
    enabled: connected && mode === "import",
    refetchInterval: (query) => {
      const p = query.state.data;
      if (p && (p.phase === "scanning" || p.phase === "importing")) return 2000;
      return false;
    },
    staleTime: 0,
  });

  // OAuth callback toast. The API redirects back to
  // /knowledge-core?drive=connected | ?drive=error=... once the
  // consent round-trip finishes. We toast based on the flag and
  // scrub it so navigating back / refreshing doesn't re-toast.
  useEffect(() => {
    const flag = searchParams.get("drive");
    if (!flag) return;
    // The backend redirects the OAuth callback to the Integrations tab,
    // so only the connection-mode instance should own this toast.
    if (mode !== "connection") return;
    if (flag === "connected") {
      toast.success(t("drive.connected"));
      void queryClient.invalidateQueries({ queryKey: ["drive"] });
    } else if (flag.startsWith("error=")) {
      // searchParams.get() already decodes percent-sequences; a second
      // decodeURIComponent would throw on a literal '%' in the message.
      const reason = flag.slice("error=".length);
      toast.error(`${t("drive.connectErr")} ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("drive");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const disconnectMutation = useMutation({
    mutationFn: disconnectDrive,
    onSuccess: () => {
      toast.success(t("drive.disconnected"));
      void queryClient.invalidateQueries({ queryKey: ["drive"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("drive.failedDisconnect"),
      ),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncDriveSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info(t("drive.upToDate"));
      } else {
        toast.success(
          `${t("drive.importedN1")} ${result.added} ${result.added === 1 ? t("drive.importedN2") : t("drive.importedN2Plural")}.`,
        );
      }
      // Surface the size-cap skip count separately — fires whenever
      // Re-sync ran but some files were over the per-file cap. The
      // user sees Re-sync as "I asked for new files; did I get all
      // of them?", so a silent skip would be misleading.
      if (result.skippedTooLarge > 0) {
        toast.warning(
          `${t("drive.skipped1")} ${result.skippedTooLarge} ${result.skippedTooLarge === 1 ? t("drive.skipped2") : t("drive.skipped2Plural")} ${t("drive.skipped3")}`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
      // New files land in KC immediately as 'pending' — refresh the
      // file lists so the user sees them appear.
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t("drive.resyncFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDriveSource(id),
    onSuccess: () => {
      toast.success(t("drive.sourceRemoved"));
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("drive.couldntRemove"),
      ),
  });

  // True while any import is mid-flight — a background Entire-Drive job
  // or a per-source Re-sync. Used to lock the trigger buttons (with a
  // hover tooltip) so the user can't kick off overlapping imports.
  const importInProgress =
    importProgress?.phase === "scanning" ||
    importProgress?.phase === "importing" ||
    resyncMutation.isPending;

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">{t("drive.checking")}</span>
      </section>
    );
  }

  const reauthRequired = status?.status === "reauth_required";

  // Connection mode owns the not-connected CTA — the import-mode
  // equivalent is the "connect in Settings" hint card below.
  if (mode === "connection" && !connected) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <Cloud className="h-4 w-4 text-primary-6" />
          </span>
          <div className="flex flex-col">
            <p className="text-[14px] font-medium text-text-1">
              {t("drive.connectTitle")}
            </p>
            <p className="text-[12px] text-text-3">{t("drive.connectDesc")}</p>
          </div>
        </div>
        <Button
          onClick={() => connectDrive()}
          variant="outline"
          className="cursor-pointer gap-2 text-[13px]"
        >
          <Cloud className="h-3.5 w-3.5" />
          {t("drive.connect")}
        </Button>
      </section>
    );
  }

  // Import mode can't import without a usable connection. When the Drive
  // is unconnected or needs reauth, point the user to Settings where the
  // connection lives, rather than offering a connect button here.
  if (mode === "import" && (!connected || reauthRequired)) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <Cloud className="h-4 w-4 text-primary-6" />
          </span>
          <p className="text-[13px] text-text-3">
            {t("drive.connectInSettings")}
          </p>
        </div>
        <Link
          href="/teams?tab=integration"
          className="text-[13px] font-medium text-primary-6 hover:underline"
        >
          {t("drive.goToSettings")}
        </Link>
      </section>
    );
  }

  if (mode === "connection") {
    return (
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
                <Cloud className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired ? t("drive.needsReconnect") : t("drive.title")}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? t("drive.cantReach")
                  : status?.accountEmail
                    ? `${t("drive.connectedAs")} ${status.accountEmail}`
                    : t("drive.connectedSimple")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reauthRequired && (
              <Button
                onClick={() => connectDrive()}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px]"
              >
                {t("drive.reconnect")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label={t("drive.options")}
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
                  {t("drive.disconnect")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
      </section>
    );
  }

  // mode === "import", connected and not reauth-required.
  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-1">
              <Cloud className="h-4 w-4 text-primary-6" />
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {t("drive.title")}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {status?.accountEmail
                  ? `${t("drive.connectedAs")} ${status.accountEmail}`
                  : t("drive.connectedSimple")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DisabledReasonTooltip
              disabled={importInProgress}
              reason={t("drive.importInProgress")}
            >
              <Button
                onClick={() => setImportOpen(true)}
                disabled={importInProgress}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
              >
                <Cloud className="h-3.5 w-3.5" />
                {t("drive.importFromDrive")}
              </Button>
            </DisabledReasonTooltip>
          </div>
        </header>

        {sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
              {t("drive.importedSources")}
            </p>
            <ul className="flex flex-col gap-1">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-1"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text-1">
                      {s.scope === "all"
                        ? t("drive.entireDrive")
                        : s.driveFolderName}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.fileCountAtLastSync}{" "}
                      {s.fileCountAtLastSync === 1
                        ? t("drive.fileSing")
                        : t("drive.filePlural")}{" "}
                      · {t("drive.synced")} {relativeTime(s.lastSyncedAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <DisabledReasonTooltip
                      disabled={importInProgress}
                      reason={t("drive.importInProgress")}
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
                        {t("drive.resync")}
                      </button>
                    </DisabledReasonTooltip>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(s.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-white hover:text-danger-6"
                      title={t("drive.removeSourceTitle")}
                      aria-label={t("drive.removeSource")}
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

      <ImportFromDriveDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
