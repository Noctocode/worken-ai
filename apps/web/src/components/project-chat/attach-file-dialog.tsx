"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Search, Trash2 } from "lucide-react";
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

const ACCEPTED_TYPES = ".pdf,.docx,.xls,.xlsx,.png,.jpg,.jpeg";

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
 */
export function AttachFileDialog({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: string;
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

  const { data: attached = [], isLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
  });

  const filtered = useMemo<ProjectKnowledgeFile[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attached;
    return attached.filter((f) =>
      `${f.name} ${f.folderName}`.toLowerCase().includes(q),
    );
  }, [attached, query]);

  const uploadMutation = useMutation({
    mutationFn: ({
      files,
      nameConflictActions,
    }: {
      files: File[];
      nameConflictActions?: Record<string, NameConflictAction>;
    }) =>
      uploadProjectKnowledgeFiles(projectId, files, {
        // Defer folder + visibility to the BE: it picks the caller's
        // "Projects" folder and a scope-aware visibility (team
        // project → 'teams' with the team pre-set; personal → 'all').
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
            ? `Uploaded 1 file.`
            : `Uploaded ${uploaded} files.`,
        );
      }
      if (dup > 0) {
        toast.info(
          dup === 1
            ? `1 file was already in your Knowledge Core — re-attached.`
            : `${dup} files were already in your Knowledge Core — re-attached.`,
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
        count === 1 ? "Detached 1 file." : `Detached ${count} files.`,
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <DialogTitle>Knowledge attached to this chat</DialogTitle>
                <DialogDescription>
                  These files feed the model as context on every message.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="plusAction"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="shrink-0"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 text-white" />
                )}
                Upload files
              </Button>
            </div>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              placeholder="Search attached files…"
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
                <FileText className="h-8 w-8 text-text-3" strokeWidth={1.5} />
                <p className="text-[13px] text-text-2">
                  {attached.length === 0
                    ? "No knowledge yet. Upload one with the Upload files button above."
                    : "No attached files match your search."}
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
                      <FileText className="h-4 w-4 shrink-0 text-text-3" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text-1">
                          {f.name}
                        </p>
                        <p className="truncate text-[11px] text-text-3">
                          {f.folderName}
                        </p>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
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
              variant="outline"
              disabled={selected.size === 0 || isDetaching}
              onClick={() => detachMutation.mutate([...selected])}
              className="border-danger-2 text-danger-6 hover:bg-danger-1 hover:text-danger-7"
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
