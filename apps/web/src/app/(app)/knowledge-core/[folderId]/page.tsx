"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  FileText,
  Files,
  FolderInput,
  Folder,
  Loader2,
  MoreVertical,
  RotateCw,
  Search,
  Settings2,
  Shield,
  Trash2,
  Unplug,
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
  fetchAllKnowledgeFiles,
  fetchProjects,
  fetchTeams,
  uploadKnowledgeFiles,
  updateKnowledgeFileVisibility,
  updateKnowledgeFilesVisibilityBulk,
  reingestKnowledgeFile,
  untrainKnowledgeFile,
  moveKnowledgeFile,
  deleteKnowledgeFile,
  deleteKnowledgeFolder,
  ALL_FILES_FOLDER_ID,
  type KnowledgeFileVisibility,
  type KnowledgeFolderDetail,
  type KnowledgeUploadNameConflict,
  type NameConflictAction,
} from "@/lib/api";
import { useAuth } from "@/components/providers";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { ChangeFileVisibilityDialog } from "@/components/change-file-visibility-dialog";
import { KnowledgeNameConflictDialog } from "@/components/knowledge-name-conflict-dialog";
import { Pagination } from "@/components/ui/pagination";
import { useLanguage } from "@/lib/i18n";

const TYPE_STYLES: Record<string, string> = {
  PDF: "bg-danger-1 text-danger-6",
  DOCX: "bg-primary-1 text-primary-7",
  XLSX: "bg-success-1 text-success-7",
  XLS: "bg-success-1 text-success-7",
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
 *   pending / processing → Loader2 spinner, "Queued" / "Adding"
 *   done                 → success check, "In context"
 *   untrained            → unplug glyph, "Excluded" — embeddings
 *                          dropped, file row still on disk
 *   failed               → warning triangle, "Skipped" + tooltip with
 *                          the underlying error so unsupported types
 *                          don't look broken
 */
function IngestionStatusBadge({
  status,
  error,
}: {
  status: "pending" | "processing" | "done" | "failed" | "untrained";
  error?: string | null;
}) {
  const { t } = useLanguage();
  if (status === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-7">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        {t("kcFolder.inContext")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title={error ?? t("kcFolder.couldExtract")}
      >
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        {t("kcFolder.skipped")}
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
        title={t("kcFolder.excludedTitle")}
      >
        <Unplug className="h-3 w-3" strokeWidth={2} />
        {t("kcFolder.excluded")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      {status === "processing" ? t("kcFolder.adding") : t("kcFolder.queued")}
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
  projects = [],
}: {
  visibility: KnowledgeFileVisibility;
  teams?: { id: string; name: string }[];
  projects?: { id: string; name: string }[];
}) {
  const { t } = useLanguage();
  if (visibility === "admins") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title={t("kcFolder.adminsOnlyTitle")}
      >
        <Shield className="h-3 w-3" strokeWidth={2} />
        {t("kcFolder.adminsOnly")}
      </span>
    );
  }
  if (visibility === "teams") {
    const names = teams.map((team) => team.name).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-7"
        title={
          names.length > 0
            ? `${t("kcFolder.teamsTooltipPrefix")} ${names}.`
            : t("kcFolder.teamsEmptyTooltip")
        }
      >
        <Users className="h-3 w-3" strokeWidth={2} />
        {teams.length > 0 ? `${t("kcFolder.teams")} (${teams.length})` : t("kcFolder.teams")}
      </span>
    );
  }
  if (visibility === "project") {
    const names = projects.map((p) => p.name).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-7"
        title={
          names.length > 0
            ? `${t("kcFolder.projectsTooltipPrefix")} ${names}.`
            : t("kcFolder.projectsEmptyTooltip")
        }
      >
        <Folder className="h-3 w-3" strokeWidth={2} />
        {projects.length > 0 ? `${t("kcFolder.projects")} (${projects.length})` : t("kcFolder.project")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
      title={t("kcFolder.everyoneTitle")}
    >
      <Users className="h-3 w-3" strokeWidth={2} />
      {t("kcFolder.everyone")}
    </span>
  );
}

export default function FolderDetailPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { t } = useLanguage();
  const { folderId } = use(params);
  // Virtual "All Files" view — not a real folder. We reuse the exact
  // same query key + folder-detail shape so every per-file mutation's
  // `["knowledge-folder", folderId]` invalidation already refreshes
  // this list with no extra wiring. fetchAllKnowledgeFiles() returns
  // the same KnowledgeFile shape; the synthesized wrapper just has no
  // children / breadcrumb so the folder-only UI below collapses.
  const isAllFiles = folderId === ALL_FILES_FOLDER_ID;
  const [query, setQuery] = useState("");
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const isPersonal = useIsPersonal();

  const queryClient = useQueryClient();

  const { data: folder, isLoading } = useQuery({
    queryKey: ["knowledge-folder", folderId],
    queryFn: isAllFiles
      ? async (): Promise<KnowledgeFolderDetail> => {
          // Newest first with a stable `id` tiebreaker is applied by the
          // backend (ORDER BY created_at DESC, id DESC), so the most
          // recently added file is at the top and exclude/include never
          // reshuffles tied rows. No client-side re-sort needed.
          const files = await fetchAllKnowledgeFiles();
          return {
            id: ALL_FILES_FOLDER_ID,
            name: "All Files",
            ownerId: "",
            parentFolderId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files,
            children: [],
            breadcrumb: [],
          };
        }
      : () => fetchKnowledgeFolder(folderId),
    enabled: !!folderId,
    // Auto-poll while ingestion is still in flight so the status
    // badge transitions Queued → Adding → In context without the
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

  // Same-name-different-content conflicts surfaced by the BE on the
  // last upload call. Held in state so the resolution dialog can
  // re-trigger an upload of *only* the conflicting files once the
  // user picks per-name actions. `pendingFiles` is the original
  // File[] from the first call so we don't ask the user to re-pick
  // them in the OS file dialog.
  const [pendingConflicts, setPendingConflicts] = useState<{
    conflicts: KnowledgeUploadNameConflict[];
    files: File[];
    visibility: KnowledgeFileVisibility;
    teamIds: string[];
    projectIds: string[];
  } | null>(null);

  const uploadMutation = useMutation({
    mutationFn: ({
      files,
      visibility,
      teamIds,
      projectIds,
      nameConflictActions,
    }: {
      files: File[];
      visibility: KnowledgeFileVisibility;
      teamIds: string[];
      projectIds: string[];
      nameConflictActions?: Record<string, NameConflictAction>;
    }) =>
      uploadKnowledgeFiles(
        folderId,
        files,
        visibility,
        teamIds,
        projectIds,
        nameConflictActions,
      ),
    onSuccess: ({ uploaded, duplicates, nameConflicts }, variables) => {
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
        toast.success(`${t("kcFolder.uploadedN1")} ${uploaded.length} ${t("kcFolder.uploadedN2")}`);
      }
      if (duplicates.length > 0) {
        const titleForOne = (d: (typeof duplicates)[number]) =>
          d.existing.name && d.existing.name !== d.name
            ? `"${d.name}" ${t("kcFolder.matchesExisting1")} "${d.existing.name}" ${t("kcFolder.matchesExisting2")}`
            : `"${d.name}" ${t("kcFolder.alreadyInKC")}`;
        toast.info(
          duplicates.length === 1
            ? titleForOne(duplicates[0])
            : `${duplicates.length} ${t("kcFolder.multipleInKC")}`,
          {
            description: duplicates
              .map((d) =>
                d.existing.name && d.existing.name !== d.name
                  ? `"${d.name}" matches "${d.existing.name}" → "${d.existing.folderName}"`
                  : `"${d.name}" → "${d.existing.folderName}"`,
              )
              .join("\n"),
          },
        );
      }
      // Name conflicts kick off a separate resolution dialog. If we
      // get here with conflicts AFTER the user already picked
      // actions in the prior pass, treat it as a no-op + a warning
      // — re-opening the dialog would loop on 'skip' picks.
      if (nameConflicts.length > 0) {
        if (variables.nameConflictActions) {
          toast.info(
            `${nameConflicts.length} ${t("kcFolder.skippedN")}`,
            {
              description: nameConflicts
                .map((c) => `"${c.name}"`)
                .join("\n"),
            },
          );
          return;
        }
        setPendingConflicts({
          conflicts: nameConflicts,
          files: variables.files,
          visibility: variables.visibility,
          teamIds: variables.teamIds,
          projectIds: variables.projectIds,
        });
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("kcFolder.failedUpload")),
  });

  const resolveNameConflicts = (
    actions: Record<string, NameConflictAction>,
  ) => {
    if (!pendingConflicts) return;
    // Re-upload only the files the user *actually* wants to act on
    // — anything left as 'skip' is dropped client-side so we don't
    // round-trip just to have the BE bounce it back unchanged.
    const conflictNames = new Set(
      pendingConflicts.conflicts.map((c) => c.name),
    );
    const filesToResend = pendingConflicts.files.filter(
      (f) => conflictNames.has(f.name) && actions[f.name] !== "skip",
    );
    const skippedCount = pendingConflicts.conflicts.filter(
      (c) => (actions[c.name] ?? "skip") === "skip",
    ).length;
    setPendingConflicts(null);
    if (filesToResend.length === 0) {
      if (skippedCount > 0) {
        toast.info(t("kcFolder.skippedConflict").replace("{n}", String(skippedCount)));
      }
      return;
    }
    uploadMutation.mutate({
      files: filesToResend,
      visibility: pendingConflicts.visibility,
      teamIds: pendingConflicts.teamIds,
      projectIds: pendingConflicts.projectIds,
      nameConflictActions: actions,
    });
  };

  // Single-file include-in-context. Mirror of the root /knowledge-
  // core page; see its comment for details.
  const reingestMutation = useMutation({
    mutationFn: (fileId: string) => reingestKnowledgeFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(t("kcFolder.addingToContext"));
    },
    onError: (err: Error) =>
      toast.error(
        err.message || t("kcFolder.failedInclude"),
      ),
  });

  // Inverse — drops the file's embeddings so chat RAG ignores it,
  // but keeps the row + disk copy. See the root page's mutation
  // comment for the BE-side semantics.
  const untrainMutation = useMutation({
    mutationFn: (fileId: string) => untrainKnowledgeFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(t("kcFolder.excludedFromContext"));
    },
    onError: (err: Error) =>
      toast.error(
        err.message || t("kcFolder.failedExclude"),
      ),
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
          ? t("kcFolder.adminsOnlyToast")
          : t("kcFolder.everyoneToast"),
      );
    },
    onError: (err: Error) =>
      toast.error(err.message || t("kcFolder.failedVisibility")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeFile,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", folderId],
      });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(t("kcFolder.fileDeleted"));
    },
    onError: () => toast.error(t("kcFolder.failedDelete")),
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
      // In the virtual "All Files" view `folderId` is the sentinel, not
      // the file's real source folder — invalidate the file's actual
      // source so it doesn't linger there until a hard refetch.
      if (isAllFiles) {
        const sourceFolderId = folder?.files.find(
          (f) => f.id === moveFileId,
        )?.folderId;
        if (sourceFolderId) {
          queryClient.invalidateQueries({
            queryKey: ["knowledge-folder", sourceFolderId],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      setMoveFileId(null);
      setMoveTargetId("");
      toast.success(t("kcFolder.fileMoved"));
    },
    onError: () => toast.error(t("kcFolder.failedMove")),
  });

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // Per-batch visibility staging. Same lifecycle as on the root
  // /knowledge-core page: select is open to all users, reset to
  // 'all' after each confirmed upload so the choice doesn't leak
  // across batches. Team / project IDs reset alongside visibility.
  const [stagedVisibility, setStagedVisibility] =
    useState<KnowledgeFileVisibility>("all");
  const [stagedTeamIds, setStagedTeamIds] = useState<string[]>([]);
  const [stagedProjectIds, setStagedProjectIds] = useState<string[]>([]);

  // Same user-teams list the root page renders. Cached by react-query
  // key 'teams' so navigating between KC pages reuses one fetch.
  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "kc-upload"],
    queryFn: () => fetchProjects("all"),
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
          ? `${res.affectedIds.length} ${t("kcFolder.bulkAdminToast")}`
          : `${res.affectedIds.length} ${t("kcFolder.bulkEveryoneToast")}`;
      if (res.skippedIds.length === 0) {
        toast.success(updatedCopy);
      } else if (res.affectedIds.length === 0) {
        toast.warning(
          t("kcFolder.allMidIngestion").replace("{n}", String(res.skippedIds.length)),
        );
      } else {
        toast.warning(
          `${updatedCopy} ${t("kcFolder.partialIngestion").replace("{n}", String(res.skippedIds.length))}`,
        );
      }
      clearSelection();
    },
    onError: (err: Error) =>
      toast.error(err.message || t("kcFolder.failedVisibility")),
  });

  // Bulk include + delete fan out to the existing per-file
  // endpoints via Promise.allSettled — same per-row gates (owner
  // check, status='processing' block for include) apply, just
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
        toast.success(t("kcFolder.addingN").replace("{n}", String(fulfilled)));
      } else if (fulfilled === 0) {
        toast.error(
          t("kcFolder.couldntAddAny").replace("{n}", String(rejected)),
        );
      } else {
        toast.warning(
          t("kcFolder.partiallyAdded").replace("{ok}", String(fulfilled)).replace("{fail}", String(rejected)),
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
        toast.success(t("kcFolder.deletedN").replace("{n}", String(fulfilled)));
      } else if (fulfilled === 0) {
        toast.error(t("kcFolder.deleteFailedAll").replace("{n}", String(rejected)));
      } else {
        toast.warning(
          t("kcFolder.partiallyDeleted").replace("{ok}", String(fulfilled)).replace("{fail}", String(rejected)),
        );
      }
      clearSelection();
      setBulkDeleteOpen(false);
    },
  });
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const deleteFileName =
    folder?.files.find((f) => f.id === deleteFileId)?.name ?? "";

  // Subfolder delete — same confirm-dialog pattern as root /knowledge-core
  const [deleteSubfolderId, setDeleteSubfolderId] = useState<string | null>(null);
  const deleteSubfolderName =
    folder?.children.find((c) => c.id === deleteSubfolderId)?.name ?? "";

  const deleteSubfolderMutation = useMutation({
    mutationFn: (id: string) => deleteKnowledgeFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folder", folderId] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      setDeleteSubfolderId(null);
      toast.success(t("kcFolder.folderDeleted"));
    },
    onError: () => toast.error(t("kcFolder.failedDeleteFolder")),
  });

  // Same pattern as on the root /knowledge-core page — full
  // visibility editor lives in a shared dialog, opened per file by
  // the dropdown menu item.
  const [editingVisibilityFileId, setEditingVisibilityFileId] = useState<
    string | null
  >(null);
  const editingVisibilityFile =
    folder?.files.find((f) => f.id === editingVisibilityFileId) ?? null;

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setStagedFiles(files);
    e.target.value = "";
  };

  const confirmUpload = () => {
    if (stagedFiles.length === 0) return;
    if (stagedVisibility === "teams" && stagedTeamIds.length === 0) {
      toast.error(t("kcFolder.pickTeam"));
      return;
    }
    if (stagedVisibility === "project" && stagedProjectIds.length === 0) {
      toast.error(t("kcFolder.pickProject"));
      return;
    }
    uploadMutation.mutate({
      files: stagedFiles,
      visibility: stagedVisibility,
      teamIds: stagedTeamIds,
      projectIds: stagedProjectIds,
    });
    setStagedFiles([]);
    setStagedVisibility("all");
    setStagedTeamIds([]);
    setStagedProjectIds([]);
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

  // Page state for the folder's file list. 10 rows/page; resets on
  // search change so the user lands on a populated page when the
  // result set shrinks. Both the desktop table and the mobile card
  // grid read `pagedFiles` so they paginate in lockstep.
  const FILES_PAGE_SIZE = 10;
  const [filesPage, setFilesPage] = useState(1);
  useEffect(() => {
    setFilesPage(1);
  }, [query]);
  const filesTotalPages = Math.max(
    1,
    Math.ceil(filtered.length / FILES_PAGE_SIZE),
  );
  const pagedFiles = useMemo(
    () =>
      filtered.slice(
        (filesPage - 1) * FILES_PAGE_SIZE,
        filesPage * FILES_PAGE_SIZE,
      ),
    [filtered, filesPage],
  );
  useEffect(() => {
    if (filesPage > filesTotalPages) setFilesPage(filesTotalPages);
  }, [filesPage, filesTotalPages]);

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
      {/* Breadcrumbs — KC root → every ancestor → current. Replaces
          the old "Back to Folders" link so users can jump up several
          levels at once instead of clicking Back repeatedly. Current
          folder is non-clickable; ancestors are links. */}
      <nav
        aria-label={t("kcFolder.breadcrumb")}
        className="flex flex-wrap items-center gap-1 text-[14px] text-text-3"
      >
        <Link
          href="/knowledge-core"
          className="cursor-pointer hover:text-primary-6"
        >
          {t("kcFolder.folders")}
        </Link>
        {folder.breadcrumb.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <span className="text-text-3/60">/</span>
            <Link
              href={`/knowledge-core/${crumb.id}`}
              className="cursor-pointer hover:text-primary-6"
            >
              {crumb.name}
            </Link>
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="text-text-3/60">/</span>
          <span className="text-text-1 font-medium">
            {isAllFiles ? t("kcFolder.allFilesName") : folder.name}
          </span>
        </span>
      </nav>

      {/* Folder info card */}
      <div className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {isAllFiles ? (
            <Files
              className="h-10 w-10 shrink-0 text-primary-6"
              strokeWidth={1.5}
            />
          ) : (
            <Folder
              className="h-10 w-10 shrink-0 text-primary-6"
              strokeWidth={1.5}
            />
          )}
          <div className="flex flex-col">
            <h1 className="text-[20px] font-bold text-text-1">
              {isAllFiles ? t("kcFolder.allFilesName") : folder.name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-text-3">
              <span>{folder.files.length} {t("kcFolder.files")}</span>
              <span>{formatBytes(totalBytes)} {t("kcFolder.totalSuffix")}</span>
              {/* The virtual view has no real modified time — only show
                  it for real folders. */}
              {!isAllFiles && (
                <span>
                  {t("kcFolder.lastModified")} {formatDate(folder.updatedAt)}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* No upload target for the virtual aggregate — uploads happen
            inside a real folder (or the KC root dropzone). */}
        {!isAllFiles && (
          <label>
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.xls,.xlsx"
              className="hidden"
              onChange={handleBrowse}
            />
            <Button
              asChild
              className="shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
            >
              <span>
                <Upload className="h-4 w-4" />
                {t("kcFolder.uploadFiles")}
              </span>
            </Button>
          </label>
        )}
      </div>

      {/* Subfolders section — only when this folder has children.
          Same card layout as the KC root folder grid so the user
          gets a familiar drill-down experience. Drive imports
          surface here ("Google Drive" parent shows "Test" / etc.
          as children); user-created nested folders show up the
          same way. */}
      {folder.children.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-[16px] font-bold text-text-1">{t("kcFolder.subfolders")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {folder.children.map((child) => (
              <Link
                key={child.id}
                href={`/knowledge-core/${child.id}`}
                className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-6 transition-colors hover:bg-primary-1"
              >
                <div className="flex items-start justify-between">
                  <Folder
                    className="h-8 w-8 text-primary-6"
                    strokeWidth={1.5}
                  />
                  {/* Intercept click so the Link doesn't navigate when
                      the user opens / interacts with the dropdown. */}
                  <div
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
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
                        <DropdownMenuItem
                          onSelect={() => setDeleteSubfolderId(child.id)}
                          className="text-danger-6 focus:text-danger-6"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="truncate text-[15px] font-semibold text-text-1">
                    {child.name}
                  </span>
                  <span className="text-[12px] text-text-3">
                    {child.fileCount} {child.fileCount === 1 ? t("kcFolder.file") : t("kcFolder.files")} ·{" "}
                    {formatBytes(child.totalBytes)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Search */}
      <div className="relative sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("kcFolder.searchFiles")}
          className="h-10 pl-9 placeholder:text-text-3"
        />
      </div>

      {/* Bulk action bar. Renders sticky above the table whenever the
          user has at least one row selected. Visibility buttons are
          admin-only — matches the per-file action menu gate; include
          and delete are owner-only (BE filters anyway, FE just lets
          the user fire it). */}
      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-primary-2 bg-primary-1/40 px-4 py-3 backdrop-blur">
          <span className="text-[13px] font-semibold text-text-1">
            {selectedIds.size} {selectedIds.size !== 1 ? t("kcFolder.files") : t("kcFolder.file")}{" "}
            {t("kcFolder.filesSelected")}
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
                  {t("kcFolder.adminOnly")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkVisibilityMutation.mutate("all")}
                  disabled={bulkBusy}
                  className="cursor-pointer gap-1.5"
                >
                  <Users className="h-3.5 w-3.5" />
                  {t("kcFolder.visibleEveryone")}
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
              {t("kcFolder.includeInContext")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkBusy}
              className="cursor-pointer gap-1.5 border-danger-3 text-danger-6 hover:bg-danger-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("kcFolder.delete")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={bulkBusy}
              className="cursor-pointer"
            >
              {t("kcFolder.cancel")}
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
                    aria-label={t("kcFolder.selectAll")}
                    checked={headerCheckboxState}
                    onCheckedChange={toggleSelectAllFiltered}
                    disabled={filtered.length === 0}
                  />
                </th>
                <th className="px-5 py-3">{t("kcFolder.colName")}</th>
                <th className="px-5 py-3">{t("kcFolder.colType")}</th>
                <th className="px-5 py-3">{t("kcFolder.colSize")}</th>
                <th className="px-5 py-3">{t("kcFolder.colUploadedBy")}</th>
                <th className="px-5 py-3">{t("kcFolder.colDate")}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {pagedFiles.map((f) => (
                <tr
                  key={f.id}
                  className={`border-b border-border-2 last:border-b-0 transition-colors hover:bg-bg-1 ${
                    selectedIds.has(f.id) ? "bg-primary-1/30" : ""
                  }`}
                >
                  <td className="px-5 py-4">
                    <Checkbox
                      aria-label={`${t("kcFolder.selectFile")} ${f.name}`}
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
                      <VisibilityBadge
                        visibility={f.visibility}
                        teams={f.teams}
                        projects={f.projects}
                      />
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
                            {t("kcFolder.download")}
                          </a>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setMoveFileId(f.id);
                            setMoveTargetId("");
                          }}
                        >
                          <FolderInput className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.moveTo")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => reingestMutation.mutate(f.id)}
                          disabled={
                            f.ingestionStatus === "processing" ||
                            reingestMutation.isPending
                          }
                        >
                          <RotateCw className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.includeInContext")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => untrainMutation.mutate(f.id)}
                          disabled={
                            f.ingestionStatus === "processing" ||
                            f.ingestionStatus === "untrained" ||
                            untrainMutation.isPending
                          }
                        >
                          <Unplug className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.excludeFromContext")}
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
                                {t("kcFolder.makeVisibleEveryone")}
                              </>
                            ) : (
                              <>
                                <Shield className="mr-2 h-3.5 w-3.5" />
                                {t("kcFolder.makeAdminOnly")}
                              </>
                            )}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() => setEditingVisibilityFileId(f.id)}
                          disabled={f.ingestionStatus === "processing"}
                        >
                          <Settings2 className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.changeVisibility")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => handleDelete(f.id)}
                          className="text-danger-6 focus:text-danger-6"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.delete")}
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
                      ? t("kcFolder.noFilesMatch")
                      : t("kcFolder.noFilesYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col md:hidden">
          {pagedFiles.map((f, idx) => (
            <div
              key={f.id}
              className={`flex items-center gap-3 px-4 py-4 ${idx > 0 ? "border-t border-border-2" : ""} ${
                selectedIds.has(f.id) ? "bg-primary-1/30" : ""
              }`}
            >
              <Checkbox
                aria-label={`${t("kcFolder.selectFile")} ${f.name}`}
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
                  <VisibilityBadge
                        visibility={f.visibility}
                        teams={f.teams}
                        projects={f.projects}
                      />
                </div>
                <span className="text-[12px] text-text-3">
                  {formatBytes(f.sizeBytes)} •{" "}
                  {f.uploadedByName ?? t("kcFolder.unknown")} •{" "}
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
                    {t("kcFolder.moveTo")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => reingestMutation.mutate(f.id)}
                    disabled={
                      f.ingestionStatus === "processing" ||
                      reingestMutation.isPending
                    }
                  >
                    <RotateCw className="mr-2 h-3.5 w-3.5" />
                    {t("kcFolder.includeInContext")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => untrainMutation.mutate(f.id)}
                    disabled={
                      f.ingestionStatus === "processing" ||
                      f.ingestionStatus === "untrained" ||
                      untrainMutation.isPending
                    }
                  >
                    <Unplug className="mr-2 h-3.5 w-3.5" />
                    {t("kcFolder.excludeFromContext")}
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
                          {t("kcFolder.makeVisibleEveryone")}
                        </>
                      ) : (
                        <>
                          <Shield className="mr-2 h-3.5 w-3.5" />
                          {t("kcFolder.makeAdminOnly")}
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => setEditingVisibilityFileId(f.id)}
                    disabled={f.ingestionStatus === "processing"}
                  >
                    <Settings2 className="mr-2 h-3.5 w-3.5" />
                    {t("kcFolder.changeVisibility")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => handleDelete(f.id)}
                    className="text-danger-6 focus:text-danger-6"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t("kcFolder.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {query
                ? t("kcFolder.noFilesMatch")
                : t("kcFolder.noFilesYetShort")}
            </p>
          )}
        </div>

        <Pagination
          page={filesPage}
          totalPages={filesTotalPages}
          onPageChange={setFilesPage}
          className="px-4"
        />
      </div>

      {/* Move file dialog */}
      <Dialog
        open={moveFileId !== null}
        onOpenChange={(open) => !open && setMoveFileId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("kcFolder.moveFile")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-text-2">
            {t("kcFolder.movePrefix")} <strong>{moveFileName}</strong> {t("kcFolder.moveSuffix")}
          </p>
          <Select value={moveTargetId} onValueChange={setMoveTargetId}>
            <SelectTrigger className="w-full cursor-pointer data-[size=default]:h-10">
              <SelectValue placeholder={t("kcFolder.selectFolder")} />
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
              {t("kcFolder.cancel")}
            </Button>
            <Button
              onClick={() => moveMutation.mutate()}
              disabled={!moveTargetId || moveMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {moveMutation.isPending ? t("kcFolder.moving") : t("kcFolder.move")}
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
              {t("kcFolder.uploadTitle")} {stagedFiles.length} {stagedFiles.length !== 1 ? t("kcFolder.files") : t("kcFolder.file")}
            </DialogTitle>
            <DialogDescription>
              {t("kcFolder.uploadDescPrefix")}{" "}
              <strong>{folder?.name}</strong>{t("kcFolder.uploadDescSuffix")}
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
              {t("kcFolder.visibility")}
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
                <SelectItem value="all">
                  {isPersonal
                    ? t("knowledgeCore.visibilityOnlyMe")
                    : t("kcFolder.everyoneOpt")}
                </SelectItem>
                {isAdmin && (
                  <SelectItem value="admins">{t("kcFolder.adminsOpt")}</SelectItem>
                )}
                {!isPersonal && (
                  <SelectItem value="teams">{t("kcFolder.specificTeams")}</SelectItem>
                )}
                <SelectItem value="project">{t("kcFolder.specificProject")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {stagedVisibility === "admins"
                ? t("kcFolder.hintAdmins")
                : stagedVisibility === "teams"
                  ? t("kcFolder.hintTeams")
                  : stagedVisibility === "project"
                    ? t("kcFolder.hintProject")
                    : t("kcFolder.hintEveryone")}
            </p>
          </div>

          {stagedVisibility === "teams" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                {t("kcFolder.teamsWithAccess")}
              </label>
              {userTeams.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  {t("kcFolder.notTeamMember")}
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userTeams.map((team) => {
                    const checked = stagedTeamIds.includes(team.id);
                    return (
                      <label
                        key={team.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={uploadMutation.isPending}
                          onChange={() => {
                            setStagedTeamIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== team.id)
                                : [...prev, team.id],
                            );
                          }}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">{team.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {stagedVisibility === "project" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                {t("kcFolder.projectsWithAccess")}
              </label>
              {userProjects.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  {t("kcFolder.noProjectAccess")}
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userProjects.map((p) => {
                    const checked = stagedProjectIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={uploadMutation.isPending}
                          onChange={() => {
                            setStagedProjectIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== p.id)
                                : [...prev, p.id],
                            );
                          }}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">
                          {p.name}
                          {p.teamName ? (
                            <span className="ml-1 text-text-3">
                              · {p.teamName}
                            </span>
                          ) : null}
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
              onClick={() => {
                setStagedFiles([]);
                setStagedVisibility("all");
                setStagedTeamIds([]);
                setStagedProjectIds([]);
              }}
              disabled={uploadMutation.isPending}
              className="cursor-pointer"
            >
              {t("kcFolder.cancel")}
            </Button>
            <Button
              onClick={confirmUpload}
              disabled={uploadMutation.isPending || stagedFiles.length === 0}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {uploadMutation.isPending ? t("kcFolder.uploading") : t("kcFolder.upload")}
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
            <DialogTitle>{t("kcFolder.deleteFileTitle")}</DialogTitle>
            <DialogDescription>
              {t("kcFolder.deleteFileDesc1")}{" "}
              <strong>{deleteFileName}</strong>{t("kcFolder.deleteFileDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFileId(null)}
              className="cursor-pointer"
            >
              {t("kcFolder.cancel")}
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
              {deleteMutation.isPending ? t("kcFolder.deleting") : t("kcFolder.delete")}
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
              {t("kcFolder.deleteNFilesTitle")} {selectedIds.size} {selectedIds.size !== 1 ? t("kcFolder.files") : t("kcFolder.file")}{t("kcFolder.deleteNFilesSuffix")}
            </DialogTitle>
            <DialogDescription>
              {t("kcFolder.deleteNFilesDesc")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteMutation.isPending}
              className="cursor-pointer"
            >
              {t("kcFolder.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => bulkDeleteMutation.mutate()}
              disabled={bulkDeleteMutation.isPending}
              className="cursor-pointer"
            >
              {bulkDeleteMutation.isPending ? t("kcFolder.deleting") : t("kcFolder.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Subfolder confirm dialog */}
      <Dialog
        open={deleteSubfolderId !== null}
        onOpenChange={(open) =>
          !open && !deleteSubfolderMutation.isPending && setDeleteSubfolderId(null)
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("kcFolder.deleteFolderTitle")}</DialogTitle>
            <DialogDescription>
              {t("kcFolder.deleteFolderDesc1")}{" "}
              <strong>{deleteSubfolderName}</strong> {t("kcFolder.deleteFolderDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteSubfolderId(null)}
              disabled={deleteSubfolderMutation.isPending}
              className="cursor-pointer"
            >
              {t("kcFolder.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteSubfolderId)
                  deleteSubfolderMutation.mutate(deleteSubfolderId);
              }}
              disabled={deleteSubfolderMutation.isPending}
              className="cursor-pointer"
            >
              {deleteSubfolderMutation.isPending ? t("kcFolder.deleting") : t("kcFolder.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full visibility editor — same shared dialog the root KC
          page uses; opened per file via the dropdown menu. */}
      <ChangeFileVisibilityDialog
        file={editingVisibilityFile}
        open={editingVisibilityFile !== null}
        onOpenChange={(open) => {
          if (!open) setEditingVisibilityFileId(null);
        }}
        isAdmin={isAdmin}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["knowledge-folder", folderId],
          });
          queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
          queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
        }}
      />

      {/* Same-name resolution. Only fires when the BE flagged at
          least one file as conflicting in this folder under the
          same uploader; user picks overwrite / keep both / skip
          per file (or in bulk) and we re-upload accordingly. */}
      <KnowledgeNameConflictDialog
        open={pendingConflicts !== null}
        conflicts={pendingConflicts?.conflicts ?? []}
        onResolve={resolveNameConflicts}
        onCancel={() => setPendingConflicts(null)}
      />
    </div>
  );
}
