"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
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
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { useLanguage } from "@/lib/i18n";

/** Accept attribute for the picker. Restricted to the formats the
 *  chat ingestion pipeline can actually parse: .docx (mammoth), .xls
 *  / .xlsx (SheetJS), .pdf (pdf-parse). Legacy .doc is intentionally
 *  NOT here — the parser is .docx-only, so accepting .doc would just
 *  lead to a "Skipped" badge after upload. */
const ACCEPTED_FILE_TYPES = ".pdf,.docx,.xls,.xlsx";

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
  const { t } = useLanguage();
  // Company profiles attach with 'project' visibility (the file is
  // project-scoped within the org). Personal profiles have no company
  // visibility tiers — their files are owner-only by scope — so we
  // omit visibility and just link the file to the project, which the
  // RAG layer surfaces as owner-only (see searchProjectAttachedChunks).
  // Uses the shared profile helper (single source of truth from main).
  const isCompany = !useIsPersonal();
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
        // Attach to THIS project. Company profiles tag the file with
        // 'project' visibility; personal profiles omit visibility
        // (owner-only by scope) and rely on the project link alone.
        // Folder is deferred to the BE smart-default ("Projects").
        ...(isCompany ? { visibility: "project" as const } : {}),
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
            ? t("attach.uploaded1")
            : `${t("attach.uploadedN1")} ${uploaded} ${t("attach.uploadedN2")}`,
        );
      }
      if (dup > 0) {
        toast.info(
          dup === 1
            ? t("attach.reattach1")
            : `${dup} ${t("attach.reattachN1")}`,
        );
      }
      setPendingRetryFiles([]);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("attach.failedUpload"));
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
          ? t("attach.detached1")
          : `${t("attach.detachedN1")} ${count} ${t("attach.detachedN2")}`,
      );
      setSelected(new Set());
    },
    onError: (err: Error) => {
      toast.error(err.message || t("attach.failedDetach"));
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
            <DialogTitle>{t("attach.title")}</DialogTitle>
            <DialogDescription>
              {t("attach.desc")}
            </DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILE_TYPES}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              placeholder={t("attach.search")}
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
                    ? t("attach.noKnowledge")
                    : t("attach.noMatch")}
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
              {t("attach.close")}
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
                  {t("attach.detaching")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  {selected.size > 0
                    ? `${t("attach.detach")} ${selected.size}`
                    : t("attach.detachSelected")}
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
                  {t("attach.uploading")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {t("attach.uploadFiles")}
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
 *                          knows WHY (unsupported variant, empty
 *                          workbook, password-protected PDF, …)
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
  const { t } = useLanguage();
  if (status === "done") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-7">
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
        {t("attach.inContext")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-7"
        title={error ?? t("attach.skippedTitle")}
      >
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        {t("attach.skipped")}
      </span>
    );
  }
  if (status === "untrained") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3"
        title={t("attach.excludedTitle")}
      >
        <Unplug className="h-3 w-3" strokeWidth={2} />
        {t("attach.excluded")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
      {status === "processing" ? t("attach.adding") : t("attach.queued")}
    </span>
  );
}
