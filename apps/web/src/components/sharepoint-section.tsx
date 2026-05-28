"use client";

import { useEffect, useState } from "react";
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
  fetchSharePointSources,
  fetchSharePointStatus,
  resyncSharePointSource,
} from "@/lib/api";
import { relativeTime } from "@/lib/relative-time";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportFromSharePointDialog } from "@/components/import-from-sharepoint-dialog";

/**
 * SharePoint section on the /knowledge-core page. Same three states
 * as DriveSection: not connected → connected → connected with sources.
 *
 * Owns the SharePoint OAuth callback toast: reads
 * `?sharepoint=connected` / `?sharepoint=error=...` on mount and
 * scrubs the param so a refresh doesn't re-toast.
 */
export function SharePointSection() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [importOpen, setImportOpen] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["sharepoint", "status"],
    queryFn: fetchSharePointStatus,
  });

  const connected = status?.connected === true;

  const { data: sources = [] } = useQuery({
    queryKey: ["sharepoint", "sources"],
    queryFn: fetchSharePointSources,
    enabled: connected,
  });

  useEffect(() => {
    const flag = searchParams.get("sharepoint");
    if (!flag) return;
    if (flag === "connected") {
      toast.success("SharePoint connected.");
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
    } else if (flag.startsWith("error=")) {
      const reason = flag.slice("error=".length);
      toast.error(`Couldn't connect SharePoint: ${reason}`);
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("sharepoint");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const disconnectMutation = useMutation({
    mutationFn: disconnectSharePoint,
    onSuccess: () => {
      toast.success("SharePoint disconnected.");
      void queryClient.invalidateQueries({ queryKey: ["sharepoint"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to disconnect"),
  });

  const resyncMutation = useMutation({
    mutationFn: (id: string) => resyncSharePointSource(id),
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
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Re-sync failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSharePointSource(id),
    onSuccess: () => {
      toast.success("SharePoint source removed.");
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "sources"],
      });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Couldn't remove source",
      ),
  });

  if (statusLoading) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-text-3" />
        <span className="text-[13px] text-text-3">Checking SharePoint…</span>
      </section>
    );
  }

  if (!connected) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-1">
            <FolderOpen className="h-4 w-4 text-primary-6" />
          </span>
          <div className="flex flex-col">
            <p className="text-[14px] font-medium text-text-1">
              Connect SharePoint
            </p>
            <p className="text-[12px] text-text-3">
              Import documents from any SharePoint site you have access to.
            </p>
          </div>
        </div>
        <Button
          onClick={() => connectSharePoint()}
          variant="outline"
          className="cursor-pointer gap-2 text-[13px]"
        >
          <FolderOpen className="h-3.5 w-3.5" />
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
                <FolderOpen className="h-4 w-4 text-primary-6" />
              )}
            </span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-[14px] font-medium text-text-1">
                {reauthRequired
                  ? "SharePoint needs reconnecting"
                  : "SharePoint"}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {reauthRequired
                  ? "We can't reach your SharePoint — reconnect to keep importing."
                  : status?.accountEmail
                    ? `Connected as ${status.accountEmail}`
                    : "Connected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reauthRequired ? (
              <Button
                onClick={() => connectSharePoint()}
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
                <FolderOpen className="h-3.5 w-3.5" />
                Import from SharePoint
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  aria-label="SharePoint options"
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
                      {s.displayName}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {s.scope === "site" ? "Entire site" : `Folder in ${s.siteName}`}
                      {" · "}
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

      <ImportFromSharePointDialog
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </>
  );
}
