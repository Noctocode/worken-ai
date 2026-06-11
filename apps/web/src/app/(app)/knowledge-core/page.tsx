"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Files,
  Folder,
  FolderInput,
  Loader2,
  MoreVertical,
  Plus,
  Download,
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
import {
  fetchKnowledgeFolders,
  fetchProjects,
  fetchRecentKnowledgeFiles,
  fetchTeams,
  createKnowledgeFolder,
  deleteKnowledgeFolder,
  uploadKnowledgeFiles,
  updateKnowledgeFileVisibility,
  reingestKnowledgeFile,
  untrainKnowledgeFile,
  moveKnowledgeFile,
  deleteKnowledgeFile,
  ALL_FILES_FOLDER_ID,
  UPLOADS_FOLDER_NAME,
  type KnowledgeFileVisibility,
  type KnowledgeUploadNameConflict,
  type NameConflictAction,
} from "@/lib/api";
import { useAuth } from "@/components/providers";
import { DriveSection } from "@/components/drive-section";
import { OneDriveSection } from "@/components/onedrive-section";
import { SharePointSection } from "@/components/sharepoint-section";
import { ConfluenceSection } from "@/components/confluence-section";
import { KnowledgeNameConflictDialog } from "@/components/knowledge-name-conflict-dialog";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChangeFileVisibilityDialog } from "@/components/change-file-visibility-dialog";
import { useLanguage } from "@/lib/i18n";

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
 * Context-availability pill — same vocabulary as the folder detail
 * page. Wording is intentionally about "context" (what chat / arena
 * can pull from at answer time); no model weights are actually
 * updated by ingestion — embeddings get added to or removed from
 * the RAG index. Inline-duplicated rather than imported because the
 * two pages currently don't share a components file for this domain.
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
        {t("knowledgeCore.inContext")}
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
        {t("knowledgeCore.skipped")}
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
        title={t("knowledgeMain.titleExcluded")}
      >
        <Unplug className="h-3 w-3" strokeWidth={2} />
        {t("knowledgeCore.excluded")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      {status === "processing" ? t("knowledgeCore.adding") : t("knowledgeCore.queued")}
    </span>
  );
}

/**
 * Compact "who can see this file" pill. Admin-only files get the
 * shield treatment so it reads as a privilege gate at a glance; the
 * default 'all' state uses the muted Users glyph so the row doesn't
 * scream a designation that's the unremarkable default. Kept inline
 * (not a shared component) for the same reason as IngestionStatusBadge.
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
        title={t("knowledgeMain.titleAdminsOnly")}
      >
        <Shield className="h-3 w-3" strokeWidth={2} />
        {t("knowledgeCore.adminsOnly")}
      </span>
    );
  }
  if (visibility === "teams") {
    const names = teams.map((tm) => tm.name).join(", ");
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-7"
        title={
          names.length > 0
            ? t("knowledgeMain.titleTeamsList").replace("{names}", names)
            : t("knowledgeMain.titleNoTeams")
        }
      >
        <Users className="h-3 w-3" strokeWidth={2} />
        {teams.length > 0
          ? t("knowledgeMain.labelTeamsCount").replace("{n}", String(teams.length))
          : t("knowledgeMain.labelTeams")}
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
            ? t("knowledgeMain.titleProjectsList").replace("{names}", names)
            : t("knowledgeMain.titleNoProjects")
        }
      >
        <Folder className="h-3 w-3" strokeWidth={2} />
        {projects.length > 0
          ? t("knowledgeMain.labelProjectsCount").replace("{n}", String(projects.length))
          : t("knowledgeMain.labelProject")}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
      title={t("knowledgeMain.titleCompanyWide")}
    >
      <Users className="h-3 w-3" strokeWidth={2} />
      {t("knowledgeCore.everyone")}
    </span>
  );
}

export default function KnowledgeCorePage() {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const [query, setQuery] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
  }, []);

  useEffect(() => {
    const onSearch = (e: Event) =>
      handleSearch((e as CustomEvent<string>).detail);
    window.addEventListener("knowledge-core:search", onSearch);
    return () =>
      window.removeEventListener("knowledge-core:search", onSearch);
  }, [handleSearch]);

  const queryClient = useQueryClient();

  const { data: folders = [], isLoading: foldersLoading } = useQuery({
    queryKey: ["knowledge-folders"],
    queryFn: fetchKnowledgeFolders,
    refetchOnMount: "always",
  });

  const deleteFolderName =
    folders.find((f) => f.id === deleteFolderId)?.name ?? "";

  const { data: recentFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ["knowledge-recent"],
    queryFn: fetchRecentKnowledgeFiles,
    // Poll while any recent file is still being chunked + embedded so
    // the badge updates without a manual refresh. Stops at terminal
    // state so static lists don't burn the API.
    refetchInterval: (query) => {
      const files = query.state.data;
      if (!files) return false;
      const inProgress = files.some(
        (f) =>
          f.ingestionStatus === "pending" ||
          f.ingestionStatus === "processing",
      );
      return inProgress ? 2000 : false;
    },
  });

  const createMutation = useMutation({
    // Wrap so React Query sees a single-arg mutationFn — the optional
    // parentFolderId on createKnowledgeFolder defaults to null which
    // matches the legacy top-level-only behaviour of this dialog.
    mutationFn: (name: string) => createKnowledgeFolder(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      setNewFolderOpen(false);
      setNewFolderName("");
      toast.success(t("knowledgeMain.toastFolderCreated"));
    },
    onError: () => toast.error(t("knowledgeMain.toastFolderCreateFailed")),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(t("knowledgeMain.toastFolderDeleted"));
    },
    onError: () => toast.error(t("knowledgeMain.toastFolderDeleteFailed")),
  });

  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const moveFileName =
    recentFiles.find((f) => f.id === moveFileId)?.name ?? "";

  const moveMutation = useMutation({
    mutationFn: () => moveKnowledgeFile(moveFileId!, moveTargetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      setMoveFileId(null);
      setMoveTargetId("");
      toast.success(t("knowledgeMain.toastFileMoved"));
    },
    onError: () => toast.error(t("knowledgeMain.toastFileMoveFailed")),
  });

  const deleteFileMutation = useMutation({
    mutationFn: deleteKnowledgeFile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      toast.success(t("knowledgeMain.toastFileDeleted"));
    },
    onError: () => toast.error(t("knowledgeMain.toastFileDeleteFailed")),
  });

  // Re-run chunk + embed on a single file so it's available to chat /
  // arena again. Available to any owner — the BE blocks the call if
  // the file is mid-ingestion (status='processing') so we don't race
  // the worker. After the POST returns, the polling refetchInterval
  // picks up the new 'Queued'/'Adding' badge automatically.
  const reingestMutation = useMutation({
    mutationFn: (fileId: string) => reingestKnowledgeFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folder"] });
      toast.success(t("knowledgeMain.toastAddingContext"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("knowledgeMain.toastIncludeFailed")),
  });

  // Inverse of "Include in context": drop the file's embeddings so
  // chat RAG stops surfacing it, but keep the row + disk copy so
  // Download and re-include still work. BE gates on owner + mid-
  // ingestion the same way the include path does, so we share the
  // same disabled rule on the menu item.
  const untrainMutation = useMutation({
    mutationFn: (fileId: string) => untrainKnowledgeFile(fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folder"] });
      toast.success(t("knowledgeMain.toastExcludedContext"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("knowledgeMain.toastExcludeFailed")),
  });

  // Admin-only PATCH to flip a file's visibility between 'all' and
  // 'admins'. The BE rejects non-admin callers with 403; we hide the
  // menu item entirely below so it's never offered, but the mutation
  // surfaces any 403 in toast for safety in case a future code path
  // exposes it.
  const visibilityMutation = useMutation({
    mutationFn: ({
      fileId,
      visibility,
    }: {
      fileId: string;
      visibility: KnowledgeFileVisibility;
    }) => updateKnowledgeFileVisibility(fileId, visibility),
    onSuccess: (_, { visibility }) => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-folder"] });
      toast.success(
        visibility === "admins"
          ? t("knowledgeMain.toastAdminsOnlyDone")
          : t("knowledgeMain.toastEveryoneDone"),
      );
    },
    onError: (err: Error) =>
      toast.error(err.message || t("knowledgeMain.toastVisibilityFailed")),
  });

  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const deleteFileName =
    recentFiles.find((f) => f.id === deleteFileId)?.name ?? "";

  // Currently-edited file for the full visibility dialog. Stays
  // separate from the inline binary toggle so admins can keep using
  // the one-click admin-only flip for hot rows and reach for the
  // dialog only when they need teams / project tiers.
  const [editingVisibilityFileId, setEditingVisibilityFileId] = useState<
    string | null
  >(null);
  const editingVisibilityFile =
    recentFiles.find((f) => f.id === editingVisibilityFileId) ?? null;

  const handleDeleteFolder = (id: string) => {
    setDeleteFolderId(id);
  };

  const confirmDeleteFolder = () => {
    if (!deleteFolderId) return;
    deleteMutation.mutate(deleteFolderId);
    setDeleteFolderId(null);
  };

  // Dropzone uploads from the KC root need a real destination folder.
  // "All Files" is now a virtual view (see ALL_FILES_FOLDER_ID), so
  // uploads land in a real "Uploads" folder instead — created on the
  // first upload and reused thereafter.
  const getUploadsFolderId = async (): Promise<string> => {
    const existing = folders.find((f) => f.name === UPLOADS_FOLDER_NAME);
    if (existing) return existing.id;
    const created = await createKnowledgeFolder(UPLOADS_FOLDER_NAME);
    await queryClient.refetchQueries({ queryKey: ["knowledge-folders"] });
    return created.id;
  };

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  // Staged visibility for the pending upload batch. Admin-only —
  // non-admin callers don't see the select and uploads ship as 'all'.
  // Reset to 'all' on each new staging so the choice doesn't leak
  // across batches.
  const [stagedVisibility, setStagedVisibility] =
    useState<KnowledgeFileVisibility>("all");
  // Selected team / project IDs for 'teams' / 'project' visibility.
  // Both reset alongside `stagedVisibility` so a previous batch's
  // selection doesn't leak into the next one.
  const [stagedTeamIds, setStagedTeamIds] = useState<string[]>([]);
  const [stagedProjectIds, setStagedProjectIds] = useState<string[]>([]);
  // Held between the first upload and the user's resolution choice.
  // Mirrors the per-folder page state — see the comment there for
  // the full lifecycle (`pendingConflicts` → dialog → re-upload).
  const [pendingConflicts, setPendingConflicts] = useState<{
    folderId: string;
    conflicts: KnowledgeUploadNameConflict[];
    files: File[];
    visibility: KnowledgeFileVisibility;
    teamIds: string[];
    projectIds: string[];
  } | null>(null);

  // Pull the user's team list once; only meaningful for company
  // profiles, but we render it lazily anyway (the picker only appears
  // when 'teams' is the chosen visibility).
  const { data: userTeams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });
  // Same lazy pattern for projects — only the 'project' visibility
  // branch reads this. fetchProjects('all') returns every project
  // the caller can access (personal + team).
  const { data: userProjects = [] } = useQuery({
    queryKey: ["projects", "kc-upload"],
    queryFn: () => fetchProjects("all"),
  });

  const confirmUpload = async () => {
    if (stagedFiles.length === 0) return;
    // Block submit when the chosen visibility requires a non-empty
    // selection but the picker is empty — the BE rejects this too,
    // but a client guard keeps the dialog from collapsing on a 400
    // with stale staged files.
    if (stagedVisibility === "teams" && stagedTeamIds.length === 0) {
      toast.error(t("knowledgeMain.toastNeedTeams"));
      return;
    }
    if (stagedVisibility === "project" && stagedProjectIds.length === 0) {
      toast.error(t("knowledgeMain.toastNeedProjects"));
      return;
    }
    setUploading(true);
    try {
      const folderId = await getUploadsFolderId();
      const result = await runUpload(folderId, stagedFiles, undefined);
      if (result.nameConflicts.length > 0) {
        // Hold the conflict context so the resolution dialog can
        // re-upload the right files in the right folder with the
        // chosen actions. Don't clear the staged-files dialog yet
        // either — actually do clear it so the user can stage a
        // separate batch in parallel; the held `files` reference
        // is enough to drive the resolution call.
        setPendingConflicts({
          folderId,
          conflicts: result.nameConflicts,
          files: stagedFiles,
          visibility: stagedVisibility,
          teamIds: stagedTeamIds,
          projectIds: stagedProjectIds,
        });
      }
      setStagedFiles([]);
      setStagedVisibility("all");
      setStagedTeamIds([]);
      setStagedProjectIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("knowledgeMain.toastUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  /**
   * Shared upload runner used by the initial submit AND the
   * resolution-dialog re-submit. Calls the API, fires the
   * regular success/duplicates toasts, and returns the BE
   * response so the caller can drive name-conflict UX off the
   * `nameConflicts[]` field. The toast for "files skipped after
   * resolution" lives at the call site so it can suppress it on
   * the initial pass (where conflicts are not yet "skipped" —
   * they're "to be resolved").
   */
  const runUpload = async (
    folderId: string,
    files: File[],
    actions: Record<string, NameConflictAction> | undefined,
  ) => {
    const result = await uploadKnowledgeFiles(
      folderId,
      files,
      stagedVisibility,
      stagedTeamIds,
      stagedProjectIds,
      actions,
    );
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["knowledge-folders"] }),
      queryClient.refetchQueries({ queryKey: ["knowledge-recent"] }),
      queryClient.refetchQueries({
        queryKey: ["knowledge-folder", folderId],
      }),
    ]);
    if (result.uploaded.length > 0) {
      toast.success(
        t("knowledgeMain.toastUploaded").replace("{n}", String(result.uploaded.length)),
      );
    }
    if (result.duplicates.length > 0) {
      // Surface BOTH names when an existing copy was uploaded under a
      // different filename. Without the existing.name the user sees
      // "X is already in KC" but X isn't in the list — confusing.
      const titleForOne = (d: (typeof result.duplicates)[number]) =>
        d.existing.name && d.existing.name !== d.name
          ? t("knowledgeMain.toastDupMatchesOne")
              .replace("{name}", d.name)
              .replace("{existing}", d.existing.name)
          : t("knowledgeMain.toastDupExistsOne").replace("{name}", d.name);
      toast.info(
        result.duplicates.length === 1
          ? titleForOne(result.duplicates[0])
          : t("knowledgeMain.toastDupExistsMany").replace("{n}", String(result.duplicates.length)),
        {
          description: result.duplicates
            .map((d) =>
              d.existing.name && d.existing.name !== d.name
                ? `"${d.name}" matches "${d.existing.name}" → "${d.existing.folderName}"`
                : `"${d.name}" → "${d.existing.folderName}"`,
            )
            .join("\n"),
        },
      );
    }
    return result;
  };

  const resolveNameConflicts = async (
    actions: Record<string, NameConflictAction>,
  ) => {
    if (!pendingConflicts) return;
    const conflictNames = new Set(
      pendingConflicts.conflicts.map((c) => c.name),
    );
    const filesToResend = pendingConflicts.files.filter(
      (f) => conflictNames.has(f.name) && actions[f.name] !== "skip",
    );
    const skippedCount = pendingConflicts.conflicts.filter(
      (c) => (actions[c.name] ?? "skip") === "skip",
    ).length;
    const ctx = pendingConflicts;
    setPendingConflicts(null);
    if (filesToResend.length === 0) {
      if (skippedCount > 0) toast.info(t("knowledgeMain.toastSkipped").replace("{n}", String(skippedCount)));
      return;
    }
    setUploading(true);
    try {
      const result = await uploadKnowledgeFiles(
        ctx.folderId,
        filesToResend,
        ctx.visibility,
        ctx.teamIds,
        ctx.projectIds,
        actions,
      );
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["knowledge-folders"] }),
        queryClient.refetchQueries({ queryKey: ["knowledge-recent"] }),
        queryClient.refetchQueries({
          queryKey: ["knowledge-folder", ctx.folderId],
        }),
      ]);
      if (result.uploaded.length > 0) {
        toast.success(
          t("knowledgeMain.toastUploaded").replace("{n}", String(result.uploaded.length)),
        );
      }
      if (skippedCount > 0) {
        toast.info(t("knowledgeMain.toastSkipped").replace("{n}", String(skippedCount)));
      }
      // If the BE still reports conflicts here, the user kept some
      // as 'skip' — silent on this branch because the toast above
      // already covers the skip count.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("knowledgeMain.toastUploadFailed"),
      );
    } finally {
      setUploading(false);
    }
  };

  const removeStagedFile = (idx: number) =>
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) setStagedFiles(files);
  };

  const handleBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) setStagedFiles(files);
    e.target.value = "";
  };

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [query, folders]);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentFiles;
    return recentFiles.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.folderName.toLowerCase().includes(q) ||
        (f.uploadedByName ?? "").toLowerCase().includes(q),
    );
  }, [query, recentFiles]);

  // Client-side pagination over the filtered recent-files list.
  // 10 rows/page matches the Figma comp; resets to 1 on any filter
  // change so the user always lands on a populated first page.
  const FILES_PAGE_SIZE = 10;
  const [filesPage, setFilesPage] = useState(1);
  useEffect(() => {
    setFilesPage(1);
  }, [query]);
  const filesTotalPages = Math.max(
    1,
    Math.ceil(filteredFiles.length / FILES_PAGE_SIZE),
  );
  const pagedFiles = useMemo(
    () =>
      filteredFiles.slice(
        (filesPage - 1) * FILES_PAGE_SIZE,
        filesPage * FILES_PAGE_SIZE,
      ),
    [filteredFiles, filesPage],
  );
  useEffect(() => {
    if (filesPage > filesTotalPages) setFilesPage(filesTotalPages);
  }, [filesPage, filesTotalPages]);

  if (foldersLoading || filesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Mobile search (appbar search is hidden on small screens) */}
      <div className="relative sm:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("knowledgeCore.search")}
          className="h-10 pl-9 placeholder:text-text-3"
        />
      </div>

      {/* Upload dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-border-2 bg-bg-white px-12 py-12"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-6">
          <Upload className="h-6 w-6 text-white" />
        </span>
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[16px] font-medium text-text-1">
            {t("knowledgeCore.dragDrop")}
          </p>
          <p className="text-[13px] text-text-3">
            {t("knowledgeCore.supports")}
          </p>
        </div>
        <label>
          <input
            type="file"
            multiple
            accept=".pdf,.docx,.xls,.xlsx"
            className="hidden"
            onChange={handleBrowse}
          />
          <span className="inline-flex cursor-pointer items-center rounded border border-border-2 px-4 py-2 text-[13px] font-medium text-text-1 transition-colors hover:bg-bg-1">
            {t("knowledgeCore.browseFiles")}
          </span>
        </label>
      </div>

      {/* Google Drive — connect, import, and Re-sync imported sources. */}
      <DriveSection />

      {/* SharePoint — same shape as Drive but for Microsoft Graph. */}
      <SharePointSection />

      {/* OneDrive — shares the SharePoint Microsoft connection. */}
      <OneDriveSection />

      {/* Confluence — same shape as Drive but for Atlassian Confluence. */}
      <ConfluenceSection />

      {/* Folders */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-bold text-text-1">{t("knowledgeCore.folders")}</h2>
          <Button
            onClick={() => setNewFolderOpen(true)}
            variant="outline"
            className="cursor-pointer gap-2 text-[13px] dark:border-primary-6 dark:bg-primary-6 dark:text-primary-foreground dark:hover:bg-primary-7 dark:hover:border-primary-7"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("knowledgeCore.newFolder")}
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Virtual "All Files" card — pinned first, not a real
              folder. Clicking it opens the flat view of every file the
              user owns (across all folders), so a file appears here AND
              in its real folder without being stored twice. Hidden
              while searching folders, since it isn't a folder match.
              Recursive folder totals already sum to the global totals. */}
          {!query && (
            <Link
              href={`/knowledge-core/${ALL_FILES_FOLDER_ID}`}
              className="flex flex-col gap-3 rounded border border-primary-2 bg-primary-1/40 p-6 transition-colors hover:bg-primary-1"
            >
              <div className="flex items-start justify-between">
                <Files className="h-8 w-8 text-primary-6" strokeWidth={1.5} />
              </div>
              <h3 className="text-[16px] font-medium text-text-1">
                {t("knowledgeCore.allFilesName")}
              </h3>
              <div className="flex flex-col gap-1 text-[13px] text-text-3">
                <span>
                  {folders.reduce((s, f) => s + f.fileCount, 0)} files •{" "}
                  {formatBytes(folders.reduce((s, f) => s + f.totalBytes, 0))}
                </span>
                <span>{t("knowledgeCore.allFilesHint")}</span>
              </div>
            </Link>
          )}
          {filteredFolders.map((folder) => (
            <Link
              key={folder.id}
              href={`/knowledge-core/${folder.id}`}
              className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-6 transition-colors hover:bg-primary-1"
            >
              <div className="flex items-start justify-between">
                <Folder
                  className="h-8 w-8 text-primary-6"
                  strokeWidth={1.5}
                />
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
                        onSelect={() => handleDeleteFolder(folder.id)}
                        className="text-danger-6 focus:text-danger-6"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <h3 className="text-[16px] font-medium text-text-1">
                {folder.name}
              </h3>
              <div className="flex flex-col gap-1 text-[13px] text-text-3">
                <span>
                  {folder.fileCount} files • {formatBytes(folder.totalBytes)}
                </span>
                <span>Modified {formatDate(folder.updatedAt)}</span>
              </div>
            </Link>
          ))}
          {filteredFolders.length === 0 && !foldersLoading && (
            <p className="col-span-full py-8 text-center text-[13px] text-text-3">
              {query ? t("knowledgeCore.noFoldersMatch") : t("knowledgeCore.noFolders")}
            </p>
          )}
        </div>
      </section>

      {/* Recent Files */}
      <section className="flex flex-col gap-6">
        <h2 className="text-[18px] font-bold text-text-1">{t("knowledgeCore.recentFiles")}</h2>
        <div className="flex flex-col gap-3">
          {pagedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-4 rounded border border-border-2 bg-bg-white px-4 py-3 transition-colors hover:bg-primary-1"
            >
              <FileText
                className="h-8 w-8 shrink-0 text-text-3"
                strokeWidth={1.5}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-medium text-text-1">
                    {file.name}
                  </span>
                  <IngestionStatusBadge
                    status={file.ingestionStatus}
                    error={file.ingestionError}
                  />
                  <VisibilityBadge
                    visibility={file.visibility}
                    teams={file.teams}
                    projects={file.projects}
                  />
                </div>
                <span className="truncate text-[13px] text-text-3">
                  {file.folderName} • {formatBytes(file.sizeBytes)} •
                  Uploaded by {file.uploadedByName ?? "Unknown"}
                </span>
              </div>
              <span className="hidden shrink-0 text-[13px] text-text-3 sm:block">
                {formatDateTime(file.createdAt)}
              </span>
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
                  <DropdownMenuItem asChild>
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/knowledge-core/files/${file.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      {t("knowledgeCore.download")}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setMoveFileId(file.id);
                      setMoveTargetId("");
                    }}
                  >
                    <FolderInput className="mr-2 h-3.5 w-3.5" />
                    {t("knowledgeCore.moveTo")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => reingestMutation.mutate(file.id)}
                    disabled={
                      file.ingestionStatus === "processing" ||
                      reingestMutation.isPending
                    }
                  >
                    <RotateCw className="mr-2 h-3.5 w-3.5" />
                    {t("knowledgeCore.includeContext")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => untrainMutation.mutate(file.id)}
                    disabled={
                      file.ingestionStatus === "processing" ||
                      file.ingestionStatus === "untrained" ||
                      untrainMutation.isPending
                    }
                  >
                    <Unplug className="mr-2 h-3.5 w-3.5" />
                    {t("knowledgeCore.excludeContext")}
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem
                      onSelect={() =>
                        visibilityMutation.mutate({
                          fileId: file.id,
                          visibility:
                            file.visibility === "admins" ? "all" : "admins",
                        })
                      }
                    >
                      {file.visibility === "admins" ? (
                        <>
                          <Users className="mr-2 h-3.5 w-3.5" />
                          {t("knowledgeCore.makeVisibleAll")}
                        </>
                      ) : (
                        <>
                          <Shield className="mr-2 h-3.5 w-3.5" />
                          {t("knowledgeCore.makeAdminOnly")}
                        </>
                      )}
                    </DropdownMenuItem>
                  )}
                  {/* Open to file owners too — /knowledge-core lists
                      only the caller's own folders, so anyone seeing
                      this menu is the file's uploader (or admin).
                      BE rejects 'admins' for non-admin owners. */}
                  <DropdownMenuItem
                    onSelect={() => setEditingVisibilityFileId(file.id)}
                    disabled={file.ingestionStatus === "processing"}
                  >
                    <Settings2 className="mr-2 h-3.5 w-3.5" />
                    {t("knowledgeCore.changeVisibility")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => setDeleteFileId(file.id)}
                    className="text-danger-6 focus:text-danger-6"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {filteredFiles.length === 0 && !filesLoading && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {query ? t("knowledgeCore.search") : t("knowledgeCore.noFiles")}
            </p>
          )}
        </div>
        <Pagination
          page={filesPage}
          totalPages={filesTotalPages}
          onPageChange={setFilesPage}
        />
      </section>

      {/* New Folder Dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("knowledgeCore.newFolder")}</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("knowledgeCore.folderName")}
            className="h-10"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) {
                createMutation.mutate(newFolderName);
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewFolderOpen(false)}
              className="cursor-pointer"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate(newFolderName)}
              disabled={!newFolderName.trim() || createMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {createMutation.isPending ? t("knowledgeCore.creating") : t("knowledgeCore.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Dialog */}
      <Dialog
        open={deleteFolderId !== null}
        onOpenChange={(open) => !open && setDeleteFolderId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("knowledgeCore.deleteFolder")}</DialogTitle>
            <DialogDescription>
              {t("knowledgeCore.deleteFolderConfirm")}{" "}
              <strong>{deleteFolderName}</strong> and all its files? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFolderId(null)}
              className="cursor-pointer"
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteFolder}
              disabled={deleteMutation.isPending}
              className="cursor-pointer"
            >
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move File Dialog */}
      <Dialog
        open={moveFileId !== null}
        onOpenChange={(open) => !open && setMoveFileId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("knowledgeCore.moveFile")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-text-2">
            Move <strong>{moveFileName}</strong> to:
          </p>
          <Select value={moveTargetId} onValueChange={setMoveTargetId}>
            <SelectTrigger className="w-full cursor-pointer data-[size=default]:h-10">
              <SelectValue placeholder={t("knowledgeCore.selectFolder")} />
            </SelectTrigger>
            <SelectContent>
              {folders.map((f) => (
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
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => moveMutation.mutate()}
              disabled={!moveTargetId || moveMutation.isPending}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {moveMutation.isPending ? t("knowledgeCore.moving") : t("knowledgeCore.move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Confirmation Dialog */}
      <Dialog
        open={stagedFiles.length > 0}
        onOpenChange={(open) => !open && !uploading && setStagedFiles([])}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(stagedFiles.length === 1
                ? t("knowledgeMain.uploadTitleOne")
                : t("knowledgeMain.uploadTitleMany")
              ).replace("{n}", String(stagedFiles.length))}
            </DialogTitle>
            <DialogDescription>
              {stagedFiles.length === 1
                ? t("knowledgeMain.uploadDescOne")
                : t("knowledgeMain.uploadDescMany").replace("{n}", String(stagedFiles.length))}
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
                  disabled={uploading}
                  className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Visibility picker. All users see this now — 'all' and
              'teams' are open to everyone, 'admins' is admin-only.
              The team-checkbox panel appears below when 'teams' is
              the active choice; nothing else changes the layout. */}
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="text-[12px] font-medium text-text-1">
              {t("knowledgeCore.visibility")}
            </label>
            <Select
              value={stagedVisibility}
              onValueChange={(v) =>
                setStagedVisibility(v as KnowledgeFileVisibility)
              }
              disabled={uploading}
            >
              <SelectTrigger className="h-10 w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("onboarding.step6.visibilityAll")}</SelectItem>
                {isAdmin && (
                  <SelectItem value="admins">{t("onboarding.step6.visibilityAdmins")}</SelectItem>
                )}
                <SelectItem value="teams">{t("knowledgeCore.specificTeams")}</SelectItem>
                <SelectItem value="project">{t("knowledgeCore.specificProject")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-3">
              {stagedVisibility === "admins"
                ? "Only admins will see these files in chat / arena. You can change this later from the file's action menu."
                : stagedVisibility === "teams"
                  ? "Only members of the teams you pick below will see these files in chat / arena."
                  : stagedVisibility === "project"
                    ? "These files will only appear in the chat of the project(s) you pick below — never in the org-wide RAG."
                    : "Every user in the company can see these files in chat / arena."}
            </p>
          </div>

          {/* Team checkbox panel — shown only when visibility='teams'.
              Lists the user's teams (owned + accepted membership);
              the BE rejects assignments to teams the user isn't in
              for non-admins, so listing them here would just route
              users to a 403. Empty state has its own copy. */}
          {stagedVisibility === "teams" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                {t("knowledgeCore.teamsWithAccess")}
              </label>
              {userTeams.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  You aren&rsquo;t a member of any team yet — create or
                  join a team first to use this visibility option.
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-3 p-2">
                  {userTeams.map((tm) => {
                    const checked = stagedTeamIds.includes(tm.id);
                    return (
                      <label
                        key={tm.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={uploading}
                          onChange={() => {
                            setStagedTeamIds((prev) =>
                              checked
                                ? prev.filter((id) => id !== tm.id)
                                : [...prev, tm.id],
                            );
                          }}
                          className="h-3.5 w-3.5 cursor-pointer accent-primary-6"
                        />
                        <span className="truncate">{tm.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Project checkbox panel — shown only when
              visibility='project'. Same shape as the teams panel.
              Lists every project the caller can access (their own
              + team projects). Empty state mirrors the teams case
              so the dialog stays consistent. */}
          {stagedVisibility === "project" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-text-1">
                {t("knowledgeCore.projectsWithAccess")}
              </label>
              {userProjects.length === 0 ? (
                <p className="text-[11px] text-text-3">
                  You don&rsquo;t have access to any projects yet — create
                  one first to use this visibility option.
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
                          disabled={uploading}
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
              disabled={uploading}
              className="cursor-pointer"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={confirmUpload}
              disabled={uploading || stagedFiles.length === 0}
              className="cursor-pointer bg-primary-6 hover:bg-primary-7"
            >
              {uploading ? t("knowledgeCore.uploading") : t("knowledgeCore.upload")}
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
            <DialogTitle>{t("knowledgeCore.deleteFile")}</DialogTitle>
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
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteFileId) {
                  deleteFileMutation.mutate(deleteFileId);
                  setDeleteFileId(null);
                }
              }}
              disabled={deleteFileMutation.isPending}
              className="cursor-pointer"
            >
              {deleteFileMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full visibility editor — covers all four tiers including
          teams / project, beyond what the inline admin toggle does. */}
      <ChangeFileVisibilityDialog
        file={editingVisibilityFile}
        open={editingVisibilityFile !== null}
        onOpenChange={(open) => {
          if (!open) setEditingVisibilityFileId(null);
        }}
        isAdmin={isAdmin}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
          queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
          queryClient.invalidateQueries({ queryKey: ["knowledge-folder"] });
        }}
      />

      {/* Soft warning when uploads collide on name (different
          bytes) with existing files in this folder. */}
      <KnowledgeNameConflictDialog
        open={pendingConflicts !== null}
        conflicts={pendingConflicts?.conflicts ?? []}
        onResolve={resolveNameConflicts}
        onCancel={() => setPendingConflicts(null)}
      />
    </div>
  );
}
