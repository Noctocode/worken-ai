"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";

import {
  createShortcut,
  deleteShortcut,
  fetchShortcuts,
  SHORTCUT_BODY_MAX,
  updateShortcut,
  type Shortcut,
  type ShortcutInput,
} from "@/lib/api";

interface DraftShortcut {
  label: string;
  body: string;
  category: string;
  description: string;
}

const EMPTY_DRAFT: DraftShortcut = {
  label: "",
  body: "",
  category: "",
  description: "",
};

export default function ShortcutsPage() {
  const [items, setItems] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editing, setEditing] = useState<Shortcut | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<DraftShortcut>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Shortcut | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchShortcuts()
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Couldn't load shortcuts.";
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) {
      if (s.category) set.add(s.category);
    }
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((s) => {
      if (category !== "all" && s.category !== category) return false;
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, query, category]);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDraftOpen(true);
  };

  const openEdit = (s: Shortcut) => {
    setEditing(s);
    setDraft({
      label: s.label,
      body: s.body,
      category: s.category ?? "",
      description: s.description ?? "",
    });
    setDraftOpen(true);
  };

  const handleSave = async () => {
    const label = draft.label.trim();
    const body = draft.body;
    if (!label) {
      toast.error("Please give your shortcut a label.");
      return;
    }
    if (!body.trim()) {
      toast.error("The shortcut body can't be empty.");
      return;
    }
    if (body.length > SHORTCUT_BODY_MAX) {
      toast.error(
        `Body is too long (${body.length}/${SHORTCUT_BODY_MAX} characters).`,
      );
      return;
    }

    const payload: ShortcutInput = {
      label,
      body,
      category: draft.category.trim() || null,
      description: draft.description.trim() || null,
    };

    setSaving(true);
    try {
      if (editing) {
        const updated = await updateShortcut(editing.id, payload);
        setItems((prev) =>
          prev
            .map((s) => (s.id === updated.id ? updated : s))
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            ),
        );
        toast.success("Shortcut updated.");
      } else {
        const created = await createShortcut(payload);
        setItems((prev) => [created, ...prev]);
        toast.success("Shortcut saved.");
      }
      setDraftOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't save shortcut.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const previous = items;
    setItems((prev) => prev.filter((s) => s.id !== target.id));
    setDeleteTarget(null);
    try {
      await deleteShortcut(target.id);
      toast.success(`Deleted "${target.label}".`);
    } catch (err) {
      setItems(previous);
      const message =
        err instanceof Error ? err.message : "Couldn't delete shortcut.";
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

      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] font-bold text-text-1">Shortcuts</h1>
        <p className="text-[13px] text-text-2">
          Short text snippets you can drop into the composer in one click.
        </p>
      </div>

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
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
        >
          <Plus className="h-4 w-4" />
          New Shortcut
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border-2 bg-bg-white p-10 text-center text-sm text-text-3">
          Loading shortcuts…
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-10 text-center">
          <AlertTriangle
            className="h-8 w-8 text-[#D92D20]"
            strokeWidth={1.5}
          />
          <h3 className="text-[16px] font-semibold text-text-1">
            Couldn&apos;t load your shortcuts
          </h3>
          <p className="max-w-[480px] text-[13px] text-text-2">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-2 bg-bg-white px-4 text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-10 text-center">
          <LayoutGrid className="h-8 w-8 text-text-3" strokeWidth={1.5} />
          <h3 className="text-[16px] font-semibold text-text-1">
            No shortcuts yet
          </h3>
          <p className="max-w-[420px] text-[13px] text-text-2">
            Save reusable phrases — formatting directives, tone instructions,
            personas — and drop them into the composer in one click.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
          >
            <Plus className="h-4 w-4" />
            Create your first shortcut
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((s) => (
            <article
              key={s.id}
              className="flex gap-4 rounded-lg border border-border-2 bg-bg-white p-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="text-[14px] font-semibold leading-snug text-text-1">
                      {s.label}
                    </h3>
                    {s.description && (
                      <p className="text-[12px] leading-snug text-text-2">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.category && (
                      <span className="rounded bg-[#EBF8FF] px-2 py-0.5 text-[11px] font-medium text-text-2">
                        {s.category}
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-border-2 bg-bg-white text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
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
                            openEdit(s);
                          }}
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setDeleteTarget(s);
                          }}
                          className="text-[#D92D20] focus:text-[#D92D20]"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <pre className="line-clamp-3 whitespace-pre-wrap rounded bg-bg-1 px-3 py-2 font-mono text-[12px] leading-[1.5] text-text-1">
                  {s.body}
                </pre>
              </div>
            </article>
          ))}

          {filtered.length === 0 && (
            <div className="rounded-lg border border-border-2 bg-bg-white p-8 text-center text-sm text-text-3">
              No shortcuts match your search.
            </div>
          )}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={draftOpen}
        onOpenChange={(open) => {
          if (!saving) setDraftOpen(open);
        }}
      >
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit shortcut" : "New shortcut"}
            </DialogTitle>
            <DialogDescription>
              Short reusable text you can drop into the composer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">
                Label <span className="text-[#D92D20]">*</span>
              </label>
              <Input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                className="h-10 rounded border-border-2 text-[13px]"
                placeholder="e.g. Respond in JSON"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text-2">
                  Body <span className="text-[#D92D20]">*</span>
                </label>
                <span
                  className={`text-[11px] ${
                    draft.body.length > SHORTCUT_BODY_MAX
                      ? "text-[#D92D20]"
                      : "text-text-3"
                  }`}
                >
                  {draft.body.length}/{SHORTCUT_BODY_MAX}
                </span>
              </div>
              <Textarea
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={4}
                className="rounded border-border-2 font-mono text-[13px]"
                placeholder="The text that gets inserted into the composer."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">
                  Category
                </label>
                <Input
                  value={draft.category}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                  className="h-10 rounded border-border-2 text-[13px]"
                  placeholder="e.g. Formatting"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">
                  Description
                </label>
                <Input
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  className="h-10 rounded border-border-2 text-[13px]"
                  placeholder="When to use this shortcut"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDraftOpen(false)}
              disabled={saving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !draft.label.trim() ||
                !draft.body.trim() ||
                draft.body.length > SHORTCUT_BODY_MAX
              }
              className="cursor-pointer"
            >
              {saving
                ? editing
                  ? "Updating…"
                  : "Saving…"
                : editing
                  ? "Update"
                  : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete shortcut</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>&ldquo;{deleteTarget?.label}&rdquo;</strong>? This action
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
