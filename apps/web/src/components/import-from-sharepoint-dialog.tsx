"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  cancelSharePointImport,
  fetchProjects,
  fetchSharePointDrives,
  fetchSharePointFolders,
  fetchSharePointImportProgress,
  fetchSharePointSites,
  fetchSharePointSiteFileCount,
  fetchTeams,
  importFromSharePoint,
  startSharePointImportAsync,
  type SharePointDrive,
  type SharePointFolder,
  type SharePointImportProgress,
  type KnowledgeFileVisibility,
} from "@/lib/api";
import { useAuth } from "@/components/providers";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ImportScopeChoice = "site" | "folders";

interface FolderNodeProps {
  folder: SharePointFolder;
  depth: number;
  expanded: Set<string>;
  folderMap: Record<string, SharePointFolder[] | undefined>;
  loading: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
}

function FolderNode({
  folder,
  depth,
  expanded,
  folderMap,
  loading,
  selected,
  onToggleExpand,
  onToggleSelect,
}: FolderNodeProps) {
  const isExpanded = expanded.has(folder.id);
  const isLoading = loading.has(folder.id);
  const isSelected = selected.has(folder.id);
  const kids = folderMap[folder.id];

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-1"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => folder.hasChildren && onToggleExpand(folder.id)}
          className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 ${
            folder.hasChildren ? "hover:bg-bg-white hover:text-text-1" : "invisible"
          }`}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(folder.id)}
            className="h-4 w-4 shrink-0 cursor-pointer accent-primary-6"
          />
          <Folder className="h-4 w-4 shrink-0 text-primary-6" strokeWidth={1.5} />
          <span className="truncate text-[13px] text-text-1">{folder.name}</span>
        </label>
      </div>
      {isExpanded && kids && kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              folderMap={folderMap}
              loading={loading}
              selected={selected}
              onToggleExpand={onToggleExpand}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportFromSharePointDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  // Site picker — required first step. Everything else stays disabled
  // until the user picks one.
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [scopeChoice, setScopeChoice] = useState<ImportScopeChoice>("site");
  const [siteImportConfirmed, setSiteImportConfirmed] = useState(false);
  const [visibility, setVisibility] = useState<KnowledgeFileVisibility>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  // Drive (document library) picker. Auto-selects when the site has
  // exactly one drive (the common case) — we keep the state so the
  // user can change it if they have multiple libraries.
  const [selectedDriveId, setSelectedDriveId] = useState<string>("");

  const [asyncJobActive, setAsyncJobActive] = useState(false);
  const handledPhaseRef = useRef<string | null>(null);
  const openCountRef = useRef(0);
  const [openEpoch, setOpenEpoch] = useState(0);

  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "sharepoint-import"],
    queryFn: () => fetchProjects("all"),
    enabled: open,
  });

  // ── Sites ────────────────────────────────────────────────────────
  const {
    data: sites = [],
    isLoading: sitesLoading,
    isError: sitesError,
  } = useQuery({
    // openEpoch bumps on every dialog open → new queryKey → fresh
    // fetch every time. Lets the user click "Follow" on a site in
    // SharePoint, reopen the dialog, and see the new site appear
    // without having to hard-refresh the page.
    queryKey: ["sharepoint", "sites", openEpoch],
    queryFn: fetchSharePointSites,
    enabled: open && openEpoch > 0,
  });

  // Auto-select the first site so users with only one site can skip
  // a click. Multi-site users see a Select.
  useEffect(() => {
    if (!open) return;
    if (selectedSiteId || sites.length === 0) return;
    if (sites.length === 1) setSelectedSiteId(sites[0].id);
  }, [open, sites, selectedSiteId]);

  // ── Drives for the picked site ───────────────────────────────────
  const {
    data: drives = [],
    isLoading: drivesLoading,
  } = useQuery<SharePointDrive[]>({
    queryKey: ["sharepoint", "drives", selectedSiteId, openEpoch],
    queryFn: () => fetchSharePointDrives(selectedSiteId),
    enabled:
      open && openEpoch > 0 && !!selectedSiteId && scopeChoice === "folders",
  });

  useEffect(() => {
    // Auto-pick the drive when there's only one — typical SharePoint
    // site has a single "Documents" drive.
    if (drives.length === 1 && !selectedDriveId) {
      setSelectedDriveId(drives[0].id);
    }
  }, [drives, selectedDriveId]);

  // ── File count estimate for the chosen site (whole-site banner) ──
  const {
    data: fileCountData,
    isLoading: fileCountLoading,
    isError: fileCountError,
  } = useQuery({
    queryKey: ["sharepoint", "file-count", selectedSiteId, openEpoch],
    queryFn: () => fetchSharePointSiteFileCount(selectedSiteId),
    enabled:
      open && openEpoch > 0 && !!selectedSiteId && scopeChoice === "site",
    retry: 1,
  });

  // ── Folder tree (lazy) ──────────────────────────────────────────
  const [rootFolders, setRootFolders] = useState<SharePointFolder[] | null>(
    null,
  );
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [children, setChildren] = useState<
    Record<string, SharePointFolder[] | undefined>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Async progress polling ──────────────────────────────────────
  const { data: progress } = useQuery<SharePointImportProgress | null>({
    queryKey: ["sharepoint", "import-progress"],
    queryFn: fetchSharePointImportProgress,
    enabled: open,
    refetchInterval: (query) => {
      const p = query.state.data;
      if (!p) return asyncJobActive ? 2000 : false;
      if (p.phase === "scanning" || p.phase === "importing") return 2000;
      return false;
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (!open) return;
    if (
      progress?.phase === "scanning" ||
      progress?.phase === "importing"
    ) {
      setAsyncJobActive(true);
    }
  }, [open, progress?.phase]);

  useEffect(() => {
    if (!progress) return;
    const { phase } = progress;
    if (phase === handledPhaseRef.current) return;
    if (phase !== "done" && phase !== "cancelled" && phase !== "error") return;

    handledPhaseRef.current = phase;
    setAsyncJobActive(false);

    if (phase === "done") {
      if (progress.imported === 0) {
        toast.info("Everything from this site is already in Knowledge Core.");
      } else {
        toast.success(
          `Imported ${progress.imported.toLocaleString()} file${
            progress.imported === 1 ? "" : "s"
          } from SharePoint. They'll appear as they finish ingesting.`,
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "sources"],
      });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      onOpenChange(false);
    } else if (phase === "cancelled") {
      toast.info("SharePoint import cancelled.");
    } else if (phase === "error") {
      toast.error(
        `SharePoint import failed: ${progress.error ?? "Unknown error"}`,
      );
    }
  }, [progress, onOpenChange, queryClient]);

  // Reset per-dialog state on every open.
  useEffect(() => {
    if (!open) return;
    openCountRef.current += 1;
    setOpenEpoch(openCountRef.current);
    setSelectedSiteId("");
    setSelectedDriveId("");
    setScopeChoice("site");
    setSiteImportConfirmed(false);
    setVisibility("all");
    setSelectedTeamIds([]);
    setSelectedProjectIds([]);
    setRootFolders(null);
    setRootError(null);
    setChildren({});
    setExpanded(new Set());
    setLoading(new Set());
    setSelected(new Set());
    handledPhaseRef.current = null;
  }, [open]);

  // Reset confirmation + tree when the site changes mid-flow.
  useEffect(() => {
    setSiteImportConfirmed(false);
    setRootFolders(null);
    setSelected(new Set());
    setExpanded(new Set());
    setChildren({});
    setSelectedDriveId("");
  }, [selectedSiteId]);

  // Reset tree when the drive changes.
  useEffect(() => {
    setRootFolders(null);
    setSelected(new Set());
    setExpanded(new Set());
    setChildren({});
  }, [selectedDriveId]);

  // Lazy-load root folders the first time the user picks "Choose
  // folders" AND has a drive selected.
  useEffect(() => {
    if (
      !open ||
      scopeChoice !== "folders" ||
      !selectedSiteId ||
      !selectedDriveId ||
      rootFolders ||
      rootLoading
    ) {
      return;
    }
    setRootLoading(true);
    fetchSharePointFolders(selectedSiteId, selectedDriveId)
      .then((folders) => {
        setRootFolders(folders);
        setRootError(null);
      })
      .catch((err) => {
        setRootError(
          err instanceof Error
            ? err.message
            : "Couldn't list SharePoint folders.",
        );
      })
      .finally(() => setRootLoading(false));
  }, [
    open,
    scopeChoice,
    selectedSiteId,
    selectedDriveId,
    rootFolders,
    rootLoading,
  ]);

  const toggleExpand = useCallback(
    (id: string) => {
      if (expanded.has(id)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      if (children[id]) {
        setExpanded((prev) => new Set(prev).add(id));
        return;
      }
      setLoading((prev) => new Set(prev).add(id));
      fetchSharePointFolders(selectedSiteId, selectedDriveId, id)
        .then((kids) => {
          setChildren((prev) => ({ ...prev, [id]: kids }));
          setExpanded((prev) => new Set(prev).add(id));
        })
        .catch((err) => {
          toast.error(
            err instanceof Error ? err.message : "Couldn't list sub-folders.",
          );
        })
        .finally(() =>
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        );
    },
    [children, expanded, selectedSiteId, selectedDriveId],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Folder-scoped import (synchronous) ───────────────────────────
  const folderImportMutation = useMutation({
    mutationFn: async () => {
      const visibilityExtra = {
        visibility,
        teamIds: visibility === "teams" ? selectedTeamIds : undefined,
        projectIds: visibility === "project" ? selectedProjectIds : undefined,
      };
      return importFromSharePoint({
        kind: "folder",
        siteId: selectedSiteId,
        driveId: selectedDriveId,
        folderIds: Array.from(selected),
        ...visibilityExtra,
      });
    },
    onSuccess: (result) => {
      const skipped =
        result.skippedDuplicates +
        result.skippedUnsupported +
        result.skippedTooLarge;
      if (result.added === 0 && skipped === 0) {
        toast.info("No files found to import.");
      } else if (result.added === 0) {
        toast.info(
          "Everything from those folders is already in Knowledge Core.",
        );
      } else {
        toast.success(
          `Importing ${result.added} file${result.added === 1 ? "" : "s"} from SharePoint. They'll appear as they finish ingesting.`,
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
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    },
  });

  // ── Site import (async, with progress) ──────────────────────────
  const startAsyncMutation = useMutation({
    mutationFn: () =>
      startSharePointImportAsync({
        kind: "site",
        siteId: selectedSiteId,
        visibility,
        teamIds: visibility === "teams" ? selectedTeamIds : undefined,
        projectIds: visibility === "project" ? selectedProjectIds : undefined,
      }),
    onSuccess: () => {
      handledPhaseRef.current = null;
      setAsyncJobActive(true);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSharePointImport,
    onSuccess: () => {
      setAsyncJobActive(false);
      void queryClient.invalidateQueries({
        queryKey: ["sharepoint", "import-progress"],
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Cancel failed."),
  });

  // Visibility-specific picker requirements. Written as named locals
  // (rather than one terse boolean expression) because the previous
  // shape parsed correctly only by accident of operator precedence —
  // a future edit could silently swap "OR" / "AND" precedence and
  // ship a broken submit gate. Keep one rule per visibility kind.
  const teamsRuleSatisfied =
    visibility !== "teams" || selectedTeamIds.length > 0;
  const projectRuleSatisfied =
    visibility !== "project" || selectedProjectIds.length > 0;
  const visibilityValid = teamsRuleSatisfied && projectRuleSatisfied;

  const canSubmit =
    !folderImportMutation.isPending &&
    !startAsyncMutation.isPending &&
    !!selectedSiteId &&
    (scopeChoice === "folders"
      ? !!selectedDriveId && selected.size > 0
      : siteImportConfirmed) &&
    visibilityValid;

  // ── Progress view (shown while async job is active) ─────────────
  const isRunning =
    asyncJobActive &&
    progress &&
    (progress.phase === "scanning" || progress.phase === "importing");

  if (isRunning) {
    const { phase, total, imported } = progress;
    const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

    return (
      <Dialog open={open} onOpenChange={() => {/* block close while running */}}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary-6" />
              Importing from SharePoint…
            </DialogTitle>
            <DialogDescription>
              You can close this dialog — the import will continue in the
              background. Use Cancel to stop and undo all changes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {phase === "scanning" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Scanning your site…
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                  <div className="h-full w-1/3 animate-[scan-slide_1.4s_ease-in-out_infinite] rounded-full bg-primary-6" />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-3">Importing files…</span>
                  <span className="font-medium text-text-1 tabular-nums">
                    {imported.toLocaleString()} / {total.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                  <div
                    className="h-full rounded-full bg-primary-6 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-right text-[11px] text-text-3">{pct}%</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
            >
              Close
            </Button>
            <Button
              variant="outline"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="cursor-pointer gap-2 border-danger-4 text-danger-6 hover:bg-danger-1"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              Cancel import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Normal (config) view ──────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary-6" />
            Import from SharePoint
          </DialogTitle>
          <DialogDescription>
            Pick a site, then choose what to bring into Knowledge Core. Files
            you already imported are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Site picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              Site
            </label>
            {sitesLoading ? (
              <div className="flex items-center gap-2 rounded border border-border-2 px-3 py-2.5 text-[13px] text-text-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading your SharePoint sites…
              </div>
            ) : sitesError ? (
              <p className="rounded border border-danger-3 bg-danger-1 px-3 py-2 text-[13px] text-danger-7">
                Couldn&rsquo;t load SharePoint sites. Try reconnecting.
              </p>
            ) : sites.length === 0 ? (
              <div className="flex flex-col gap-1.5 rounded border border-border-2 px-3 py-2 text-[13px] text-text-3">
                <p>We couldn&rsquo;t find any SharePoint sites for this account.</p>
                <p className="text-[12px]">
                  Common reasons:
                </p>
                <ul className="list-disc pl-5 text-[12px]">
                  <li>
                    You signed in with a personal Microsoft account.
                    SharePoint requires a work or school account.
                  </li>
                  <li>
                    Your work account hasn&rsquo;t followed any sites yet.
                    Open SharePoint, click &ldquo;Follow&rdquo; on the
                    site(s) you want to import, then come back here.
                  </li>
                  <li>
                    Your tenant has SharePoint search blocked. The dev
                    log shows the exact Graph error — check it for the
                    next step.
                  </li>
                </ul>
              </div>
            ) : (
              <Select
                value={selectedSiteId}
                onValueChange={(v) => setSelectedSiteId(v)}
              >
                <SelectTrigger className="h-10 w-full cursor-pointer">
                  <SelectValue placeholder="Pick a site…" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Scope picker — only after a site is chosen */}
          {selectedSiteId && (
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
                <input
                  type="radio"
                  checked={scopeChoice === "site"}
                  onChange={() => {
                    setScopeChoice("site");
                    setSiteImportConfirmed(false);
                  }}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-text-1">
                    Entire site
                  </span>
                  <span className="text-[12px] text-text-3">
                    Import every supported file from every library on this site.
                  </span>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
                <input
                  type="radio"
                  checked={scopeChoice === "folders"}
                  onChange={() => setScopeChoice("folders")}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-text-1">
                    Choose folders
                  </span>
                  <span className="text-[12px] text-text-3">
                    Pick a library, then specific folders. Subfolders included.
                  </span>
                </div>
              </label>
            </div>
          )}

          {/* Entire-site confirmation banner */}
          {selectedSiteId && scopeChoice === "site" && (
            <div className="flex flex-col gap-2 rounded border border-warning-3 bg-warning-1 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-7" />
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] font-medium text-warning-8">
                    {fileCountLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking this site…
                      </span>
                    ) : fileCountData ? (
                      <>
                        This will import{" "}
                        <span className="tabular-nums">
                          {fileCountData.count.toLocaleString()}
                          {fileCountData.hasMore ? "+" : ""}
                        </span>{" "}
                        {fileCountData.count === 1 && !fileCountData.hasMore
                          ? "file"
                          : "files"}
                      </>
                    ) : fileCountError ? (
                      "This will import all supported files from this site"
                    ) : (
                      "This will import supported files from this site"
                    )}
                  </p>
                  <p className="text-[12px] text-warning-7">
                    Every supported document (.pdf, .docx, .xlsx) across every
                    library on this site will be scanned and queued for
                    ingestion. This can take several minutes.
                  </p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pl-6">
                <input
                  type="checkbox"
                  checked={siteImportConfirmed}
                  onChange={(e) => setSiteImportConfirmed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-warning-7"
                />
                <span className="text-[12px] font-medium text-warning-8">
                  I understand — import this entire site
                </span>
              </label>
            </div>
          )}

          {/* Drive (library) picker — folder scope only, hidden if there's exactly one */}
          {selectedSiteId && scopeChoice === "folders" && drives.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                Document library
              </label>
              {drivesLoading ? (
                <div className="flex items-center gap-2 rounded border border-border-2 px-3 py-2.5 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading libraries…
                </div>
              ) : (
                <Select
                  value={selectedDriveId}
                  onValueChange={(v) => setSelectedDriveId(v)}
                >
                  <SelectTrigger className="h-10 w-full cursor-pointer">
                    <SelectValue placeholder="Pick a library…" />
                  </SelectTrigger>
                  <SelectContent>
                    {drives.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Folder tree (folder scope only, drive picked) */}
          {selectedSiteId && scopeChoice === "folders" && selectedDriveId && (
            <div className="rounded border border-border-2 bg-bg-1/40 p-2">
              {rootLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading folders…
                </div>
              )}
              {rootError && (
                <p className="px-2 py-3 text-[13px] text-danger-6">
                  {rootError}
                </p>
              )}
              {!rootLoading && rootFolders && rootFolders.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-text-3">
                  No folders in this library.
                </p>
              )}
              {rootFolders && rootFolders.length > 0 && (
                <ul className="max-h-[280px] overflow-y-auto">
                  {rootFolders.map((f) => (
                    <FolderNode
                      key={f.id}
                      folder={f}
                      depth={0}
                      expanded={expanded}
                      folderMap={children}
                      loading={loading}
                      selected={selected}
                      onToggleExpand={toggleExpand}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Visibility picker */}
        {selectedSiteId && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              Visibility
            </label>
            <Select
              value={visibility}
              onValueChange={(v) => {
                setVisibility(v as KnowledgeFileVisibility);
                setSelectedTeamIds([]);
                setSelectedProjectIds([]);
              }}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone in the company</SelectItem>
                {isAdmin && <SelectItem value="admins">Admins only</SelectItem>}
                <SelectItem value="teams">Specific teams…</SelectItem>
                <SelectItem value="project">Specific project…</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {visibility === "admins"
                ? "Only admins will see these files in chat / arena."
                : visibility === "teams"
                  ? "Only members of the teams you pick below will see these files."
                  : visibility === "project"
                    ? "These files will only appear in the chat of the selected project(s)."
                    : "Every user in the company can see these files in chat / arena."}
            </p>
          </div>
        )}

        {/* Team picker */}
        {selectedSiteId && visibility === "teams" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              Teams with access
            </label>
            {userTeams.length === 0 ? (
              <p className="text-[11px] text-text-3">
                You aren&rsquo;t a member of any team yet.
              </p>
            ) : (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                {userTeams.map((t) => {
                  const checked = selectedTeamIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedTeamIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          )
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                      />
                      <span className="truncate">{t.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Project picker */}
        {selectedSiteId && visibility === "project" && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-text-1">
              Projects with access
            </label>
            {userProjects.length === 0 ? (
              <p className="text-[11px] text-text-3">
                You don&rsquo;t have access to any projects yet.
              </p>
            ) : (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                {userProjects.map((p) => {
                  const checked = selectedProjectIds.includes(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedProjectIds((prev) =>
                            checked
                              ? prev.filter((id) => id !== p.id)
                              : [...prev, p.id],
                          )
                        }
                        className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                      />
                      <span className="truncate">
                        {p.name}
                        {p.teamName && (
                          <span className="ml-1 text-text-3">
                            · {p.teamName}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              scopeChoice === "site"
                ? startAsyncMutation.mutate()
                : folderImportMutation.mutate()
            }
            disabled={!canSubmit}
            className="cursor-pointer gap-2"
          >
            {(folderImportMutation.isPending ||
              startAsyncMutation.isPending) && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {!selectedSiteId
              ? "Pick a site"
              : scopeChoice === "site"
                ? "Import entire site"
                : selected.size === 0
                  ? "Pick at least one folder"
                  : `Import ${selected.size} folder${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
