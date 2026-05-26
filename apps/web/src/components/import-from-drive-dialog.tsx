"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  Loader2,
} from "lucide-react";

import {
  fetchDriveFolders,
  importFromDrive,
  type DriveFolder,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ImportScopeChoice = "all" | "folders";

interface FolderNodeProps {
  folder: DriveFolder;
  depth: number;
  expanded: Set<string>;
  children: Record<string, DriveFolder[] | undefined>;
  loading: Set<string>;
  selected: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggleSelect: (id: string) => void;
}

function FolderNode({
  folder,
  depth,
  expanded,
  children,
  loading,
  selected,
  onToggleExpand,
  onToggleSelect,
}: FolderNodeProps) {
  const isExpanded = expanded.has(folder.id);
  const isLoading = loading.has(folder.id);
  const isSelected = selected.has(folder.id);
  const kids = children[folder.id];

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
              children={children}
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
  const [scopeChoice, setScopeChoice] = useState<ImportScopeChoice>("all");
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
      if (scopeChoice === "all") {
        return importFromDrive({ kind: "all" });
      }
      return importFromDrive({
        kind: "folders",
        folderIds: Array.from(selected),
      });
    },
    onSuccess: (result) => {
      const skipped =
        result.skippedDuplicates + result.skippedUnsupported;
      if (result.added === 0 && skipped === 0) {
        toast.info("No files found to import.");
      } else if (result.added === 0) {
        toast.info("Everything from that scope is already in Knowledge Core.");
      } else {
        toast.success(
          `Importing ${result.added} file${result.added === 1 ? "" : "s"} from Drive. They'll appear as they finish ingesting.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["drive", "sources"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledgeFolders"] });
      void queryClient.invalidateQueries({ queryKey: ["recentKnowledgeFiles"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    },
  });

  const canSubmit =
    !importMutation.isPending &&
    (scopeChoice === "all" || selected.size > 0);

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
                onChange={() => setScopeChoice("all")}
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
                      children={children}
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
