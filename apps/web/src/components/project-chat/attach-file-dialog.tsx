"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { KnowledgeNameConflictDialog } from "@/components/knowledge-name-conflict-dialog";
import {
  detachKnowledgeFile,
  fetchProjectKnowledgeFiles,
  uploadProjectKnowledgeFiles,
  type KnowledgeUploadNameConflict,
  type NameConflictAction,
  type ProjectKnowledgeFile,
} from "@/lib/api";

const ACCEPTED_FILE_TYPES = ".pdf,.docx,.xls,.xlsx,.png,.jpg,.jpeg";
const ACCEPTED_IMAGE_TYPES = ".png,.jpg,.jpeg";

/** Filename test for the `imagesOnly` variant — scopes the listed
 *  rows to images so "Upload Image" never surfaces a stray PDF. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/**
 * "Knowledge attached to this chat" dialog.
 *
 * Inline view of the project's RAG context with two actions:
 *  - Upload: drops new files into the user's "Projects" KC folder
 *    (BE smart-default — same as Manage Context). On a same-name-
 *    different-content collision the BE returns a `nameConflicts`
 *    payload; we hand it to KnowledgeNameConflictDialog and retry
 *    the upload with the user's per-file choice (overwrite / keep
 *    both / skip), matching the main Knowledge Core flow.
 *  - Detach: removes the project_knowledge_files join row for the
 *    checked files so RAG stops feeding them on the next message.
 *    The underlying KC files stay in the user's Knowledge Core —
 *    detaching is a project-scoped action.
 *
 * Both actions invalidate the project-knowledge-files query so the
 * list refreshes in place. The dialog stays open so the user can
 * see the result before closing.
 *
 * The `imagesOnly` variant powers the composer's "Upload Image" pill:
 * identical flow, but the upload picker and the listed rows are both
 * scoped to image formats.
 */
export function AttachFileDialog({
  children,
  projectId,
  imagesOnly = false,
}: {
  children: React.ReactNode;
  projectId: string;
  /** Scope the picker + list to image formats — used by the
   *  composer's "Upload Image" pill. */
  imagesOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<KnowledgeUploadNameConflict[]>([]);
  // Files held aside while the user resolves a same-name collision —
  // retried verbatim with the resolved `nameConflictActions` map.
  const [pendingRetryFiles, setPendingRetryFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const accept = imagesOnly ? ACCEPTED_IMAGE_TYPES : ACCEPTED_FILE_TYPES;
  const noun = imagesOnly ? "image" : "file";

  const { data: attached = [], isLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
    // While any row is still being ingested ("Queued" / "Adding"),
    // refetch every 2s so the badge transitions live. Once every
    // row has settled (done / failed / untrained) the predicate
    // returns false and react-query stops polling — no need to
    // close the dialog to get a fresh state.
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const anyInProgress = rows.some(
        (r) => r.ingestionStatus === "pending" || r.ingestionStatus === "processing",
      );
      return anyInProgress ? 2000 : false;
    },
  });

  // In `imagesOnly` mode the list mirrors the picker — only image
  // rows show, so "Upload Image" never surfaces a stray PDF.
  const scoped = useMemo<ProjectKnowledgeFile[]>(
    () =>
      imagesOnly ? attached.filter((f) => IMAGE_FILE.test(f.name)) : attached,
    [attached, imagesOnly],
  );

  const filtered = useMemo<ProjectKnowledgeFile[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((f) =>
      `${f.name} ${f.folderName}`.toLowerCase().includes(q),
    );
  }, [scoped, query]);

  const uploadMutation = useMutation({
    mutationFn: ({
      files,
      nameConflictActions,
    }: {
      files: File[];
      nameConflictActions?: Record<string, NameConflictAction>;
    }) =>
      uploadProjectKnowledgeFiles(projectId, files, {
        // Scope the upload to THIS project: visibility='project'
        // linked to projectId — not the wider 'all' / 'teams'
        // default. Matches the Manage Context dialog. Folder is
        // still deferred to the BE smart-default ("Projects").
        visibility: "project",
        projectIds: [projectId],
        nameConflictActions,
      }),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({
        queryKey: ["project-knowledge-files", projectId],
      });
      // BE flagged same-name-different-content conflicts — bounce to
      // the resolver dialog and stash the original files for retry.
      if (result.nameConflicts.length > 0) {
        setConflicts(result.nameConflicts);
        setPendingRetryFiles(vars.files);
        return;
      }
      const uploaded = result.uploaded.length;
      const dup = result.duplicates.length;
      if (uploaded > 0) {
        toast.success(
          uploaded === 1
            ? `Uploaded 1 ${noun}.`
            : `Uploaded ${uploaded} ${noun}s.`,
        );
      }
      if (dup > 0) {
        toast.info(
          dup === 1
            ? `1 ${noun} was already in your Knowledge Core — re-attached.`
            : `${dup} ${noun}s were already in your Knowledge Core — re-attached.`,
        );
      }
      setPendingRetryFiles([]);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to upload files.");
      setPendingRetryFiles([]);
    },
  });

  const detachMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Fan-out — no batched endpoint today; one DELETE per row.
      // Failures stop the loop so the user can retry on whatever
      // didn't make it through.
      for (const id of ids) {
        await detachKnowledgeFile(projectId, id);
      }
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({
        queryKey: ["project-knowledge-files", projectId],
      });
      toast.success(
        count === 1
          ? `Detached 1 ${noun}.`
          : `Detached ${count} ${noun}s.`,
      );
      setSelected(new Set());
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to detach files.");
      // Some may have succeeded before the throw — refresh either way.
      qc.invalidateQueries({
        queryKey: ["project-knowledge-files", projectId],
      });
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadMutation.mutate({ files: Array.from(files) });
    // Reset so picking the same filename twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConflictResolve = (
    actions: Record<string, NameConflictAction>,
  ) => {
    const filesToRetry = pendingRetryFiles;
    setConflicts([]);
    if (filesToRetry.length === 0) return;
    uploadMutation.mutate({
      files: filesToRetry,
      nameConflictActions: actions,
    });
  };

  const handleConflictCancel = () => {
    setConflicts([]);
    setPendingRetryFiles([]);
  };

  const isUploading = uploadMutation.isPending;
  const isDetaching = detachMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>
              {imagesOnly
                ? "Images attached to this chat"
                : "Knowledge attached to this chat"}
            </DialogTitle>
            <DialogDescription>
              {imagesOnly
                ? "These images feed the model as visual context on every message."
                : "These files feed the model as context on every message."}
            </DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              placeholder={`Search attached ${noun}s…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-[420px] overflow-y-auto pr-1">
            {isLoading && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-text-3" />
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                {imagesOnly ? (
                  <ImageIcon
                    className="h-8 w-8 text-text-3"
                    strokeWidth={1.5}
                  />
                ) : (
                  <FileText className="h-8 w-8 text-text-3" strokeWidth={1.5} />
                )}
                <p className="text-[13px] text-text-2">
                  {scoped.length === 0
                    ? imagesOnly
                      ? "No images yet. Upload one with the Upload images button below."
                      : "No knowledge yet. Upload one with the Upload files button below."
                    : `No attached ${noun}s match your search.`}
                </p>
              </div>
            )}
            <ul className="flex flex-col gap-1.5">
              {filtered.map((f) => {
                const checked = selected.has(f.fileId);
                return (
                  <li key={f.fileId}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border-2 bg-bg-white px-3 py-2.5 transition-colors hover:border-primary-5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(f.fileId)}
                        className="h-4 w-4 cursor-pointer accent-primary-6"
                      />
                      {IMAGE_FILE.test(f.name) ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-text-3" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-text-3" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text-1">
                          {f.name}
                        </p>
                        <p className="truncate text-[11px] text-text-3">
                          {f.folderName}
                        </p>
                      </div>
                      <IngestionStatusBadge
                        status={f.ingestionStatus}
                        error={f.ingestionError}
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isUploading || isDetaching}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={selected.size === 0 || isDetaching}
              onClick={() => detachMutation.mutate([...selected])}
            >
              {isDetaching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Detaching…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {selected.size > 0
                    ? `Detach ${selected.size}`
                    : "Detach selected"}
                </>
              )}
            </Button>
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="bg-primary-6 hover:bg-primary-7"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {imagesOnly ? "Upload images" : "Upload files"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <KnowledgeNameConflictDialog
        open={conflicts.length > 0}
        conflicts={conflicts}
        onResolve={handleConflictResolve}
        onCancel={handleConflictCancel}
      />
    </>
  );
}

/**
 * Ingestion-status pill. Mirrors the badge on /knowledge-core/[folder]
 * so the same vocabulary follows the file across surfaces:
 *
 *   pending / processing → spinner, "Queued" / "Adding"
 *   done                 → check, "In context"
 *   untrained            → unplug, "Excluded"
 *   failed               → warning, "Skipped" + tooltip with the
 *                          underlying ingestion error so the user
 *                          knows WHY (OCR provider down, scan with
 *                          no text, password-protected PDF, …)
 *
 * Inline-duplicated rather than imported from the KC folder page —
 * those pages don't share a components module for this domain yet
 * and that page does the same thing. If a third caller needs it,
 * extract to apps/web/src/components/knowledge/.
 */
function IngestionStatusBadge({
  status,
  error,
}: {
  status: "pending" | "processing" | "done" | "failed" | "untrained";
  error?: string | null;
}) {
  if (status === "done") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-7">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        In context
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title={error ?? "Could not extract searchable text from this file."}
      >
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        Skipped
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
        title="Excluded from context — open Knowledge Core to include this file again."
      >
        <Unplug className="h-3 w-3" strokeWidth={2} />
        Excluded
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      {status === "processing" ? "Adding" : "Queued"}
    </span>
  );
}
