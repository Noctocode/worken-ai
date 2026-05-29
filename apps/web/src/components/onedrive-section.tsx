"use client";

import { useEffect, useMemo, useState } from "react";
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
  connectOneDrive,
  deleteOneDriveSource,
  disconnectOneDrive,
  enableOneDrive,
  fetchOneDriveSources,
  fetchOneDriveStatus,
  fetchSharePointStatus,
  resyncOneDriveSource,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportFromOneDriveDialog } from "@/components/import-from-onedrive-dialog";
import {
  MicrosoftConnectConfirmDialog,
  type MicrosoftConfirmMode,
} from "@/components/microsoft-connect-confirm-dialog";

function makeRelativeTime(t: (k: TranslationKey) => string) {
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("onedrive.justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${t("onedrive.mAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("onedrive.hAgo")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${t("onedrive.dAgo")}`;
    return new Date(iso).toLocaleDateString();
  };
}

export function OneDriveSection() {
  const { t } = useLanguage();
  const relativeTime = makeRelativeTime(t);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<MicrosoftConfirmMode | null>(
    null,
  );

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["onedrive", "status"],
    queryFn: fetchOneDriveStatus,
  });
  const { data: spStatus } = useQuery({
    queryKey: ["sharepoint", "status"],
    queryFn: fetchSharePointStatus,
  });

  const connected = status?.connected === true;
  const microsoftConnectionExists =
    status?.connectionExists === true ||
    spStatus?.connectionExists === true;
  const spEnabled = spStatus?.connected === true;

  const { data: sources = [] } = useQuery({
    queryKey: ["onedrive", "sources"],
    queryFn: fetchOneDriveSources,
    enabled: connected,
  });

  useEffect(() => {
    const flag = searchParams.get("onedrive");
    if (!flag) return;
    if (flag === "connected") {
      toast.success(t("onedrive.connected"));
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
    } else if (flag.startsWith("error=")) {
      const reason = flag.slice("error=".length);
      toast.error(`${t("onedrive.connectErr")} ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("onedrive");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const enableMutation = useMutation({
    mutationFn: enableOneDrive,
    onSuccess: () => {
      toast.success(t("onedrive.enabled"));
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("onedrive.failedEnable"),
      ),
  });

  const disconnectMutation = useMutation({
    mutationFn: (both: boolean) => disconnectOneDrive(both),
    onSuccess: () => {
      toast.success(t("onedrive.disconnected"));
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("onedrive.failedDisconnect"),
      ),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncOneDriveSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info(t("onedrive.upToDate"));
      } else {
        const noun =
          result.added === 1
            ? t("onedrive.importedN2")
            : t("onedrive.importedN2Plural");
        toast.success(
          `${t("onedrive.importedN1")} ${result.added} ${noun}.`,
        );
      }
      if (result.skippedTooLarge > 0) {
        const noun =
          result.skippedTooLarge === 1
            ? t("onedrive.skipped2")
            : t("onedrive.skipped2Plural");
        toast.warning(
          `${t("onedrive.skipped1")} ${result.skippedTooLarge} ${noun} ${t("onedrive.skipped3")}`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["onedrive", "sources"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("onedrive.resyncFailed"),
      ),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) => deleteOneDriveSource(id),
    onSuccess: () => {
      toast.success(t("onedrive.sourceRemoved"));
      void queryClient.invalidateQueries({ queryKey: ["onedrive", "sources"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("onedrive.couldntRemove"),
      ),
  });

  const handleConnectClick = () => {
    if (microsoftConnectionExists) {
      setConfirmMode({ kind: "connectAddon", primary: "onedrive" });
    } else {
      setConfirmMode({ kind: "connectInitial", primary: "onedrive" });
    }
  };

  const handleConnectConfirm = (
    products: ("sharepoint" | "onedrive")[],
  ) => {
    if (confirmMode?.kind === "connectAddon") {
      enableMutation.mutate();
      return;
    }
    connectOneDrive(products);
  };

  const handleDisconnectClick = () => {
    setConfirmMode({ kind: "disconnect", primary: "onedrive" });
  };

  const handleDisconnectConfirm = (both: boolean) => {
    disconnectMutation.mutate(both);
  };

  const disconnectShowsBoth = spEnabled;
  const effectiveConfirmMode = useMemo<MicrosoftConfirmMode | null>(() => {
    if (!confirmMode) return null;
    if (confirmMode.kind === "disconnect" && !disconnectShowsBoth) {
      return confirmMode;
    }
    return confirmMode;
  }, [confirmMode, disconnectShowsBoth]);

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">{t("onedrive.checking")}</span>
      </section>
    );
  }

  if (!connected) {
    return (
      <>
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
              <Cloud className="h-4 w-4 text-primary-6" />
            </span>
            <div className="flex flex-col">
              <p className="text-[14px] font-medium text-text-1">
                {t("onedrive.connectTitle")}
              </p>
              <p className="text-[12px] text-text-3">
                {t("onedrive.connectDesc")}
              </p>
            </div>
          </div>
          <Button
            onClick={handleConnectClick}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <Cloud className="h-3.5 w-3.5" />
            {t("onedrive.connect")}
          </Button>
        </section>
        <MicrosoftConnectConfirmDialog
          open={confirmMode !== null}
          onOpenChange={(o) => !o && setConfirmMode(null)}
          mode={effectiveConfirmMode}
          onConnectConfirm={handleConnectConfirm}
          loading={enableMutation.isPending}
        />
      </>
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
                <Cloud className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired
                  ? t("onedrive.needsReconnect")
                  : t("onedrive.title")}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? t("onedrive.cantReach")
                  : status?.accountEmail
                    ? `${t("onedrive.connectedAs")} ${status.accountEmail}`
                    : t("onedrive.connectedSimple")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reauthRequired ? (
              <Button
                onClick={handleConnectClick}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px]"
              >
                {t("onedrive.reconnect")}
              </Button>
            ) : (
              <Button
                onClick={() => setImportOpen(true)}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
              >
                <Cloud className="h-3.5 w-3.5" />
                {t("onedrive.importFromOneDrive")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label={t("onedrive.options")}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={handleDisconnectClick}
                  className="text-danger-6 focus:text-danger-6"
                >
                  <Unplug className="mr-2 h-3.5 w-3.5" />
                  {t("onedrive.disconnect")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
              {t("onedrive.importedSources")}
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
                        ? t("onedrive.entireOneDrive")
                        : s.onedriveFolderName}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.fileCountAtLastSync}{" "}
                      {s.fileCountAtLastSync === 1
                        ? t("onedrive.fileSing")
                        : t("onedrive.filePlural")}{" "}
                      · {t("onedrive.synced")} {relativeTime(s.lastSyncedAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resyncMutation.mutate(s.id)}
                      disabled={
                        resyncMutation.isPending &&
                        resyncMutation.variables === s.id
                      }
                      className="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-border-2 px-2 text-[12px] text-text-1 hover:bg-bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resyncMutation.isPending &&
                      resyncMutation.variables === s.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      {t("onedrive.resync")}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSourceMutation.mutate(s.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-white hover:text-danger-6"
                      title={t("onedrive.removeSourceTitle")}
                      aria-label={t("onedrive.removeSource")}
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

      <ImportFromOneDriveDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />

      <MicrosoftConnectConfirmDialog
        open={confirmMode !== null}
        onOpenChange={(o) => !o && setConfirmMode(null)}
        mode={effectiveConfirmMode}
        onConnectConfirm={handleConnectConfirm}
        onDisconnectConfirm={handleDisconnectConfirm}
        loading={
          enableMutation.isPending || disconnectMutation.isPending
        }
      />
    </>
  );
}
