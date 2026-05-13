"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  FileText,
  FolderInput,
  Folder,
  Loader2,
  MoreVertical,
  RotateCw,
  Search,
  Shield,
  Trash2,
  Upload,
  Users,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchKnowledgeFolder,
  fetchKnowledgeFolders,
  fetchTeams,
  uploadKnowledgeFiles,
  updateKnowledgeFileVisibility,
  updateKnowledgeFilesVisibilityBulk,
  reingestKnowledgeFile,
  moveKnowledgeFile,
  deleteKnowledgeFile,
  type KnowledgeFileVisibility,
} from "@/lib/api";
import { useAuth } from "@/components/providers";

const TYPE_STYLES: Record<string, string> = {
  PDF: "bg-danger-1 text-danger-6",
  DOCX: "bg-primary-1 text-primary-7",
  DOC: "bg-primary-1 text-primary-7",
  XLSX: "bg-success-1 text-success-7",
  XLS: "bg-success-1 text-success-7",
  PNG: "bg-warning-1 text-warning-6",
  JPG: "bg-warning-1 text-warning-6",
  JPEG: "bg-warning-1 text-warning-6",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Compact pill that surfaces the ingestion lifecycle on each file
 * row. Mirrors the same four states the step-6 progress UI uses so
 * the user gets consistent vocabulary across both upload paths.
 *
 *   pending / processing → Loader2 spinner, neutral copy
 *   done                 → success check, "Trained"
 *   failed               → warning triangle, "Skipped" + tooltip with
 *                          the underlying error so unsupported types
 *                          don't look broken
 */
function IngestionStatusBadge({
  status,
  error,
}: {
  status: "pending" | "processing" | "done" | "failed";
  error?: string | null;
}) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-7">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        Trained
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title={error ?? "Could not extract searchable text from this file."}
      >
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        Skipped
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      {status === "processing" ? "Training" : "Queued"}
    </span>
  );
}

/**
 * Visibility pill — mirrors the inline copy in /knowledge-core
 * root page. Inline-duplicated for the same reason as
 * IngestionStatusBadge: the two pages don't share a components
 * file for this domain yet.
 */
function VisibilityBadge({
  visibility,
  teams = [],
}: {
  visibility: KnowledgeFileVisibility;
  teams?: { id: string; name: string }[];
}) {
  if (visibility === "admins") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title="Only admins can see this file in chat / arena."
      >
        <Shield className="h-3 w-3" strokeWidth={2} />
        Admins only
      </span>
    );
  }
  if (visibility === "teams") {
    // Team list as a comma-joined hover tooltip; the pill itself
    // stays compact so the row keeps a single-line layout.
    const names = teams.map((t) => t.name).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-7"
        title={
          names.length > 0
            ? `Only members of these teams can see this file in chat / arena: ${names}.`
            : "Visibility is set to specific teams, but no team is linked yet — no one can see this file."
        }
      >
        <Users className="h-3 w-3" strokeWidth={2} />
        {teams.length > 0 ? `Teams (${teams.length})` : "Teams"}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
      title="Every company user can see this file in chat / arena."
    >
      <Users className="h-3 w-3" strokeWidth={2} />
      Everyone
    </span>
  );
}

export default function FolderDetailPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = use(params);
  const [query, setQuery] = useState("");
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const queryClient = useQueryClient();

  const { data: folder, isLoading } = useQuery({
    queryKey: ["knowledge-folder", folderId],
    queryFn: () => fetchKnowledgeFolder(folderId),
    enabled: !!folderId,
    // Auto-poll while ingestion is still in flight so the status
    // badge transitions Queued → Processing → Trained without the
    // user having to refresh. Stops polling once every file lands
    // in a terminal state (done / failed) — avoids needless DB
    // round-trips for static folders.
    refetchInterval: (query) => {
      const f = query.state.data;
      if (!f) return false;
      const inProgress = f.files.some(
        (file) =>
          file.ingestionStatus === "pending" ||
          file.ingestionStatus === "processing",
      );
      return inProgress ? 2000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: ({
      files,
      visibility,
      teamIds,
    }: {
      files: File[];
      visibility: KnowledgeFileVisibility;
      teamIds: string[];
    }) => uploadKnowledgeFiles(folderId, files, visibility, teamIds),
    onSuccess: ({ uploaded, duplicates }) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      // Same three-outcome shape as the root KC page: mixed batches
      // fire both toasts (one success for what got saved, one info
      // for what was skipped) so the user always knows the exact
      // result of their drop.
      if (uploaded.length > 0) {
        toast.success(`Uploaded ${uploaded.length} file(s).`);
      }
      if (duplicates.length > 0) {
        toast.info(
          duplicates.length === 1
            ? `"${duplicates[0].name}" is already in your Knowledge Core.`
            : `${duplicates.length} file(s) were already in your Knowledge Core.`,
          {
            description: duplicates
              .map((d) => `"${d.name}" → "${d.existing.folderName}"`)
              .join("\n"),
          },
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to upload files."),
  });

  // Single-file re-train. Mirror of the root /knowledge-core page;
  // see its comment for details.
  const reingestMutation = useMutation({
    mutationFn: (fileId: string) => reingestKnowledgeFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success("Re-training started.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to re-train this file."),
  });

  // Admin-only PATCH to flip visibility post-upload. BE rejects
  // non-admin with 403 — UI hides the menu item entirely below.
  const visibilityMutation = useMutation({
    mutationFn: ({
      fileId,
      visibility,
    }: {
      fileId: string;
      visibility: KnowledgeFileVisibility;
    }) => updateKnowledgeFileVisibility(fileId, visibility),
    onSuccess: (_, { visibility }) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(
        visibility === "admins"
          ? "File is now visible only to admins."
          : "File is now visible to everyone.",
      );
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to update visibility."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeFile,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success("File deleted.");
    },
    onError: () => toast.error("Failed to delete file."),
  });

  const { data: allFolders = [] } = useQuery({
    queryKey: ["knowledge-folders"],
    queryFn: fetchKnowledgeFolders,
  });

  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const moveFileName =
    folder?.files.find((f) => f.id === moveFileId)?.name ?? "";

  const moveMutation = useMutation({
    mutationFn: () => moveKnowledgeFile(moveFileId!, moveTargetId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", moveTargetId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      setMoveFileId(null);
      setMoveTargetId("");
      toast.success("File moved.");
    },
    onError: () => toast.error("Failed to move file."),
  });

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // Per-batch visibility staging. Same lifecycle as on the root
  // /knowledge-core page: select is open to all users, reset to
  // 'all' after each confirmed upload so the choice doesn't leak
  // across batches. Team IDs reset alongside visibility.
  const [stagedVisibility, setStagedVisibility] =
    useState<KnowledgeFileVisibility>("all");
  const [stagedTeamIds, setStagedTeamIds] = useState<string[]>([]);

  // Same user-teams list the root page renders. Cached by react-query
  // key 'teams' so navigating between KC pages reuses one fetch.
  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });

  // Multi-select state for the bulk action bar. Set<string> over
  // the current folder's file ids; resets when the user navigates
  // to another folder (the page itself unmounts). Confirm dialog
  // for the destructive bulk Delete so an accidental click on
  // "Delete N" doesn't wipe the selection.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const clearSelection = () => setSelectedIds(new Set());
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkVisibilityMutation = useMutation({
    mutationFn: (visibility: KnowledgeFileVisibility) =>
      updateKnowledgeFilesVisibilityBulk(
        Array.from(selectedIds),
        visibility,
      ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      const updatedCopy =
        res.visibility === "admins"
          ? `${res.affectedIds.length} file(s) are now visible only to admins.`
          : `${res.affectedIds.length} file(s) are now visible to everyone.`;
      // BE skips rows that are mid-ingestion to avoid leaving the
      // file row + about-to-be-inserted chunks out of sync. Surface
      // that to the admin so they know to retry once those finish.
      if (res.skippedIds.length === 0) {
        toast.success(updatedCopy);
      } else if (res.affectedIds.length === 0) {
        toast.warning(
          `All ${res.skippedIds.length} selected file(s) are still being trained. Try again once they finish.`,
        );
      } else {
        toast.warning(
          `${updatedCopy} ${res.skippedIds.length} file(s) were skipped because they're still being trained — try those again in a moment.`,
        );
      }
      clearSelection();
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to update visibility."),
  });

  // Bulk retrain + delete fan out to the existing per-file
  // endpoints via Promise.allSettled — same per-row gates (owner
  // check, status='processing' block for retrain) apply, just
  // accumulated. Aggregated toast at the end so a single failure
  // doesn't drown out the successes.
  const bulkRetrainMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map((id) => reingestKnowledgeFile(id)),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.length - fulfilled;
      return { fulfilled, rejected };
    },
    onSuccess: ({ fulfilled, rejected }) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      if (rejected === 0) {
        toast.success(`Re-training started for ${fulfilled} file(s).`);
      } else if (fulfilled === 0) {
        toast.error(`Re-train failed for all ${rejected} file(s).`);
      } else {
        toast.warning(
          `Re-trained ${fulfilled} file(s); ${rejected} failed (likely already mid-training).`,
        );
      }
      clearSelection();
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map((id) => deleteKnowledgeFile(id)),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.length - fulfilled;
      return { fulfilled, rejected };
    },
    onSuccess: ({ fulfilled, rejected }) => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      if (rejected === 0) {
        toast.success(`Deleted ${fulfilled} file(s).`);
      } else if (fulfilled === 0) {
        toast.error(`Delete failed for all ${rejected} file(s).`);
      } else {
        toast.warning(
          `Deleted ${fulfilled} file(s); ${rejected} failed.`,
        );
      }
      clearSelection();
      setBulkDeleteOpen(false);
    },
  });
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const deleteFileName =
    folder?.files.find((f) => f.id === deleteFileId)?.name ?? "";

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setStagedFiles(files);
    e.target.value = "";
  };

  const confirmUpload = () => {
    if (stagedFiles.length === 0) return;
    if (stagedVisibility === "teams" && stagedTeamIds.length === 0) {
      toast.error("Pick at least one team for Teams visibility.");
      return;
    }
    uploadMutation.mutate({
      files: stagedFiles,
      visibility: stagedVisibility,
      teamIds: stagedTeamIds,
    });
    setStagedFiles([]);
    setStagedVisibility("all");
    setStagedTeamIds([]);
  };

  const removeStagedFile = (idx: number) =>
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDelete = (id: string) => {
    setDeleteFileId(id);
  };

  const filtered = useMemo(() => {
    if (!folder) return [];
    const q = query.trim().toLowerCase();
    if (!q) return folder.files;
    return folder.files.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.uploadedByName ?? "").toLowerCase().includes(q) ||
        (f.fileType ?? "").toLowerCase().includes(q),
    );
  }, [query, folder]);

  // Tri-state for the select-all header checkbox over the *currently
  // visible* rows (post-search-filter). Selection itself is folder-
  // wide — toggling search filter doesn't drop existing selection.
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((f) => selectedIds.has(f.id));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((f) => selectedIds.has(f.id));
  const headerCheckboxState: boolean | "indeterminate" = allFilteredSelected
    ? true
    : someFilteredSelected
      ? "indeterminate"
      : false;
  const toggleSelectAllFiltered = (checked: boolean | "indeterminate") => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked === true) {
        for (const f of filtered) next.add(f.id);
      } else {
        for (const f of filtered) next.delete(f.id);
      }
      return next;
    });
  };
  const bulkBusy =
    bulkVisibilityMutation.isPending ||
    bulkRetrainMutation.isPending ||
    bulkDeleteMutation.isPending;

  if (isLoading || !folder) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  const totalBytes = folder.files.reduce((sum, f) => sum + f.sizeBytes, 0);

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Back link */}
      <Link
        href="/knowledge-core"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[14px] text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Folders
      </Link>

      {/* Folder info card */}
      <div className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Folder
            className="h-10 w-10 shrink-0 text-primary-6"
            strokeWidth={1.5}
          />
          <div className="flex flex-col">
            <h1 className="text-[20px] font-bold text-text-1">
              {folder.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-3">
              <span>{folder.files.length} files</span>
              <span>{formatBytes(totalBytes)} total</span>
              <span>
                Last modified {formatDate(folder.updatedAt)}
              </span>
            </div>
          </div>
        </div>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xlsx,.doc,.xls,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleBrowse}
          />
          <Button
            asChild
            className="shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
          >
            <span>
              <Upload className="h-4 w-4" />
              Upload Files
            </span>
          </Button>
        </label>
      </div>

      {/* Search */}
      <div className="relative sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files..."
          className="h-10 pl-9 placeholder:text-text-3"
        />
      </div>

      {/* Bulk action bar. Renders sticky above the table whenever the
          user has at least one row selected. Visibility buttons are
          admin-only — matches the per-file action menu gate; retrain
          and delete are owner-only (BE filters anyway, FE just lets
          the user fire it). */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-primary-2 bg-primary-1/40 px-4 py-3 backdrop-blur">
          <span className="text-[13px] font-semibold text-text-1">
            {selectedIds.size} file{selectedIds.size !== 1 ? "s" : ""}{" "}
            selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkVisibilityMutation.mutate("admins")}
                  disabled={bulkBusy}
                  className="cursor-pointer gap-1.5"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Admin-only
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkVisibilityMutation.mutate("all")}
                  disabled={bulkBusy}
                  className="cursor-pointer gap-1.5"
                >
                  <Users className="h-3.5 w-3.5" />
                  Visible to everyone
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => bulkRetrainMutation.mutate()}
              disabled={bulkBusy}
              className="cursor-pointer gap-1.5"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retrain
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkBusy}
              className="cursor-pointer gap-1.5 border-danger-3 text-danger-6 hover:bg-danger-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={bulkBusy}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Files table */}
      <div className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                <th className="px-5 py-3 w-10">
                  <Checkbox
                    aria-label="Select all files"
                    checked={headerCheckboxState}
                    onCheckedChange={toggleSelectAllFiltered}
                    disabled={filtered.length === 0}
                  />
                </th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Size</th>
                <th className="px-5 py-3">Uploaded By</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr
                  key={f.id}
                  className={`border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1 ${
                    selectedIds.has(f.id) ? "bg-primary-1/30" : ""
                  }`}
                >
                  <td className="px-5 py-4">
                    <Checkbox
                      aria-label={`Select ${f.name}`}
                      checked={selectedIds.has(f.id)}
                      onCheckedChange={() => toggleSelected(f.id)}
                    />
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <FileText
                        className="h-5 w-5 shrink-0 text-text-3"
                        strokeWidth={1.5}
                      />
                      <span className="font-medium text-text-1">{f.name}</span>
                      <IngestionStatusBadge
                        status={f.ingestionStatus}
                        error={f.ingestionError}
                      />
                      <VisibilityBadge visibility={f.visibility} teams={f.teams} />
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${TYPE_STYLES[f.fileType ?? ""] ?? "bg-bg-1 text-text-2"}`}
                    >
                      {f.fileType ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {formatBytes(f.sizeBytes)}
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {f.uploadedByName ?? "—"}
                  </td>
                  <td className="px-5 py-4 text-text-3">
                    {formatDateTime(f.createdAt)}
                  </td>
                  <td className="px-5 py-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/knowledge-core/files/${f.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download className="mr-2 h-3.5 w-3.5" />
                            Download
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setMoveFileId(f.id);
                            setMoveTargetId("");
                          }}
                        >
                          <FolderInput className="mr-2 h-3.5 w-3.5" />
                          Move to...
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => reingestMutation.mutate(f.id)}
                          disabled={
                            f.ingestionStatus === "processing" ||
                            reingestMutation.isPending
                          }
                        >
                          <RotateCw className="mr-2 h-3.5 w-3.5" />
                          Retrain
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            onSelect={() =>
                              visibilityMutation.mutate({
                                fileId: f.id,
                                visibility:
                                  f.visibility === "admins" ? "all" : "admins",
                              })
                            }
                          >
                            {f.visibility === "admins" ? (
                              <>
                                <Users className="mr-2 h-3.5 w-3.5" />
                                Make visible to everyone
                              </>
                            ) : (
                              <>
                                <Shield className="mr-2 h-3.5 w-3.5" />
                                Make admin-only
                              </>
                            )}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => handleDelete(f.id)}
                          className="text-danger-6 focus:text-danger-6"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-[13px] text-text-3"
                  >
                    {query
                      ? "No files match your search."
                      : "No files in this folder yet. Upload some above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col md:hidden">
          {filtered.map((f, idx) => (
            <div
              key={f.id}
              className={`flex items-center gap-3 px-4 py-4 ${idx > 0 ? "border-t border-border-2" : ""} ${
                selectedIds.has(f.id) ? "bg-primary-1/30" : ""
              }`}
            >
              <Checkbox
                aria-label={`Select ${f.name}`}
                checked={selectedIds.has(f.id)}
                onCheckedChange={() => toggleSelected(f.id)}
              />
              <FileText
                className="h-5 w-5 shrink-0 text-text-3"
                strokeWidth={1.5}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-text-1">
                    {f.name}
                  </span>
                  <IngestionStatusBadge
                    status={f.ingestionStatus}
                    error={f.ingestionError}
                  />
                  <VisibilityBadge visibility={f.visibility} teams={f.teams} />
                </div>
                <span className="text-[12px] text-text-3">
                  {formatBytes(f.sizeBytes)} •{" "}
                  {f.uploadedByName ?? "Unknown"} •{" "}
                  {formatDateTime(f.createdAt)}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-1 hover:text-text-1"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setMoveFileId(f.id);
                      setMoveTargetId("");
                    }}
                  >
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    Move to...
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => reingestMutation.mutate(f.id)}
                    disabled={
                      f.ingestionStatus === "processing" ||
                      reingestMutation.isPending
                    }
                  >
                    <RotateCw className="mr-2 h-3.5 w-3.5" />
                    Retrain
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem
                      onSelect={() =>
                        visibilityMutation.mutate({
                          fileId: f.id,
                          visibility:
                            f.visibility === "admins" ? "all" : "admins",
                        })
                      }
                    >
                      {f.visibility === "admins" ? (
                        <>
                          <Users className="mr-2 h-3.5 w-3.5" />
                          Make visible to everyone
                        </>
                      ) : (
                        <>
                          <Shield className="mr-2 h-3.5 w-3.5" />
                          Make admin-only
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => handleDelete(f.id)}
                    className="text-danger-6 focus:text-danger-6"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {query
                ? "No files match your search."
                : "No files yet."}
            </p>
          )}
        </div>
      </div>

      {/* Move file dialog */}
      <Dialog
        open={moveFileId !== null}
        onOpenChange={(open) => !open && setMoveFileId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move File</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-text-2">
            Move <strong>{moveFileName}</strong> to:
          </p>
          <Select value={moveTargetId} onValueChange={setMoveTargetId}>
            <SelectTrigger className="w-full cursor-pointer data-[size=default]:h-10">
              <SelectValue placeholder="Select folder" />
            </SelectTrigger>
            <SelectContent>
              {allFolders
                .filter((f) => f.id !== folderId)
                .map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setMoveFileId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={() => moveMutation.mutate()}
              disabled={!moveTargetId || moveMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {moveMutation.isPending ? "Moving..." : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Confirmation Dialog */}
      <Dialog
        open={stagedFiles.length > 0}
        onOpenChange={(open) =>
          !open && !uploadMutation.isPending && setStagedFiles([])
        }
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Upload {stagedFiles.length} file
              {stagedFiles.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              These files will be uploaded to{" "}
              <strong>{folder?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
            {stagedFiles.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded border border-border-2 bg-bg-1 px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-text-3" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-text-1">
                    {f.name}
                  </span>
                  <span className="text-[11px] text-text-3">
                    {formatBytes(f.size)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeStagedFile(i)}
                  disabled={uploadMutation.isPending}
                  className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Visibility picker — same UX as the root /knowledge-core
              upload dialog. Open to all users; 'admins' is filtered
              out for non-admin callers (BE rejects it too). Team
              checkbox panel below appears when 'teams' is active. */}
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="text-[12px] font-medium text-text-1">
              Visibility
            </label>
            <Select
              value={stagedVisibility}
              onValueChange={(v) =>
                setStagedVisibility(v as KnowledgeFileVisibility)
              }
              disabled={uploadMutation.isPending}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone in the company</SelectItem>
                {isAdmin && (
                  <SelectItem value="admins">Admins only</SelectItem>
                )}
                <SelectItem value="teams">Specific teams…</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {stagedVisibility === "admins"
                ? "Only admins will see these files in chat / arena. You can change this later from the file's action menu."
                : stagedVisibility === "teams"
                  ? "Only members of the teams you pick below will see these files in chat / arena."
                  : "Every user in the company can see these files in chat / arena."}
            </p>
          </div>

          {stagedVisibility === "teams" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                Teams with access
              </label>
              {userTeams.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  You aren&rsquo;t a member of any team yet — create or
                  join a team first to use this visibility option.
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userTeams.map((t) => {
                    const checked = stagedTeamIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={uploadMutation.isPending}
                          onChange={() => {
                            setStagedTeamIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id],
                            );
                          }}
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

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStagedFiles([]);
                setStagedVisibility("all");
                setStagedTeamIds([]);
              }}
              disabled={uploadMutation.isPending}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmUpload}
              disabled={uploadMutation.isPending || stagedFiles.length === 0}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete File Dialog */}
      <Dialog
        open={deleteFileId !== null}
        onOpenChange={(open) => !open && setDeleteFileId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>{deleteFileName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFileId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteFileId) {
                  deleteMutation.mutate(deleteFileId);
                  setDeleteFileId(null);
                }
              }}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete confirmation. Same wording as the single-file
          variant — the bulk mutation handles per-file failures
          gracefully and surfaces an aggregated toast. */}
      <Dialog
        open={bulkDeleteOpen}
        onOpenChange={(open) =>
          !open && !bulkDeleteMutation.isPending && setBulkDeleteOpen(false)
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size} file
              {selectedIds.size !== 1 ? "s" : ""}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the selected files and all of
              their embeddings. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteMutation.isPending}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate()}
              disabled={bulkDeleteMutation.isPending}
              className="cursor-pointer"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
