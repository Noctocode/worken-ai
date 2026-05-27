"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  Loader2,
} from "lucide-react";

import {
  fetchDriveFolders,
  fetchProjects,
  fetchTeams,
  importFromDrive,
  type DriveFolder,
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
  folder: DriveFolder;
  depth: number;
  expanded: Set<string>;
  folderMap: Record<string, DriveFolder[] | undefined>;
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

export function ImportFromDriveDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [scopeChoice, setScopeChoice] = useState<ImportScopeChoice>("all");
  const [entireDriveConfirmed, setEntireDriveConfirmed] = useState(false);
  const [visibility, setVisibility] = useState<KnowledgeFileVisibility>("all");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: open,
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "drive-import"],
    queryFn: () => fetchProjects("all"),
    enabled: open,
  });
  const [rootFolders, setRootFolders] = useState<DriveFolder[] | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const [children, setChildren] = useState<
    Record<string, DriveFolder[] | undefined>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset per-dialog state on every open. The user might disconnect /
  // reconnect a different Drive between opens, and stale cached
  // folder ids would point into the wrong account.
  useEffect(() => {
    if (!open) return;
    setScopeChoice("all");
    setEntireDriveConfirmed(false);
    setVisibility("all");
    setSelectedTeamIds([]);
    setSelectedProjectIds([]);
    setRootFolders(null);
    setRootError(null);
    setChildren({});
    setExpanded(new Set());
    setLoading(new Set());
    setSelected(new Set());
  }, [open]);

  // Lazy-load root folders the first time the user picks "Choose
  // folders". Cached on the component instance so flipping back and
  // forth between scopes doesn't refetch.
  useEffect(() => {
    if (!open || scopeChoice !== "folders" || rootFolders || rootLoading) {
      return;
    }
    setRootLoading(true);
    fetchDriveFolders()
      .then((folders) => {
        setRootFolders(folders);
        setRootError(null);
      })
      .catch((err) => {
        setRootError(
          err instanceof Error ? err.message : "Couldn't list Drive folders.",
        );
      })
      .finally(() => setRootLoading(false));
  }, [open, scopeChoice, rootFolders, rootLoading]);

  const toggleExpand = useCallback(
    (id: string) => {
      // Collapsing: just drop from expanded set; keep cached children
      // so reopening is instant.
      if (expanded.has(id)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        return;
      }
      // Expanding: if we already cached children for this id, just
      // flip the flag. Otherwise lazy-load.
      if (children[id]) {
        setExpanded((prev) => new Set(prev).add(id));
        return;
      }
      setLoading((prev) => new Set(prev).add(id));
      fetchDriveFolders(id)
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

  const importMutation = useMutation({
    mutationFn: async () => {
      const visibilityExtra = {
        visibility,
        teamIds: visibility === "teams" ? selectedTeamIds : undefined,
        projectIds: visibility === "project" ? selectedProjectIds : undefined,
      };
      if (scopeChoice === "all") {
        return importFromDrive({ kind: "all", ...visibilityExtra });
      }
      return importFromDrive({
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
        toast.info("Everything from that scope is already in Knowledge Core.");
      } else {
        toast.success(
          `Importing ${result.added} file${result.added === 1 ? "" : "s"} from Drive. They'll appear as they finish ingesting.`,
        );
      }
      // Size-cap skips are noisy enough to warrant their own warning
      // toast — the user picked those files expecting them to come in.
      if (result.skippedTooLarge > 0) {
        toast.warning(
          `Skipped ${result.skippedTooLarge} file${result.skippedTooLarge === 1 ? "" : "s"} larger than 50MB.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    },
  });

  const visibilityValid =
    visibility !== "teams" || selectedTeamIds.length > 0
      ? visibility !== "project" || selectedProjectIds.length > 0
      : false;

  const canSubmit =
    !importMutation.isPending &&
    (scopeChoice === "folders" ? selected.size > 0 : entireDriveConfirmed) &&
    visibilityValid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-primary-6" />
            Import from Google Drive
          </DialogTitle>
          <DialogDescription>
            Pick what to bring into Knowledge Core. Files you already imported
            are skipped automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Scope picker */}
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded border border-border-2 p-3 hover:bg-bg-1">
              <input
                type="radio"
                checked={scopeChoice === "all"}
                onChange={() => {
                  setScopeChoice("all");
                  setEntireDriveConfirmed(false);
                }}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary-6"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-text-1">
                  Entire Drive
                </span>
                <span className="text-[12px] text-text-3">
                  Import every supported file from My Drive.
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
                  Pick specific folders from your Drive. Subfolders included.
                </span>
              </div>
            </label>
          </div>

          {/* Entire Drive confirmation warning */}
          {scopeChoice === "all" && (
            <div className="flex flex-col gap-2 rounded border border-warning-3 bg-warning-1 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-7" />
                <div className="flex flex-col gap-1">
                  <p className="text-[13px] font-medium text-warning-8">
                    This will import up to 10,000 files
                  </p>
                  <p className="text-[12px] text-warning-7">
                    Every supported document (.pdf, .docx, .xlsx) from your
                    entire Google Drive will be scanned and queued for
                    ingestion. This can take several minutes and will consume
                    significant storage and processing resources.
                  </p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 pl-6">
                <input
                  type="checkbox"
                  checked={entireDriveConfirmed}
                  onChange={(e) => setEntireDriveConfirmed(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-warning-7"
                />
                <span className="text-[12px] font-medium text-warning-8">
                  I understand — import my entire Drive
                </span>
              </label>
            </div>
          )}

          {/* Folder tree (only when "Choose folders" is selected) */}
          {scopeChoice === "folders" && (
            <div className="rounded border border-border-2 bg-bg-1/40 p-2">
              {rootLoading && (
                <div className="flex items-center gap-2 px-2 py-3 text-[13px] text-text-3">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading your Drive folders…
                </div>
              )}
              {rootError && (
                <p className="px-2 py-3 text-[13px] text-danger-6">
                  {rootError}
                </p>
              )}
              {!rootLoading && rootFolders && rootFolders.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-text-3">
                  No folders in My Drive.
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

        {/* Team picker */}
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

        {/* Project picker */}
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
            onClick={() => importMutation.mutate()}
            disabled={!canSubmit}
            className="cursor-pointer gap-2"
          >
            {importMutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {scopeChoice === "all"
              ? "Import entire Drive"
              : selected.size === 0
                ? "Pick at least one folder"
                : `Import ${selected.size} folder${selected.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
