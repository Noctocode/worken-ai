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
} from "@/lib/api";
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
} from "lucide-react";

interface AddDocumentDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/* ── Small visual helpers (kept local — not reused elsewhere) ──── */

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
        title="Indexed for chat search"
        className="inline-flex items-center gap-1 text-[11px] text-success-7"
      >
        <CheckCircle2 className="h-3 w-3" /> Indexed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        title="Couldn't be indexed"
        className="inline-flex items-center gap-1 text-[11px] text-warning-7"
      >
        <AlertTriangle className="h-3 w-3" /> Skipped
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        title="Embeddings removed — chat RAG ignores this file until the owner re-trains it."
        className="inline-flex items-center gap-1 text-[11px] text-text-3"
      >
        <Unplug className="h-3 w-3" /> Untrained
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" /> Indexing…
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Attach tab state */
  const [attachSelectedIds, setAttachSelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [attachFolderId, setAttachFolderId] = useState<string>("");
  const [attachQuery, setAttachQuery] = useState("");

  /* Delete-confirm shared by both lists */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ── Queries ──────────────────────────────────────────────────── */

  // Legacy paste-text snippets (existing /documents data, plus
  // anything still using the old upload path).
  const { data: groups, isLoading: groupsLoading } = useQuery({
    queryKey: ["documentGroups", projectId],
    queryFn: () => fetchDocumentGroups(projectId),
    enabled: open,
  });

  // KC files attached to this project.
  const { data: attachedFiles = [], isLoading: attachedLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
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

  const uploadMutation = useMutation({
    mutationFn: () =>
      uploadProjectKnowledgeFiles(projectId, selectedFiles, {
        folderId: uploadFolderId || undefined,
        // Manage Context uploads are always pinned to this project —
        // searchable only inside its chat, never via the org-wide RAG.
        visibility: "project",
        projectIds: [projectId],
      }),
    onSuccess: (result) => {
      invalidate();
      // Also refresh KC views so the file shows up there too.
      queryClient.invalidateQueries({ queryKey: ["knowledge-folders"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-recent"] });
      if (uploadFolderId) {
        queryClient.invalidateQueries({
          queryKey: ["knowledge-folder", uploadFolderId],
        });
      }
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (result.uploaded.length > 0) {
        toast.success(
          `Uploaded ${result.uploaded.length} file(s) and attached to project.`,
        );
      }
      if (result.duplicates.length > 0) {
        toast.info(
          result.duplicates.length === 1
            ? `"${result.duplicates[0].name}" is already in your Knowledge Core.`
            : `${result.duplicates.length} file(s) already in your Knowledge Core.`,
          {
            description: result.duplicates
              .map((d) => `"${d.name}" → "${d.existing.folderName}"`)
              .join("\n"),
          },
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to upload."),
  });

  const attachMutation = useMutation({
    mutationFn: (fileIds: string[]) =>
      attachKnowledgeFiles(projectId, fileIds),
    onSuccess: () => {
      invalidate();
      setAttachSelectedIds(new Set());
      toast.success("Attached to project.");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to attach."),
  });

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

  const handleUpload = () => {
    if (selectedFiles.length === 0) return;
    uploadMutation.mutate();
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Context</DialogTitle>
          <DialogDescription>
            Project context for chat. Uploaded files live in your
            Knowledge Core so visibility, indexing, and team sharing
            are managed in one place.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="paste">
          <TabsList className="w-full">
            <TabsTrigger value="paste" className="flex-1">
              Paste Text
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">
              Upload File
            </TabsTrigger>
            <TabsTrigger value="attach" className="flex-1">
              From Knowledge Core
            </TabsTrigger>
          </TabsList>

          {/* Paste-text tab — unchanged: snippets stay project-
              scoped in the `documents` table, they're not a "file"
              that belongs in KC. */}
          <TabsContent value="paste">
            <form onSubmit={handleAddText} className="space-y-4 pt-2">
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
                >
                  {addMutation.isPending ? "Adding…" : "Add Context"}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* Upload tab — sends to KC + auto-attaches. */}
          <TabsContent value="upload">
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Files</Label>
                <div
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border-3 px-4 py-5 transition-colors hover:border-border-4 hover:bg-bg-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-5 w-5 shrink-0 text-text-3" />
                  <span className="text-sm text-text-3">
                    {selectedFiles.length === 0
                      ? "Click to select files (.pdf, .docx, .xlsx, .png, .jpg)"
                      : selectedFiles.length === 1
                        ? selectedFiles[0].name
                        : `${selectedFiles.length} files selected`}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.xls,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(e) =>
                    setSelectedFiles(Array.from(e.target.files ?? []))
                  }
                />
              </div>

              {/* Folder picker only — visibility is hardcoded to
                  'project' (this project) so the file shows up only
                  in this project's chat. Cross-project reuse lives on
                  the /knowledge-core upload flow. */}
              <div className="space-y-2">
                <Label>Folder in Knowledge Core</Label>
                <Select
                  value={uploadFolderId}
                  onValueChange={setUploadFolderId}
                >
                  <SelectTrigger className="h-10 cursor-pointer">
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
                {uploadDefaults &&
                  uploadFolderId === uploadDefaults.folderId && (
                    <p className="text-[11px] text-text-3">
                      Default — auto-created if missing.
                    </p>
                  )}
                <p className="text-[11px] text-text-3">
                  These files will only be searchable in this project&rsquo;s
                  chat. To share across projects, upload via{" "}
                  <span className="font-medium">Knowledge Core</span> instead.
                </p>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  disabled={
                    uploadMutation.isPending || selectedFiles.length === 0
                  }
                  onClick={handleUpload}
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    "Upload to Knowledge Core"
                  )}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>

          {/* Attach tab — pick existing KC files. */}
          <TabsContent value="attach">
            <div className="space-y-3 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Folder</Label>
                  <Select
                    value={attachFolderId}
                    onValueChange={setAttachFolderId}
                  >
                    <SelectTrigger className="h-10 cursor-pointer">
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
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attach-search">Search</Label>
                  <input
                    id="attach-search"
                    type="text"
                    placeholder="Filter files in this folder…"
                    value={attachQuery}
                    onChange={(e) => setAttachQuery(e.target.value)}
                    className="h-10 w-full rounded-md border border-border-3 bg-transparent px-3 text-[14px] outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
                  />
                </div>
              </div>

              <div className="rounded border border-border-2">
                <ScrollArea className="h-44">
                  {!attachFolderId ? (
                    <p className="py-6 text-center text-sm text-text-3">
                      Pick a folder to see its files.
                    </p>
                  ) : filteredAttachCandidates.length === 0 ? (
                    <p className="py-6 text-center text-sm text-text-3">
                      No files available to attach.
                    </p>
                  ) : (
                    <div className="divide-y divide-border-2">
                      {filteredAttachCandidates.map((f) => {
                        const checked = attachSelectedIds.has(f.id);
                        return (
                          <label
                            key={f.id}
                            className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-bg-1"
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
                              className="h-3.5 w-3.5 accent-primary-6"
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

              <DialogFooter>
                <Button
                  type="button"
                  disabled={
                    attachMutation.isPending || attachSelectedIds.size === 0
                  }
                  onClick={() =>
                    attachMutation.mutate(Array.from(attachSelectedIds))
                  }
                >
                  {attachMutation.isPending
                    ? "Attaching…"
                    : `Attach ${attachSelectedIds.size > 0 ? `(${attachSelectedIds.size})` : ""}`}
                </Button>
              </DialogFooter>
            </div>
          </TabsContent>
        </Tabs>

        <Separator />

        {/* Unified Documents list — paste-text snippets (legacy
            `documents` rows) + attached KC files. Origin badge
            distinguishes the two. */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">In this project</Label>
          <ScrollArea className="h-48">
            {groupsLoading || attachedLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-text-3" />
              </div>
            ) : (groups?.length ?? 0) === 0 && attachedFiles.length === 0 ? (
              <p className="py-4 text-center text-sm text-text-3">
                No context yet. Paste text, upload a file, or attach one
                from Knowledge Core.
              </p>
            ) : (
              <div className="space-y-1">
                {/* Attached KC files first — they're the richer
                    surface and most users will reach for them. */}
                {attachedFiles.map((f: ProjectKnowledgeFile) => (
                  <div
                    key={f.fileId}
                    className="flex items-center justify-between rounded-md border border-border-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-text-3" />
                      <span className="truncate text-sm text-text-1">
                        {f.name}
                      </span>
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
                    {confirmDeleteId === f.fileId ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={detachMutation.isPending}
                          onClick={() => detachMutation.mutate(f.fileId)}
                          title="Removes from project — the file stays in Knowledge Core"
                        >
                          {detachMutation.isPending ? "…" : "Detach"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-text-3 hover:text-danger-6"
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
                    className="flex items-center justify-between rounded-md border border-border-2 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-text-3" />
                      <span className="truncate text-sm text-text-1">
                        {group.title}
                      </span>
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px]"
                      >
                        Text
                      </Badge>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {group.chunkCount}{" "}
                        {group.chunkCount === 1 ? "chunk" : "chunks"}
                      </Badge>
                    </div>
                    {confirmDeleteId === group.groupId ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(group.groupId)}
                        >
                          {deleteMutation.isPending ? "…" : "Confirm"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-text-3 hover:text-danger-6"
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
      </DialogContent>
    </Dialog>
  );
}
