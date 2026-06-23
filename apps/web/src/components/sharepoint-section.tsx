"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  MoreVertical,
  RefreshCw,
  Trash2,
  Unplug,
} from "lucide-react";

import {
  connectSharePoint,
  deleteSharePointSource,
  disconnectSharePoint,
  enableSharePoint,
  fetchOneDriveStatus,
  fetchSharePointSources,
  fetchSharePointStatus,
  resyncSharePointSource,
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
import { ImportFromSharePointDialog } from "@/components/import-from-sharepoint-dialog";
import {
  MicrosoftConnectConfirmDialog,
  type MicrosoftConfirmMode,
} from "@/components/microsoft-connect-confirm-dialog";

function makeRelativeTime(t: (k: TranslationKey) => string) {
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return t("sharepoint.justNow");
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}${t("sharepoint.mAgo")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}${t("sharepoint.hAgo")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}${t("sharepoint.dAgo")}`;
    return new Date(iso).toLocaleDateString();
  };
}

export function SharePointSection({
  mode,
}: {
  mode: "connection" | "import";
}) {
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
    queryKey: ["sharepoint", "status"],
    queryFn: fetchSharePointStatus,
  });
  const { data: odStatus } = useQuery({
    queryKey: ["onedrive", "status"],
    queryFn: fetchOneDriveStatus,
  });

  const connected = status?.connected === true;
  const microsoftConnectionExists =
    status?.connectionExists === true ||
    odStatus?.connectionExists === true;
  const odEnabled = odStatus?.connected === true;

  const { data: sources = [] } = useQuery({
    queryKey: ["sharepoint", "sources"],
    queryFn: fetchSharePointSources,
    enabled: connected && mode === "import",
  });

  useEffect(() => {
    if (mode !== "connection") return;
    const flag = searchParams.get("sharepoint");
    if (!flag) return;
    if (flag === "connected") {
      toast.success(t("sharepoint.connected"));
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
    } else if (flag.startsWith("error=")) {
      const reason = flag.slice("error=".length);
      toast.error(`${t("sharepoint.connectErr")} ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("sharepoint");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const enableMutation = useMutation({
    mutationFn: enableSharePoint,
    onSuccess: () => {
      toast.success(t("sharepoint.enabled"));
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("sharepoint.failedEnable"),
      ),
  });

  const disconnectMutation = useMutation({
    mutationFn: (both: boolean) => disconnectSharePoint(both),
    onSuccess: () => {
      toast.success(t("sharepoint.disconnected"));
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("sharepoint.failedDisconnect"),
      ),
  });

  const handleConnectClick = () => {
    if (microsoftConnectionExists) {
      setConfirmMode({ kind: "connectAddon", primary: "sharepoint" });
    } else {
      setConfirmMode({ kind: "connectInitial", primary: "sharepoint" });
    }
  };

  const handleConnectConfirm = (
    products: ("sharepoint" | "onedrive")[],
  ) => {
    if (confirmMode?.kind === "connectAddon") {
      enableMutation.mutate();
      return;
    }
    connectSharePoint(products);
  };

  const handleDisconnectClick = () => {
    setConfirmMode({ kind: "disconnect", primary: "sharepoint" });
  };

  const handleDisconnectConfirm = (both: boolean) => {
    disconnectMutation.mutate(both);
  };

  void odEnabled;

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncSharePointSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info(t("sharepoint.upToDate"));
      } else {
        const noun =
          result.added === 1
            ? t("sharepoint.importedN2")
            : t("sharepoint.importedN2Plural");
        toast.success(
          `${t("sharepoint.importedN1")} ${result.added} ${noun}.`,
        );
      }
      if (result.skippedTooLarge > 0) {
        const noun =
          result.skippedTooLarge === 1
            ? t("sharepoint.skipped2")
            : t("sharepoint.skipped2Plural");
        toast.warning(
          `${t("sharepoint.skipped1")} ${result.skippedTooLarge} ${noun} ${t("sharepoint.skipped3")}`,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("sharepoint.resyncFailed"),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSharePointSource(id),
    onSuccess: () => {
      toast.success(t("sharepoint.sourceRemoved"));
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "sources"],
      });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("sharepoint.couldntRemove"),
      ),
  });

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">{t("sharepoint.checking")}</span>
      </section>
    );
  }

  const reauthRequired = status?.status === "reauth_required";

  if (!connected) {
    if (mode === "import") {
      return (
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
              <FolderOpen className="h-4 w-4 text-primary-6" />
            </span>
            <p className="text-[13px] text-text-3">
              {t("sharepoint.connectInSettings")}
            </p>
          </div>
          <Link
            href="/teams?tab=integration"
            className="text-[13px] font-medium text-primary-6 hover:underline"
          >
            {t("sharepoint.goToSettings")}
          </Link>
        </section>
      );
    }

    return (
      <>
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
              <FolderOpen className="h-4 w-4 text-primary-6" />
            </span>
            <div className="flex flex-col">
              <p className="text-[14px] font-medium text-text-1">
                {t("sharepoint.connectTitle")}
              </p>
              <p className="text-[12px] text-text-3">
                {t("sharepoint.connectDesc")}
              </p>
            </div>
          </div>
          <Button
            onClick={handleConnectClick}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("sharepoint.connect")}
          </Button>
        </section>
        <MicrosoftConnectConfirmDialog
          open={confirmMode !== null}
          onOpenChange={(o) => !o && setConfirmMode(null)}
          mode={confirmMode}
          onConnectConfirm={handleConnectConfirm}
          loading={enableMutation.isPending}
        />
      </>
    );
  }

  // Import mode + reauth required → same hint card as not-connected.
  if (mode === "import" && reauthRequired) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <FolderOpen className="h-4 w-4 text-primary-6" />
          </span>
          <p className="text-[13px] text-text-3">
            {t("sharepoint.connectInSettings")}
          </p>
        </div>
        <Link
          href="/teams?tab=integration"
          className="text-[13px] font-medium text-primary-6 hover:underline"
        >
          {t("sharepoint.goToSettings")}
        </Link>
      </section>
    );
  }

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
                <FolderOpen className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired
                  ? t("sharepoint.needsReconnect")
                  : t("sharepoint.title")}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? t("sharepoint.cantReach")
                  : status?.accountEmail
                    ? `${t("sharepoint.connectedAs")} ${status.accountEmail}`
                    : t("sharepoint.connectedSimple")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {mode === "import" ? (
              <Button
                onClick={() => setImportOpen(true)}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("sharepoint.importFromSharePoint")}
              </Button>
            ) : (
              <>
                {reauthRequired && (
                  <Button
                    onClick={handleConnectClick}
                    variant="outline"
                    className="cursor-pointer gap-2 text-[13px]"
                  >
                    {t("sharepoint.reconnect")}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                      aria-label={t("sharepoint.options")}
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
                      {t("sharepoint.disconnect")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </header>

        {sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
              {t("sharepoint.importedSources")}
            </p>
            <ul className="flex flex-col gap-1">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-1"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text-1">
                      {s.displayName}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.scope === "site"
                        ? t("sharepoint.entireSite")
                        : `${t("sharepoint.folderIn")} ${s.siteName}`}
                      {" · "}
                      {s.fileCountAtLastSync}{" "}
                      {s.fileCountAtLastSync === 1
                        ? t("sharepoint.fileSing")
                        : t("sharepoint.filePlural")}{" "}
                      · {t("sharepoint.synced")} {relativeTime(s.lastSyncedAt)}
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
                      {t("sharepoint.resync")}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(s.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-white hover:text-danger-6"
                      title={t("sharepoint.removeSourceTitle")}
                      aria-label={t("sharepoint.removeSource")}
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

      {mode === "import" && (
        <ImportFromSharePointDialog
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}

      {mode === "connection" && (
        <MicrosoftConnectConfirmDialog
          open={confirmMode !== null}
          onOpenChange={(o) => !o && setConfirmMode(null)}
          mode={confirmMode}
          onConnectConfirm={handleConnectConfirm}
          onDisconnectConfirm={handleDisconnectConfirm}
          loading={
            enableMutation.isPending || disconnectMutation.isPending
          }
        />
      )}
    </>
  );
}
