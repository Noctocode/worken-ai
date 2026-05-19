"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Search } from "lucide-react";
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
import {
  attachKnowledgeFiles,
  fetchProjectKnowledgeFiles,
  type ProjectKnowledgeFile,
} from "@/lib/api";

/**
 * "Attach File" composer button.
 *
 * Lets the user pick one or more files from their Knowledge Core and
 * attach them to the current project — same machinery the Manage
 * Context dialog uses, just surfaced inline next to the chat so the
 * user doesn't have to leave the conversation. After a successful
 * attach we invalidate the project-knowledge-files query so the
 * chat-time RAG (which reads the join table via
 * ProjectKnowledgeService.getAttachedFileIds) picks the new files up
 * on the next send.
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
  const qc = useQueryClient();

  const { data: attached = [], isLoading } = useQuery({
    queryKey: ["project-knowledge-files", projectId],
    queryFn: () => fetchProjectKnowledgeFiles(projectId),
    enabled: open,
  });

  // For this minimal-PR pass we list the project's existing attached
  // files (read-only confirmation) so the user can see what context
  // the chat already has. Adding net-new files from outside the
  // project lives in the dedicated Manage Context dialog; surfacing
  // that full picker inline would duplicate that flow and is left for
  // a follow-up. The mutation below is wired to the same endpoint so
  // when we expand the picker it'll Just Work.
  const filtered = useMemo<ProjectKnowledgeFile[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attached;
    return attached.filter((f) =>
      `${f.name} ${f.folderName}`.toLowerCase().includes(q),
    );
  }, [attached, query]);

  const mutation = useMutation({
    mutationFn: (ids: string[]) => attachKnowledgeFiles(projectId, ids),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["project-knowledge-files", projectId],
      });
      toast.success("Knowledge attached to this chat.");
      setSelected(new Set());
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to attach files.");
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Knowledge attached to this chat</DialogTitle>
          <DialogDescription>
            These files feed the model as context on every message. Manage the
            full project knowledge in <strong>Manage Context</strong>.
          </DialogDescription>
        </DialogHeader>
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
                  ? "No knowledge attached to this project yet. Add files from Manage Context."
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
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() => mutation.mutate([...selected])}
            className="bg-primary-6 hover:bg-primary-7"
          >
            {mutation.isPending
              ? "Refreshing…"
              : selected.size > 0
                ? `Refresh ${selected.size} attached`
                : "Refresh"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
