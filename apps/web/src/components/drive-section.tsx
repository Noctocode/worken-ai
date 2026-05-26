"use client";

import { useEffect, useState } from "react";
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
  fetchDriveSources,
  fetchDriveStatus,
  resyncDriveSource,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportFromDriveDialog } from "@/components/import-from-drive-dialog";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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
export function DriveSection() {
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
    enabled: connected,
  });

  // OAuth callback toast. The API redirects back to
  // /knowledge-core?drive=connected | ?drive=error=... once the
  // consent round-trip finishes. We toast based on the flag and
  // scrub it so navigating back / refreshing doesn't re-toast.
  useEffect(() => {
    const flag = searchParams.get("drive");
    if (!flag) return;
    if (flag === "connected") {
      toast.success("Google Drive connected.");
      void queryClient.invalidateQueries({ queryKey: ["drive"] });
    } else if (flag.startsWith("error=")) {
      const reason = decodeURIComponent(flag.slice("error=".length));
      toast.error(`Couldn't connect Google Drive: ${reason}`);
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
      toast.success("Google Drive disconnected.");
      void queryClient.invalidateQueries({ queryKey: ["drive"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disconnect"),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncDriveSource(id),
    onSuccess: (result) => {
      if (result.added === 0) {
        toast.info("Up to date — no new files.");
      } else {
        toast.success(
          `Imported ${result.added} new file${result.added === 1 ? "" : "s"}.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
      // New files land in KC immediately as 'pending' — refresh the
      // file lists so the user sees them appear.
      void queryClient.invalidateQueries({ queryKey: ["knowledgeFolders"] });
      void queryClient.invalidateQueries({ queryKey: ["recentKnowledgeFiles"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Re-sync failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDriveSource(id),
    onSuccess: () => {
      toast.success("Drive source removed.");
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Couldn't remove source"),
  });

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">Checking Google Drive…</span>
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <Cloud className="h-4 w-4 text-primary-6" />
          </span>
          <div className="flex flex-col">
            <p className="text-[14px] font-medium text-text-1">
              Connect Google Drive
            </p>
            <p className="text-[12px] text-text-3">
              Import documents from your Drive — whole account or specific
              folders.
            </p>
          </div>
        </div>
        <Button
          onClick={() => connectDrive()}
          variant="outline"
          className="cursor-pointer gap-2 text-[13px]"
        >
          <Cloud className="h-3.5 w-3.5" />
          Connect
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
                <Cloud className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired
                  ? "Google Drive needs reconnecting"
                  : "Google Drive"}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? "We can't reach your Drive — reconnect to keep importing."
                  : status?.accountEmail
                    ? `Connected as ${status.accountEmail}`
                    : "Connected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reauthRequired ? (
              <Button
                onClick={() => connectDrive()}
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
                Import from Drive
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label="Drive options"
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
                      {s.scope === "all" ? "Entire Drive" : s.driveFolderName}
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
                      onClick={() => deleteMutation.mutate(s.id)}
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

      <ImportFromDriveDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </>
  );
}
