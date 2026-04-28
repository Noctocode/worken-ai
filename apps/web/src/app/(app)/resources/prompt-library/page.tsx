"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  ArrowLeft,
  MoreVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  deletePrompt,
  fetchPrompts,
  type PromptSummary,
} from "@/lib/api";

export default function PromptLibraryPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PromptSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPrompts()
      .then((rows) => {
        if (cancelled) return;
        setPrompts(rows);
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Couldn't load prompts.";
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of prompts) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  }, [prompts]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return prompts.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [prompts, query, category]);

  const handleCopy = async (prompt: PromptSummary) => {
    try {
      await navigator.clipboard.writeText(prompt.body);
      toast.success(`Copied "${prompt.title}" to clipboard.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  const handleEdit = (prompt: PromptSummary) => {
    router.push(`/resources/prompt-builder?id=${prompt.id}`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const previous = prompts;
    setPrompts((prev) => prev.filter((p) => p.id !== target.id));
    setDeleteTarget(null);
    try {
      await deletePrompt(target.id);
      toast.success(`Deleted "${target.title}".`);
    } catch (err) {
      setPrompts(previous);
      const message =
        err instanceof Error ? err.message : "Couldn't delete prompt.";
      toast.error(message);
    }
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <Link
        href="/resources"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Resources
      </Link>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-11 pl-9 pr-3 text-base rounded-md border-border-2 placeholder:text-text-3"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-11 w-full sm:w-[198px] rounded-md border-border-2 text-base">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          href="/resources/prompt-builder"
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
        >
          <Plus className="h-4 w-4" />
          New Prompt
        </Link>
      </div>

      {/* Empty / loading states */}
      {loading ? (
        <div className="rounded-lg border border-border-2 bg-bg-white p-10 text-center text-sm text-text-3">
          Loading prompts…
        </div>
      ) : prompts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-10 text-center">
          <Sparkles className="h-8 w-8 text-text-3" strokeWidth={1.5} />
          <h3 className="text-[16px] font-semibold text-text-1">
            No prompts yet
          </h3>
          <p className="max-w-[420px] text-[13px] text-text-2">
            Save reusable prompt templates here so you can drop them into Model
            Arena or other chats in one click.
          </p>
          <Link
            href="/resources/prompt-builder"
            className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
          >
            <Plus className="h-4 w-4" />
            Create your first prompt
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((p) => (
            <article
              key={p.id}
              className="flex gap-4 rounded-lg border border-border-2 bg-bg-white p-5"
            >
              {/* Thumbnail tile */}
              <div className="hidden shrink-0 items-center justify-center self-stretch rounded-lg bg-primary-5/20 sm:flex sm:w-[96px]">
                <FileText className="h-8 w-8 text-primary-7" strokeWidth={2} />
              </div>

              {/* Content */}
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="text-base font-bold leading-snug text-text-1">
                      {p.title}
                    </h3>
                    {p.description && (
                      <p className="text-[13px] leading-snug text-text-2">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(p)}
                      className="inline-flex h-9 cursor-pointer items-center gap-2 rounded bg-primary-6 px-4 text-[13px] font-medium text-text-white transition-colors hover:bg-primary-7"
                    >
                      <Copy className="h-4 w-4" />
                      Copy Prompt
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded border border-border-2 bg-bg-white text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
                          aria-label="More actions"
                          title="More actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            handleEdit(p);
                          }}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setDeleteTarget(p);
                          }}
                          className="text-danger-6 focus:text-danger-6"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {(p.category || p.tags.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {p.category && (
                      <span className="rounded bg-primary-1 px-2.5 py-1 text-[11px] font-medium text-text-2">
                        {p.category}
                      </span>
                    )}
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-border-2 bg-bg-white px-2.5 py-1 text-[11px] font-normal text-text-2"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleExpanded(p.id)}
                  className="inline-flex cursor-pointer self-start items-center gap-1 text-[13px] font-medium text-primary-6 hover:text-primary-7 hover:underline"
                >
                  {expanded.has(p.id) ? "Hide Full Prompt" : "View Full Prompt"}
                  {expanded.has(p.id) ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>

                {expanded.has(p.id) && (
                  <div className="mt-1 flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-[13px] font-semibold text-text-1">
                        Full Prompt Template
                      </h4>
                      <button
                        type="button"
                        onClick={() => handleCopy(p)}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-primary-6 hover:text-primary-7"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </div>
                    <pre className="max-h-[400px] overflow-auto rounded bg-bg-1 p-3 font-mono text-[12px] leading-[1.625] text-text-1 whitespace-pre-wrap">
                      {p.body}
                    </pre>
                  </div>
                )}
              </div>
            </article>
          ))}

          {filtered.length === 0 && (
            <div className="rounded-lg border border-border-2 bg-bg-white p-10 text-center text-sm text-text-3">
              No prompts match your search.
            </div>
          )}
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete prompt</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>&ldquo;{deleteTarget?.title}&rdquo;</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              className="cursor-pointer"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
