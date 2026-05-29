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
import { relativeTime } from "@/lib/relative-time";
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

/**
 * OneDrive section on the /knowledge-core page. Same three states as
 * DriveSection (not connected / connected / connected with sources)
 * PLUS a confirm dialog before connect or disconnect, since OneDrive
 * shares its Microsoft OAuth connection with SharePoint:
 *
 *   - Connect when no Microsoft connection exists → dialog asks
 *     "Both products / Just OneDrive / Cancel" and redirects to the
 *     OAuth flow with the chosen products.
 *   - Connect when Microsoft is already connected via SharePoint →
 *     dialog asks "Enable OneDrive / Cancel" and just POSTs /enable
 *     (no OAuth round-trip).
 *   - Disconnect → dialog asks "Just OneDrive / Both products /
 *     Cancel" and calls /onedrive/connection?both=...
 */
export function OneDriveSection() {
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
  // Read SharePoint status too so the confirm dialog can pick the
  // right mode (initial / addon / disconnect-with-other-still-on).
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

  // OAuth callback toast handling.
  useEffect(() => {
    const flag = searchParams.get("onedrive");
    if (!flag) return;
    if (flag === "connected") {
      toast.success("OneDrive connected.");
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
    } else if (flag.startsWith("error=")) {
      const reason = flag.slice("error=".length);
      toast.error(`Couldn't connect OneDrive: ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("onedrive");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Connect/disconnect mutations ────────────────────────────────
  const enableMutation = useMutation({
    mutationFn: enableOneDrive,
    onSuccess: () => {
      toast.success("OneDrive enabled.");
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to enable"),
  });

  const disconnectMutation = useMutation({
    mutationFn: (both: boolean) => disconnectOneDrive(both),
    onSuccess: () => {
      toast.success("OneDrive disconnected.");
      void queryClient.invalidateQueries({ queryKey: ["onedrive"] });
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
      setConfirmMode(null);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disconnect"),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncOneDriveSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info("Up to date — no new files.");
      } else {
        toast.success(
          `Imported ${result.added} new file${result.added === 1 ? "" : "s"}.`,
        );
      }
      if (result.skippedTooLarge > 0) {
        toast.warning(
          `Skipped ${result.skippedTooLarge} file${result.skippedTooLarge === 1 ? "" : "s"} larger than 50MB.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["onedrive", "sources"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Re-sync failed"),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) => deleteOneDriveSource(id),
    onSuccess: () => {
      toast.success("OneDrive source removed.");
      void queryClient.invalidateQueries({ queryKey: ["onedrive", "sources"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove source",
      ),
  });

  // ── Confirm dialog mode logic ───────────────────────────────────
  const handleConnectClick = () => {
    if (microsoftConnectionExists) {
      // Microsoft already connected (via SharePoint) — just enable.
      setConfirmMode({ kind: "connectAddon", primary: "onedrive" });
    } else {
      // No Microsoft connection — full OAuth, optionally enable both.
      setConfirmMode({ kind: "connectInitial", primary: "onedrive" });
    }
  };

  const handleConnectConfirm = (
    products: ("sharepoint" | "onedrive")[],
  ) => {
    if (confirmMode?.kind === "connectAddon") {
      // No OAuth — just toggle the flag.
      enableMutation.mutate();
      return;
    }
    // connectInitial → kick off OAuth flow with the chosen products.
    connectOneDrive(products);
  };

  const handleDisconnectClick = () => {
    setConfirmMode({ kind: "disconnect", primary: "onedrive" });
  };

  const handleDisconnectConfirm = (both: boolean) => {
    disconnectMutation.mutate(both);
  };

  // Show "disconnect both" option only if SharePoint is also enabled —
  // otherwise the dialog hides the two-step choice and just confirms
  // a full disconnect.
  const disconnectShowsBoth = spEnabled;
  const effectiveConfirmMode = useMemo<MicrosoftConfirmMode | null>(() => {
    if (!confirmMode) return null;
    if (confirmMode.kind === "disconnect" && !disconnectShowsBoth) {
      // SharePoint isn't enabled; "Both" doesn't make sense — but the
      // dialog component handles this by including both buttons. We
      // simplify by mapping a no-SP disconnect through the same dialog
      // and treating the "Both" click as a full delete (same outcome).
      return confirmMode;
    }
    return confirmMode;
  }, [confirmMode, disconnectShowsBoth]);

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">Checking OneDrive…</span>
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
                Connect OneDrive
              </p>
              <p className="text-[12px] text-text-3">
                Import documents from your personal OneDrive for Business.
              </p>
            </div>
          </div>
          <Button
            onClick={handleConnectClick}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px]"
          >
            <Cloud className="h-3.5 w-3.5" />
            Connect
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
                  ? "OneDrive needs reconnecting"
                  : "OneDrive"}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? "We can't reach your OneDrive — reconnect to keep importing."
                  : status?.accountEmail
                    ? `Connected as ${status.accountEmail}`
                    : "Connected"}
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
                Reconnect
              </Button>
            ) : (
              <Button
                onClick={() => setImportOpen(true)}
                variant="outline"
                className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
              >
                <Cloud className="h-3.5 w-3.5" />
                Import from OneDrive
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label="OneDrive options"
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
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {sources.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border-2 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-3">
              Imported sources
            </p>
            <ul className="flex flex-col gap-1">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-1"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-text-1">
                      {s.scope === "all" ? "Entire OneDrive" : s.onedriveFolderName}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.fileCountAtLastSync} file
                      {s.fileCountAtLastSync === 1 ? "" : "s"} · synced{" "}
                      {relativeTime(s.lastSyncedAt)}
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
                      Re-sync
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSourceMutation.mutate(s.id)}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-white hover:text-danger-6"
                      title="Remove source (keeps imported files)"
                      aria-label="Remove source"
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
