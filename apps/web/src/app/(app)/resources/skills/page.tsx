"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
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
  createSkill,
  deleteSkill,
  fetchProjects,
  fetchSkill,
  fetchSkills,
  fetchTeams,
  importSkill,
  updateSkill,
  updateSkillVisibility,
  type Project,
  type Skill,
  type SkillInput,
  type SkillVisibility,
  type TeamListItem,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";

interface DraftSkill {
  name: string;
  description: string;
  instructions: string;
  visibility: SkillVisibility;
  teamIds: string[];
  projectIds: string[];
}

const EMPTY_DRAFT: DraftSkill = {
  name: "",
  description: "",
  instructions: "",
  visibility: "all",
  teamIds: [],
  projectIds: [],
};

export default function SkillsPage() {
  const { t } = useLanguage();
  // Personal accounts are a single person: company-tier visibility ('all' =
  // everyone in the company, 'admins', 'teams') is meaningless and the backend
  // rejects it. Show only "Only me" (+ Projects, which personal users can
  // still have) for them.
  const isPersonal = useIsPersonal();
  const [items, setItems] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Skill | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<DraftSkill>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  // Picker sources for 'teams' / 'project' visibility. Loaded once; failures
  // are non-fatal (the picker just shows empty).
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([fetchTeams(), fetchProjects()]).then(
      ([teamsRes, projectsRes]) => {
        if (cancelled) return;
        if (teamsRes.status === "fulfilled") setTeams(teamsRes.value);
        if (projectsRes.status === "fulfilled") setProjects(projectsRes.value);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchSkills()
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t("skills.errLoad");
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.instructions.toLowerCase().includes(q),
    );
  }, [items, query]);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDraftOpen(true);
  };

  const openEdit = (s: Skill) => {
    setEditing(s);
    setDraft({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      visibility: s.visibility,
      teamIds: [],
      projectIds: [],
    });
    setDraftOpen(true);
    // Prefill the team / project pickers from the detail endpoint (the list
    // rows don't carry the link sets). Non-fatal — pickers start empty.
    if (s.visibility === "teams" || s.visibility === "project") {
      void fetchSkill(s.id)
        .then((detail) =>
          setDraft((d) => ({
            ...d,
            teamIds: detail.teamIds ?? [],
            projectIds: detail.projectIds ?? [],
          })),
        )
        .catch(() => {
          /* non-fatal */
        });
    }
  };

  const toggleId = (key: "teamIds" | "projectIds", id: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(id)
        ? d[key].filter((x) => x !== id)
        : [...d[key], id],
    }));

  const sortByUpdated = (rows: Skill[]) =>
    [...rows].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  const handleSave = async () => {
    const name = draft.name.trim();
    const description = draft.description.trim();
    const instructions = draft.instructions.trim();
    if (!name) {
      toast.error(t("skills.errName"));
      return;
    }
    if (!description) {
      toast.error(t("skills.errDescription"));
      return;
    }
    if (!instructions) {
      toast.error(t("skills.errInstructions"));
      return;
    }
    if (draft.visibility === "teams" && draft.teamIds.length === 0) {
      toast.error(t("skills.errPickTeam"));
      return;
    }
    if (draft.visibility === "project" && draft.projectIds.length === 0) {
      toast.error(t("skills.errPickProject"));
      return;
    }

    const payload: SkillInput = {
      name,
      description,
      instructions,
      visibility: draft.visibility,
      teamIds: draft.visibility === "teams" ? draft.teamIds : undefined,
      projectIds: draft.visibility === "project" ? draft.projectIds : undefined,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateSkill(editing.id, { name, description, instructions });
        // Visibility (+ its team/project links) lives on its own endpoint.
        const updated = await updateSkillVisibility(
          editing.id,
          draft.visibility,
          draft.teamIds,
          draft.projectIds,
        );
        setItems((prev) =>
          sortByUpdated(prev.map((s) => (s.id === updated.id ? updated : s))),
        );
        toast.success(t("skills.updated"));
      } else {
        const created = await createSkill(payload);
        setItems((prev) => [created, ...prev]);
        toast.success(t("skills.saved"));
      }
      setDraftOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("skills.errSave");
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error(t("skills.errImportEmpty"));
      return;
    }
    setImporting(true);
    try {
      const created = await importSkill(importText);
      setItems((prev) => [created, ...prev]);
      toast.success(t("skills.imported"));
      setImportOpen(false);
      setImportText("");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("skills.errImport");
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const previous = items;
    setItems((prev) => prev.filter((s) => s.id !== target.id));
    setDeleteTarget(null);
    try {
      await deleteSkill(target.id);
      toast.success(t("skills.deleted").replace("{name}", target.name));
    } catch (err) {
      setItems(previous);
      const message = err instanceof Error ? err.message : t("skills.errDelete");
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
        {t("skills.backToResources")}
      </Link>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("skills.search")}
            className="h-11 pl-9 pr-3 text-base rounded-md border-border-2 placeholder:text-text-3"
          />
        </div>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border-2 bg-bg-white px-4 text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
        >
          <Upload className="h-4 w-4" />
          {t("skills.import")}
        </button>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
        >
          <Plus className="h-4 w-4" />
          {t("skills.new")}
        </button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border-2 bg-bg-white p-10 text-center text-sm text-text-3">
          {t("skills.loading")}
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-danger-6" strokeWidth={1.5} />
          <h3 className="text-[16px] font-semibold text-text-1">
            {t("skills.couldntLoad")}
          </h3>
          <p className="max-w-[480px] text-[13px] text-text-2">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-2 bg-bg-white px-4 text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
          >
            <RotateCcw className="h-4 w-4" />
            {t("skills.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-2 bg-bg-white p-10 text-center">
          <Sparkles className="h-8 w-8 text-text-3" strokeWidth={1.5} />
          <h3 className="text-[16px] font-semibold text-text-1">
            {t("skills.noneYet")}
          </h3>
          <p className="max-w-[440px] text-[13px] text-text-2">
            {t("skills.noneYetDesc")}
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-2 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary-6 px-4 text-[13px] font-medium text-white transition-colors hover:bg-primary-7"
          >
            <Plus className="h-4 w-4" />
            {t("skills.createFirst")}
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
                      {s.name}
                    </h3>
                    <p className="text-[12px] leading-snug text-text-2">
                      {s.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {s.source === "import" && (
                      <span className="rounded bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-text-2">
                        {t("skills.badgeImported")}
                      </span>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-border-2 bg-bg-white text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
                          aria-label={t("skills.moreActions")}
                          title={t("skills.moreActions")}
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
                          {t("skills.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            setDeleteTarget(s);
                          }}
                          className="text-danger-6 focus:text-danger-6"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          {t("skills.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <pre className="line-clamp-3 whitespace-pre-wrap rounded bg-bg-1 px-3 py-2 font-mono text-[12px] leading-[1.5] text-text-1">
                  {s.instructions}
                </pre>
              </div>
            </article>
          ))}

          {filtered.length === 0 && (
            <div className="rounded-lg border border-border-2 bg-bg-white p-8 text-center text-sm text-text-3">
              {t("skills.noMatch")}
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
              {editing ? t("skills.editTitle") : t("skills.newTitle")}
            </DialogTitle>
            <DialogDescription>{t("skills.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">
                {t("skills.nameField")} <span className="text-danger-6">*</span>
              </label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="h-10 rounded border-border-2 text-[13px]"
                placeholder={t("skills.namePh")}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">
                {t("skills.descriptionField")}{" "}
                <span className="text-danger-6">*</span>
              </label>
              <Input
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                className="h-10 rounded border-border-2 text-[13px]"
                placeholder={t("skills.descriptionPh")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">
                {t("skills.instructionsField")}{" "}
                <span className="text-danger-6">*</span>
              </label>
              <Textarea
                value={draft.instructions}
                onChange={(e) =>
                  setDraft({ ...draft, instructions: e.target.value })
                }
                rows={6}
                className="rounded border-border-2 text-[13px]"
                placeholder={t("skills.instructionsPh")}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-2">
                {t("skills.visibilityField")}
              </label>
              <Select
                value={draft.visibility}
                onValueChange={(v) =>
                  setDraft({ ...draft, visibility: v as SkillVisibility })
                }
              >
                <SelectTrigger className="h-10 rounded border-border-2 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {isPersonal
                      ? t("skills.visibilityPersonal")
                      : t("skills.visibilityAll")}
                  </SelectItem>
                  {!isPersonal && (
                    <SelectItem value="admins">
                      {t("skills.visibilityAdmins")}
                    </SelectItem>
                  )}
                  {!isPersonal && (
                    <SelectItem value="teams">
                      {t("skills.visibilityTeams")}
                    </SelectItem>
                  )}
                  <SelectItem value="project">
                    {t("skills.visibilityProject")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.visibility === "teams" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">
                  {t("skills.pickTeams")}
                </label>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-2 p-2">
                  {teams.length === 0 ? (
                    <p className="px-1 py-2 text-[12px] text-text-3">
                      {t("skills.noTeams")}
                    </p>
                  ) : (
                    teams.map((team) => (
                      <label
                        key={team.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={draft.teamIds.includes(team.id)}
                          onChange={() => toggleId("teamIds", team.id)}
                          className="h-4 w-4 cursor-pointer accent-primary-6"
                        />
                        {team.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
            {draft.visibility === "project" && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-text-2">
                  {t("skills.pickProjects")}
                </label>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded border border-border-2 p-2">
                  {projects.length === 0 ? (
                    <p className="px-1 py-2 text-[12px] text-text-3">
                      {t("skills.noProjects")}
                    </p>
                  ) : (
                    projects.map((project) => (
                      <label
                        key={project.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] text-text-1 hover:bg-bg-1"
                      >
                        <input
                          type="checkbox"
                          checked={draft.projectIds.includes(project.id)}
                          onChange={() => toggleId("projectIds", project.id)}
                          className="h-4 w-4 cursor-pointer accent-primary-6"
                        />
                        {project.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDraftOpen(false)}
              disabled={saving}
              className="cursor-pointer"
            >
              {t("skills.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                !draft.name.trim() ||
                !draft.description.trim() ||
                !draft.instructions.trim()
              }
              className="cursor-pointer"
            >
              {saving
                ? editing
                  ? t("skills.updating")
                  : t("skills.saving")
                : editing
                  ? t("skills.update")
                  : t("skills.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!importing) setImportOpen(open);
        }}
      >
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("skills.importTitle")}</DialogTitle>
            <DialogDescription>{t("skills.importDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">
              {t("skills.importField")}
            </label>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              className="rounded border-border-2 font-mono text-[13px]"
              placeholder={t("skills.importPh")}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setImportOpen(false)}
              disabled={importing}
              className="cursor-pointer"
            >
              {t("skills.cancel")}
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="cursor-pointer"
            >
              {importing ? t("skills.saving") : t("skills.importBtn")}
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
            <DialogTitle>{t("skills.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("skills.deleteConfirm").replace(
                "{name}",
                deleteTarget?.name ?? "",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="cursor-pointer"
            >
              {t("skills.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              className="cursor-pointer"
            >
              {t("skills.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
