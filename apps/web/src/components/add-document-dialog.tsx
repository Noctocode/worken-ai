"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createDocument,
  fetchDocumentGroups,
  deleteDocumentGroup,
  fetchKnowledgeFolders,
  fetchKnowledgeFolder,
  fetchProjectKnowledgeFiles,
  fetchProjectKnowledgeUploadDefaults,
  attachKnowledgeFiles,
  detachKnowledgeFile,
  uploadProjectKnowledgeFiles,
  type DocumentGroup,
  type ProjectKnowledgeFile,
  type KnowledgeUploadNameConflict,
  type NameConflictAction,
} from "@/lib/api";
import { KnowledgeNameConflictDialog } from "@/components/knowledge-name-conflict-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText,
  Trash2,
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Unplug,
  X,
  ClipboardPaste,
  FolderOpen,
  Inbox,
} from "lucide-react";

interface AddDocumentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ── Small visual helpers (kept local — not reused elsewhere) ──── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  const tone =
    visibility === "admins"
      ? "bg-warning-1 text-warning-7"
      : visibility === "teams" || visibility === "project"
        ? "bg-primary-1 text-primary-7"
        : "bg-bg-1 text-text-3";
  const label =
    visibility === "admins"
      ? "Admins"
      : visibility === "teams"
        ? "Teams"
        : visibility === "project"
          ? "Project"
          : "Everyone";
  return (
    <Badge className={`shrink-0 text-[10px] uppercase tracking-wide ${tone}`}>
      {label}
    </Badge>
  );
}

function IngestionBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <span
        title="Included in this project's context"
        className="inline-flex items-center gap-1 text-[11px] text-success-7"
      >
        <CheckCircle2 className="h-3 w-3" /> In context
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        title="Couldn't be added to context"
        className="inline-flex items-center gap-1 text-[11px] text-warning-7"
      >
        <AlertTriangle className="h-3 w-3" /> Skipped
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        title="Excluded from context — chat ignores this file until the owner includes it again from Knowledge Core."
        className="inline-flex items-center gap-1 text-[11px] text-text-3"
      >
        <Unplug className="h-3 w-3" /> Excluded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" /> Adding…
    </span>
  );
}

/* ── Dialog ───────────────────────────────────────────────────────── */

export function AddDocumentDialog({
  projectId,
  open,
  onOpenChange,
}: AddDocumentDialogProps) {
  const queryClient = useQueryClient();

  /* Paste-text state (legacy `documents` table) */
  const [content, setContent] = useState("");

  /* Upload tab state — Manage Context uploads are project-scoped by
     design (visibility='project' pinned to this project). No
     visibility / teams selector here; that lives on /knowledge-core
     for files meant to be reused across projects. */
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadFolderId, setUploadFolderId] = useState<string>("");
  const [uploadDefaultsApplied, setUploadDefaultsApplied] = useState(false);
  // Track drag-over state so the dropzone can highlight while the
  // user is hovering with files. Reset on dragleave / drop.
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Attach tab state */
  const [attachSelectedIds, setAttachSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [attachFolderId, setAttachFolderId] = useState<string>("");
  const [attachQuery, setAttachQuery] = useState("");

  /* Delete-confirm shared by both lists */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* Held between an upload that hit same-name-different-content
     collisions and the user's resolution choice. Powers the
     KnowledgeNameConflictDialog below. Identical shape to the
     two KC pages — see those for the lifecycle comment. */
  const [pendingConflicts, setPendingConflicts] = useState<{
    folderId: string;
    conflicts: KnowledgeUploadNameConflict[];
    files: File[];
  } | null>(null);

  /* ── Queries ──────────────────────────────────────────────────── */

  // Legacy paste-text snippets (existing /documents data, plus
  // anything still using the old upload path).
  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["documentGroups", projectId],
    queryFn: () => fetchDocumentGroups(projectId),
    enabled: open,
  });

  // KC files attached to this project. Poll while any attached
  // file is mid-ingestion so the "Adding…" badge flips to
  // "In context" (or "Skipped") on its own — the user shouldn't
  // have to close + reopen the dialog to see the worker finish.
  const { data: attachedFiles = [], isLoading: attachedLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      const inFlight = rows.some(
        (f) =>
          f.ingestionStatus === "pending" ||
          f.ingestionStatus === "processing",
      );
      return inFlight ? 2000 : false;
    },
  });

  // Smart defaults the BE picks for the upload picker — folder +
  // visibility + team set are all initialised from this so the
  // user sees a reasonable preset on first open.
  const { data: uploadDefaults } = useQuery({
    queryKey: ["project-upload-defaults", projectId],
    queryFn: () => fetchProjectKnowledgeUploadDefaults(projectId),
    enabled: open,
  });

  // KC folders for the upload-folder picker AND the attach-tab
  // folder filter.
  const { data: kcFolders = [] } = useQuery({
    queryKey: ["knowledge-folders"],
    queryFn: fetchKnowledgeFolders,
    enabled: open,
  });

  // Files inside the selected folder on the Attach tab — fetched
  // lazily so we don't pull every KC file in the workspace.
  const { data: attachFolderDetail } = useQuery({
    queryKey: ["knowledge-folder", attachFolderId],
    queryFn: () => fetchKnowledgeFolder(attachFolderId),
    enabled: open && !!attachFolderId,
  });

  /* ── Effects ──────────────────────────────────────────────────── */

  // Apply smart defaults once when they first arrive. Reset the
  // applied flag on dialog close so reopening pulls fresh state.
  useEffect(() => {
    if (!open) {
      setUploadDefaultsApplied(false);
      return;
    }
    if (uploadDefaults && !uploadDefaultsApplied) {
      setUploadFolderId(uploadDefaults.folderId);
      // Also default the attach-folder filter to "Projects" so the
      // user sees something useful when they switch tabs.
      setAttachFolderId(uploadDefaults.folderId);
      setUploadDefaultsApplied(true);
    }
  }, [open, uploadDefaults, uploadDefaultsApplied]);

  /* ── Mutations ────────────────────────────────────────────────── */

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ["documentGroups", projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ["project-knowledge-files", projectId],
    });
    queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
  };

  const addMutation = useMutation({
    mutationFn: (text: string) => createDocument(projectId, text),
    onSuccess: () => {
      invalidate();
      setContent("");
      toast.success("Text added to project context.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to add text."),
  });

  // Combined "Add Files" pipeline: upload pending files first
  // (visibility='project' pinned to this project), then attach the
  // checked KC files. Either side can be empty; if both are, the
  // mutation never fires (the CTA guards on total === 0). One
  // mutation owns both calls so we can show a single combined
  // toast and refresh queries once.
  const addFilesMutation = useMutation({
    mutationFn: async () => {
      const attachIds = Array.from(attachSelectedIds);
      const uploadResult =
        selectedFiles.length > 0
          ? await uploadProjectKnowledgeFiles(projectId, selectedFiles, {
              folderId: uploadFolderId || undefined,
              visibility: "project",
              projectIds: [projectId],
            })
          : null;
      if (attachIds.length > 0) {
        await attachKnowledgeFiles(projectId, attachIds);
      }
      // Pass the *original* File[] through so the resolution dialog
      // can re-upload the conflicting ones without re-prompting the
      // user via the OS file picker.
      return {
        uploadResult,
        attachedCount: attachIds.length,
        sourceFiles: selectedFiles,
      };
    },
    onSuccess: ({ uploadResult, attachedCount, sourceFiles }) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      if (uploadFolderId) {
        queryClient.invalidateQueries({
          queryKey: ["knowledge-folder", uploadFolderId],
        });
      }
      setSelectedFiles([]);
      setAttachSelectedIds(new Set());
      if (fileInputRef.current) fileInputRef.current.value = "";

      const uploadedCount = uploadResult?.uploaded.length ?? 0;
      const duplicates = uploadResult?.duplicates ?? [];
      const nameConflicts = uploadResult?.nameConflicts ?? [];
      const totalAdded = uploadedCount + attachedCount;
      if (totalAdded > 0) {
        toast.success(
          `Added ${totalAdded} file${totalAdded !== 1 ? "s" : ""} to project context.`,
        );
      }
      if (duplicates.length > 0) {
        toast.info(
          duplicates.length === 1
            ? `"${duplicates[0].name}" is already in your Knowledge Core.`
            : `${duplicates.length} file(s) already in your Knowledge Core.`,
          {
            description: duplicates
              .map((d) => `"${d.name}" → "${d.existing.folderName}"`)
              .join("\n"),
          },
        );
      }
      if (nameConflicts.length > 0 && uploadFolderId) {
        setPendingConflicts({
          folderId: uploadFolderId,
          conflicts: nameConflicts,
          files: sourceFiles,
        });
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to add files."),
  });

  /**
   * Re-upload the conflicting files with the user's per-name
   * decisions. Same pattern as the two KC pages: drop 'skip's
   * client-side and toast the skipped count, then post the rest
   * with `nameConflictActions` so the BE can apply overwrites /
   * "keep both" renames.
   */
  const resolveNameConflicts = async (
    actions: Record<string, NameConflictAction>,
  ) => {
    if (!pendingConflicts) return;
    const ctx = pendingConflicts;
    setPendingConflicts(null);
    const conflictNames = new Set(ctx.conflicts.map((c) => c.name));
    const filesToResend = ctx.files.filter(
      (f) => conflictNames.has(f.name) && actions[f.name] !== "skip",
    );
    const skippedCount = ctx.conflicts.filter(
      (c) => (actions[c.name] ?? "skip") === "skip",
    ).length;
    if (filesToResend.length === 0) {
      if (skippedCount > 0) toast.info(`Skipped ${skippedCount} file(s).`);
      return;
    }
    try {
      const result = await uploadProjectKnowledgeFiles(
        projectId,
        filesToResend,
        {
          folderId: ctx.folderId,
          visibility: "project",
          projectIds: [projectId],
          nameConflictActions: actions,
        },
      );
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      queryClient.invalidateQueries({
        queryKey: ["knowledge-folder", ctx.folderId],
      });
      const addedAfterResolve = result.uploaded.length;
      if (addedAfterResolve > 0) {
        toast.success(
          `Added ${addedAfterResolve} file${addedAfterResolve !== 1 ? "s" : ""} to project context.`,
        );
      }
      if (skippedCount > 0) {
        toast.info(`Skipped ${skippedCount} file(s).`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add files.",
      );
    }
  };

  const detachMutation = useMutation({
    mutationFn: (fileId: string) => detachKnowledgeFile(projectId, fileId),
    onSuccess: () => {
      invalidate();
      setConfirmDeleteId(null);
      toast.success("Detached from project.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to detach."),
  });

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => deleteDocumentGroup(projectId, groupId),
    onSuccess: () => {
      invalidate();
      setConfirmDeleteId(null);
      toast.success("Removed from project.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to remove."),
  });

  /* ── Handlers ─────────────────────────────────────────────────── */

  const handleAddText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    addMutation.mutate(content.trim());
  };

  const handleAddFiles = () => {
    const total = selectedFiles.length + attachSelectedIds.size;
    if (total === 0) return;
    addFilesMutation.mutate();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) setSelectedFiles((prev) => [...prev, ...dropped]);
  };

  const removeSelectedFile = (idx: number) =>
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));

  const filteredAttachCandidates = useMemo(() => {
    const all = attachFolderDetail?.files ?? [];
    const attachedSet = new Set(attachedFiles.map((f) => f.fileId));
    const q = attachQuery.trim().toLowerCase();
    return all
      .filter((f) => !attachedSet.has(f.id))
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true));
  }, [attachFolderDetail, attachedFiles, attachQuery]);

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border-2 px-5 py-4 sm:px-6">
          <DialogTitle className="text-base sm:text-lg">
            Manage Context
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Project context for chat. Uploaded files live in your
            Knowledge Core so visibility, indexing, and team sharing
            stay in one place.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[calc(90vh-72px)] flex-col overflow-y-auto px-5 py-4 sm:px-6">
          <Tabs defaultValue="paste" className="gap-4">
            <TabsList className="h-9 w-full bg-bg-1 p-1">
              <TabsTrigger
                value="paste"
                className="flex-1 cursor-pointer gap-1.5 text-xs sm:text-sm"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Paste Text</span>
                <span className="sm:hidden">Paste</span>
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="flex-1 cursor-pointer gap-1.5 text-xs sm:text-sm"
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Files</span>
                <span className="sm:hidden">Files</span>
              </TabsTrigger>
            </TabsList>

            {/* Paste-text tab — snippets stay project-scoped in the
                `documents` table, they're not a "file" that belongs
                in KC. */}
            <TabsContent value="paste" className="mt-0">
              <form onSubmit={handleAddText} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="document-content">Add new context</Label>
                  <Textarea
                    id="document-content"
                    placeholder="Paste your document text here…"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={6}
                    className="resize-y"
                    required
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    disabled={addMutation.isPending || !content.trim()}
                    className="cursor-pointer bg-primary-6 hover:bg-primary-7"
                  >
                    {addMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      "Add Context"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            {/* Add Files tab — unifies upload + attach in one flow.
                Top section uploads a fresh file to KC pinned to this
                project; bottom section picks an existing KC file.
                Both feed into a single CTA at the bottom so the user
                can mix sources in one go. */}
            <TabsContent value="files" className="mt-0">
              <div className="space-y-5">
                {/* ── Upload new ───────────────────────────────── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-text-1">Upload new</Label>
                    {selectedFiles.length > 0 && (
                      <span className="text-[11px] text-text-3">
                        {selectedFiles.length} ready
                      </span>
                    )}
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors ${
                      isDragOver
                        ? "border-primary-6 bg-primary-1/40"
                        : "border-border-3 hover:border-border-4 hover:bg-bg-1"
                    }`}
                  >
                    <Upload
                      className={`h-6 w-6 shrink-0 ${
                        isDragOver ? "text-primary-6" : "text-text-3"
                      }`}
                    />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-text-1">
                        {isDragOver
                          ? "Drop to add files"
                          : "Click to browse or drag files here"}
                      </p>
                      <p className="text-[11px] text-text-3">
                        PDF, DOCX, XLSX, PNG, JPG
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      if (picked.length > 0) {
                        setSelectedFiles((prev) => [...prev, ...picked]);
                      }
                      e.target.value = "";
                    }}
                  />
                  {selectedFiles.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {selectedFiles.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2.5 rounded-md border border-border-2 bg-bg-1 px-3 py-2"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-text-3" />
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
                            onClick={() => removeSelectedFile(i)}
                            disabled={addFilesMutation.isPending}
                            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 hover:bg-bg-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedFiles.length > 0 && (
                    <div className="grid gap-2 pt-1 sm:grid-cols-[auto_1fr] sm:items-center">
                      <Label className="text-[12px] font-normal text-text-3">
                        Save to folder
                      </Label>
                      <Select
                        value={uploadFolderId}
                        onValueChange={setUploadFolderId}
                      >
                        <SelectTrigger className="h-9 w-full cursor-pointer text-sm">
                          <SelectValue placeholder="Select a folder" />
                        </SelectTrigger>
                        <SelectContent>
                          {kcFolders.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* ── OR divider ───────────────────────────────── */}
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border-2" />
                  <span className="text-[11px] font-medium uppercase tracking-wider text-text-3">
                    or
                  </span>
                  <div className="h-px flex-1 bg-border-2" />
                </div>

                {/* ── Pick from Knowledge Core ─────────────────── */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-text-1">
                      Pick from Knowledge Core
                    </Label>
                    {attachSelectedIds.size > 0 && (
                      <span className="text-[11px] text-text-3">
                        {attachSelectedIds.size} selected
                      </span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={attachFolderId}
                      onValueChange={setAttachFolderId}
                    >
                      <SelectTrigger className="h-9 w-full cursor-pointer text-sm">
                        <SelectValue placeholder="Pick a folder" />
                      </SelectTrigger>
                      <SelectContent>
                        {kcFolders.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <input
                      id="attach-search"
                      type="text"
                      placeholder="Filter files…"
                      value={attachQuery}
                      onChange={(e) => setAttachQuery(e.target.value)}
                      className="h-9 w-full rounded-md border border-border-3 bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
                    />
                  </div>

                  <div className="overflow-hidden rounded-md border border-border-2">
                    <ScrollArea className="h-40">
                      {!attachFolderId ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                          <FolderOpen className="h-6 w-6 text-text-3" />
                          <p className="text-sm text-text-3">
                            Pick a folder to see its files.
                          </p>
                        </div>
                      ) : filteredAttachCandidates.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                          <Inbox className="h-6 w-6 text-text-3" />
                          <p className="text-sm text-text-3">
                            No files available to attach.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-border-2">
                          {filteredAttachCandidates.map((f) => {
                            const checked = attachSelectedIds.has(f.id);
                            return (
                              <label
                                key={f.id}
                                className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-bg-1"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setAttachSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(f.id)) next.delete(f.id);
                                      else next.add(f.id);
                                      return next;
                                    });
                                  }}
                                  className="h-3.5 w-3.5 shrink-0 accent-primary-6"
                                />
                                <FileText className="h-3.5 w-3.5 shrink-0 text-text-3" />
                                <span className="flex-1 truncate text-text-1">
                                  {f.name}
                                </span>
                                <VisibilityBadge visibility={f.visibility} />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>

                <p className="text-[11px] text-text-3">
                  Uploads land in Knowledge Core scoped to this project.
                  Picking an existing file just attaches it — its
                  original visibility stays as-is.
                </p>

                <DialogFooter>
                  <Button
                    type="button"
                    disabled={
                      addFilesMutation.isPending ||
                      (selectedFiles.length === 0 &&
                        attachSelectedIds.size === 0)
                    }
                    onClick={handleAddFiles}
                    className="cursor-pointer bg-primary-6 hover:bg-primary-7"
                  >
                    {addFilesMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      (() => {
                        const total =
                          selectedFiles.length + attachSelectedIds.size;
                        return total > 0
                          ? `Add ${total} file${total !== 1 ? "s" : ""} to project`
                          : "Add to project";
                      })()
                    )}
                  </Button>
                </DialogFooter>
              </div>
            </TabsContent>
          </Tabs>

          <Separator className="my-4" />

          {/* Unified Documents list — paste-text snippets (legacy
              `documents` rows) + attached KC files. Origin badge
              distinguishes the two. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-text-1">
                In this project
              </Label>
              <span className="text-[11px] text-text-3">
                {attachedFiles.length + (groups?.length ?? 0)} item
                {attachedFiles.length + (groups?.length ?? 0) !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="overflow-hidden rounded-md border border-border-2">
              <ScrollArea className="h-48">
                {groupsLoading || attachedLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-4 w-4 animate-spin text-text-3" />
                  </div>
                ) : (groups?.length ?? 0) === 0 &&
                  attachedFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <Inbox className="h-6 w-6 text-text-3" />
                    <p className="text-sm text-text-3">
                      No context yet. Paste text, upload a file, or attach
                      one from Knowledge Core.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-2">
                    {/* Attached KC files first — they're the richer
                        surface and most users will reach for them. */}
                    {attachedFiles.map((f: ProjectKnowledgeFile) => (
                      <div
                        key={f.fileId}
                        className="flex items-center justify-between gap-2 px-3 py-2.5"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-text-3" />
                          <span className="min-w-0 flex-1 truncate text-sm text-text-1">
                            {f.name}
                          </span>
                          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px]"
                              title={`In folder "${f.folderName}"`}
                            >
                              <Link2 className="mr-1 h-2.5 w-2.5" /> KC
                            </Badge>
                            <VisibilityBadge visibility={f.visibility} />
                            <IngestionBadge status={f.ingestionStatus} />
                          </div>
                        </div>
                        {confirmDeleteId === f.fileId ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 cursor-pointer text-xs"
                              disabled={detachMutation.isPending}
                              onClick={() =>
                                detachMutation.mutate(f.fileId)
                              }
                              title="Removes from project — the file stays in Knowledge Core"
                            >
                              {detachMutation.isPending ? "…" : "Detach"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 cursor-pointer text-xs"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 cursor-pointer text-text-3 hover:text-danger-6"
                            onClick={() => setConfirmDeleteId(f.fileId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}

                    {/* Then paste-text snippets. */}
                    {(groups ?? []).map((group: DocumentGroup) => (
                      <div
                        key={group.groupId}
                        className="flex items-center justify-between gap-2 px-3 py-2.5"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <ClipboardPaste className="h-4 w-4 shrink-0 text-text-3" />
                          <span className="min-w-0 flex-1 truncate text-sm text-text-1">
                            {group.title}
                          </span>
                          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px]"
                            >
                              Text
                            </Badge>
                            <Badge
                              variant="secondary"
                              className="shrink-0 text-[10px]"
                            >
                              {group.chunkCount}{" "}
                              {group.chunkCount === 1 ? "chunk" : "chunks"}
                            </Badge>
                          </div>
                        </div>
                        {confirmDeleteId === group.groupId ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 cursor-pointer text-xs"
                              disabled={deleteMutation.isPending}
                              onClick={() =>
                                deleteMutation.mutate(group.groupId)
                              }
                            >
                              {deleteMutation.isPending ? "…" : "Confirm"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 cursor-pointer text-xs"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 cursor-pointer text-text-3 hover:text-danger-6"
                            onClick={() => setConfirmDeleteId(group.groupId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {/* Sibling dialog. Sits outside the main dialog so closing
        the parent doesn't unmount mid-resolution; both are
        portalled by Radix anyway. */}
    <KnowledgeNameConflictDialog
      open={pendingConflicts !== null}
      conflicts={pendingConflicts?.conflicts ?? []}
      onResolve={resolveNameConflicts}
      onCancel={() => setPendingConflicts(null)}
    />
    </>
  );
}
