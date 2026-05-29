"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  cancelOneDriveImport,
  fetchOneDriveFileCount,
  fetchOneDriveFolders,
  fetchOneDriveImportProgress,
  fetchProjects,
  fetchTeams,
  importFromOneDrive,
  startOneDriveImportAsync,
  type OneDriveFolder,
  type OneDriveImportProgress,
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

type ImportScopeChoice = "all" | "folders";

interface FolderNodeProps {
  folder: OneDriveFolder;
  depth: number;
  expanded: Set<string>;
  folderMap: Record<string, OneDriveFolder[] | undefined>;
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
          onClick={() => onToggleExpand(folder.id)}
          disabled={!folder.hasChildren}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-3 ${
            folder.hasChildren
              ? "cursor-pointer hover:bg-bg-white hover:text-text-1"
              : "invisible pointer-events-none"
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

export function ImportFromOneDriveDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [scopeChoice, setScopeChoice] = useState<ImportScopeChoice>("all");
  const [entireConfirmed, setEntireConfirmed] = useState(false);
  const [visibility, setVisibility] = useState<KnowledgeFileVisibility>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

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
    queryKey: ["projects", "onedrive-import"],
    queryFn: () => fetchProjects("all"),
    enabled: open,
  });

  const {
    data: fileCountData,
    isLoading: fileCountLoading,
    isError: fileCountError,
  } = useQuery({
    queryKey: ["onedrive", "file-count", openEpoch],
    queryFn: fetchOneDriveFileCount,
    enabled: open && openEpoch > 0,
    retry: 1,
  });
  const [rootFolders, setRootFolders] = useState<OneDriveFolder[] | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [children, setChildren] = useState<
    Record<string, OneDriveFolder[] | undefined>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Async progress polling ────────────────────────────────────────
  const { data: progress } = useQuery<OneDriveImportProgress | null>({
    queryKey: ["onedrive", "import-progress"],
    queryFn: fetchOneDriveImportProgress,
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
        toast.info("Everything from your OneDrive is already in Knowledge Core.");
      } else {
        toast.success(
          `Imported ${progress.imported.toLocaleString()} file${
            progress.imported === 1 ? "" : "s"
          } from OneDrive. They'll appear as they finish ingesting.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["onedrive", "sources"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      onOpenChange(false);
    } else if (phase === "cancelled") {
      toast.info("OneDrive import cancelled.");
    } else if (phase === "error") {
      toast.error(
        `OneDrive import failed: ${progress.error ?? "Unknown error"}`,
      );
    }
  }, [progress, onOpenChange, queryClient]);

  useEffect(() => {
    if (!open) return;
    openCountRef.current += 1;
    setOpenEpoch(openCountRef.current);
    setScopeChoice("all");
    setEntireConfirmed(false);
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

  // Lazy-load root folders the first time the user picks "Choose folders".
  useEffect(() => {
    if (!open || scopeChoice !== "folders" || rootFolders || rootLoading) {
      return;
    }
    setRootLoading(true);
    fetchOneDriveFolders()
      .then((folders) => {
        setRootFolders(folders);
        setRootError(null);
      })
      .catch((err) => {
        setRootError(
          err instanceof Error
            ? err.message
            : "Couldn't list OneDrive folders.",
        );
      })
      .finally(() => setRootLoading(false));
  }, [open, scopeChoice, rootFolders, rootLoading]);

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
      fetchOneDriveFolders(id)
        .then((kids) => {
          setChildren((prev) => ({ ...prev, [id]: kids }));
          setExpanded((prev) => new Set(prev).add(id));
        })
        .catch((err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : "Couldn't list sub-folders.",
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
    [children, expanded],
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
      return importFromOneDrive({
        kind: "folders",
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
        toast.info("Everything from those folders is already in Knowledge Core.");
      } else {
        toast.success(
          `Importing ${result.added} file${result.added === 1 ? "" : "s"} from OneDrive. They'll appear as they finish ingesting.`,
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
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    },
  });

  // ── Entire OneDrive import (async, shows progress) ───────────────────
  const startAsyncMutation = useMutation({
    mutationFn: () =>
      startOneDriveImportAsync({
        kind: "all",
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
    mutationFn: cancelOneDriveImport,
    onSuccess: () => {
      setAsyncJobActive(false);
      void queryClient.invalidateQueries({
        queryKey: ["onedrive", "import-progress"],
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Cancel failed."),
  });

  const teamsRuleSatisfied =
    visibility !== "teams" || selectedTeamIds.length > 0;
  const projectRuleSatisfied =
    visibility !== "project" || selectedProjectIds.length > 0;
  const visibilityValid = teamsRuleSatisfied && projectRuleSatisfied;

  const canSubmit =
    !folderImportMutation.isPending &&
    !startAsyncMutation.isPending &&
    (scopeChoice === "folders" ? selected.size > 0 : entireConfirmed) &&
    visibilityValid;

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
              Importing from OneDrive…
            </DialogTitle>
            <DialogDescription>
              You can close this dialog — the import will continue in the
              background. Use Cancel to stop and remove any files imported
              so far.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {phase === "scanning" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Scanning your OneDrive…
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
            <Cloud className="h-4 w-4 text-primary-6" />
            Import from OneDrive
          </DialogTitle>
          <DialogDescription>
            Pick what to bring into Knowledge Core. Files you already imported
            are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
              <input
                type="radio"
                checked={scopeChoice === "all"}
                onChange={() => {
                  setScopeChoice("all");
                  setEntireConfirmed(false);
                }}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text-1">
                  Entire OneDrive
                </span>
                <span className="text-[12px] text-text-3">
                  Import every supported file from your OneDrive.
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
                  Pick specific folders from your OneDrive. Subfolders included.
                </span>
              </div>
            </label>
          </div>

          {scopeChoice === "all" && (
            <div className="flex flex-col gap-2 rounded border border-warning-3 bg-warning-1 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-7" />
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] font-medium text-warning-8">
                    {fileCountLoading ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking your OneDrive…
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
                      "This will import all supported files from your OneDrive"
                    ) : (
                      "This will import supported files from your OneDrive"
                    )}
                  </p>
                  <p className="text-[12px] text-warning-7">
                    Every supported document (.pdf, .docx, .xlsx) from your
                    entire OneDrive will be scanned and queued for ingestion.
                    This can take several minutes.
                  </p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pl-6">
                <input
                  type="checkbox"
                  checked={entireConfirmed}
                  onChange={(e) => setEntireConfirmed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-warning-7"
                />
                <span className="text-[12px] font-medium text-warning-8">
                  I understand — import my entire OneDrive
                </span>
              </label>
            </div>
          )}

          {scopeChoice === "folders" && (
            <div className="rounded border border-border-2 bg-bg-1/40 p-2">
              {rootLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading your OneDrive folders…
                </div>
              )}
              {rootError && (
                <p className="px-2 py-3 text-[13px] text-danger-6">
                  {rootError}
                </p>
              )}
              {!rootLoading && rootFolders && rootFolders.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-text-3">
                  No folders in your OneDrive.
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

        {visibility === "teams" && (
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

        {visibility === "project" && (
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
                          <span className="ml-1 text-text-3">· {p.teamName}</span>
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
              scopeChoice === "all"
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
            {scopeChoice === "all"
              ? "Import entire OneDrive"
              : selected.size === 0
                ? "Pick at least one folder"
                : `Import ${selected.size} folder${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
