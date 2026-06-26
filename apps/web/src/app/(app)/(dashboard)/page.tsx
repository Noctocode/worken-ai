"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  PlusCircle,
  MoreVertical,
  Trash2,
  ArrowRight,
  Calendar,
  Loader2,
  FileText,
  FolderOpen,
  User,
  Bot,
  PenSquare,
  Activity,
  Sparkles,
  Search,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AGENTS } from "@/lib/agents";
import { AddDocumentDialog } from "@/components/add-document-dialog";
import { TeamMembersPopover } from "@/components/team-members-popover";
import { useAuth } from "@/components/providers";
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import {
  fetchProjects,
  deleteProject,
  updateProject,
  fetchArenaRuns,
  DuplicateProjectNameError,
  type Project,
  type ArenaRunSummary,
} from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { useLanguage } from "@/lib/i18n";
import { type TranslationKey } from "@/lib/translations/en";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Relative time string for arena history cards. Falls back to a
 * formatted date once the row is older than a week.
 */
function relativeShort(iso: string, t: (key: TranslationKey) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("dashboard.justNow");
  if (min < 60) return `${min}${t("dashboard.minuteAbbr")} ${t("dashboard.ago")}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}${t("dashboard.hourAbbr")} ${t("dashboard.ago")}`;
  const day = Math.floor(hr / 24);
  if (day === 1) return t("dashboard.yesterday");
  if (day < 7) return `${day}${t("dashboard.dayAbbr")} ${t("dashboard.ago")}`;
  return formatDate(iso);
}

/**
 * 2-character avatar derived from a model identifier. Matches the
 * hardcoded "G4 / C3 / L3" style of the original mock: take the
 * model family (after the slash) and grab the first letter + first
 * digit if present, else the first two letters.
 *
 * Examples:
 *  - "anthropic/claude-3-opus" → "C3"
 *  - "openai/gpt-4o"           → "G4"
 *  - "meta-llama/llama-3-70b"  → "L3"
 *  - "mistralai/mistral-large" → "MI"
 */
function modelAvatar(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  const compact = tail.replace(/[^a-zA-Z0-9]/g, "");
  const firstLetter = compact.match(/[a-zA-Z]/)?.[0] ?? "?";
  const firstDigit = compact.match(/\d/)?.[0];
  if (firstDigit) return (firstLetter + firstDigit).toUpperCase();
  return compact.slice(0, 2).toUpperCase() || "??";
}

function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  // Rename dialog — local draft of the name + a flag set when the API
  // rejects a duplicate (409), cleared as soon as the user edits the field.
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTaken, setRenameTaken] = useState(false);
  // Permission gates from the list endpoint. Disable (don't hide) actions
  // the caller can't perform; undefined → allowed (the BE still enforces).
  const canManage = project.canManage !== false;
  const canDelete = project.canDelete !== false;
  // Dialog-local agent pool — multi-select, re-seeded on each open from the
  // project's saved `agents` pool so every previously-picked agent shows
  // highlighted (not just the active one). Committed only on Save so
  // cancelling doesn't leave a half-changed selection behind.
  // Pool is mixed: entries are agent-preset ids OR configured-model ids. The
  // two tabs each toggle their own kind into the same pool.
  const [pendingAgentIds, setPendingAgentIds] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { models: availableModels, getLabel: getModelLabel } =
    useAvailableModels();
  const { effective: configuredModels } = useUserModels();
  // Any model routed through an own key / endpoint (BYOK or Custom LLM) is
  // marked "(custom)"; managed catalog models get no suffix.
  const routingSuffix = (routing: string): string =>
    routing === "byok" || routing === "custom" ? " (custom)" : "";
  // Resolve a pool entry (preset id or model id) to its model slug.
  const resolveSelectionModel = (id: string): string => {
    const preset = AGENTS.find((a) => a.id === id);
    if (!preset) return id;
    return (
      availableModels.find((m) => m.id === preset.model)?.id ??
      availableModels[0]?.id ??
      project.model
    );
  };

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeleteDialogOpen(false);
    },
  });

  const updateModelMutation = useMutation({
    mutationFn: (patch: { agents: string[]; agent: string; model: string }) =>
      updateProject(project.id, patch),
    onSuccess: () => {
      // Invalidate both the list (this card lives in it) and the single-
      // project query, so the project detail page picks up the change
      // when the user navigates in next.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      setModelDialogOpen(false);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to change model",
      );
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateProject(project.id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      setRenameDialogOpen(false);
    },
    onError: (err) => {
      // A duplicate name becomes a field-level error in the dialog; any
      // other failure surfaces as a toast.
      if (err instanceof DuplicateProjectNameError) {
        setRenameTaken(true);
      } else {
        toast.error(
          err instanceof Error ? err.message : "Failed to rename project",
        );
      }
    },
  });

  const submitRename = () => {
    const next = renameValue.trim();
    if (!next) return;
    // No-op rename: nothing changed, just close.
    if (next === project.name.trim()) {
      setRenameDialogOpen(false);
      return;
    }
    setRenameTaken(false);
    renameMutation.mutate(next);
  };

  // Resolve a stored project.model slug to the first agent whose
  // preset maps to that model. Used to highlight a card when the
  // Change model dialog opens. Returns null when no agent matches
  // (custom slug, deprecated default, ...). */
  // The project's saved agent pool, with a fallback for legacy projects
  // created before multi-agent support (empty `agents`): use the active
  // `agent`, else the single agent matching the stored model.
  const seedAgentIds = (): string[] => {
    // The dialog only renders configured models now, so seed only entries that
    // are actually shown — legacy agent-preset ids in the pool aren't rendered
    // and would otherwise stay selected (and re-saved) invisibly. Fall back to
    // the project's active model id.
    const modelIds = new Set(configuredModels.map((m) => m.id));
    const pool =
      project.agents && project.agents.length > 0
        ? project.agents
        : project.agent
          ? [project.agent]
          : [];
    const seeded = pool.filter((id) => modelIds.has(id));
    if (seeded.length > 0) return seeded;
    return modelIds.has(project.model) ? [project.model] : [];
  };

  return (
    <>
      <div
        className="group flex flex-col bg-bg-white cursor-pointer h-full transition-all duration-200 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)]"
        onClick={() => router.push(`/projects/${project.id}`)}
      >
          {/* Top section */}
          <div className="flex-1 flex flex-col gap-2 border border-border-2 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-1 p-1">
                  <User className="h-[18px] w-[18px] text-primary-6" />
                </div>
                <span className="text-[18px] font-bold text-text-1 truncate">{project.name}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    // 24px was too cramped — the card itself swallows
                    // near-miss clicks and navigates instead, so users
                    // overshoot the kebab and land on the project
                    // detail. 44px hit area + a subtle hover bg gives
                    // a forgiving target (close to the WCAG 2.5.5
                    // touch-target minimum) without making the visual
                    // glyph any larger.
                    className="h-11 w-11 rounded-md text-text-3 hover:bg-bg-1 hover:text-text-1 cursor-pointer"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <DropdownMenuItem
                    disabled={!canManage}
                    onSelect={() => setDocDialogOpen(true)}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {t("dashboard.manageContext")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canManage}
                    onSelect={() => {
                      // Re-seed the picker each open so a previous
                      // cancelled change doesn't linger. Seed from the
                      // project's full pool so every previously selected
                      // entry shows highlighted, and open on the tab that
                      // matches the pool's kind (model ids → Custom).
                      setPendingAgentIds(seedAgentIds());
                      setModelDialogOpen(true);
                    }}
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t("dashboard.changeModel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canManage}
                    onSelect={() => {
                      setRenameValue(project.name);
                      setRenameTaken(false);
                      setRenameDialogOpen(true);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("dashboard.renameProject")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canDelete}
                    className="text-danger-6 focus:text-danger-6"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Model badge — shows the agent preset that matches the
                project's current model (if any) plus the resolved model
                name. Previously rendered project.name twice — that was
                a typo from the original mock and isn't useful info to
                duplicate next to the title. */}
            <div className="flex items-center gap-2.5 rounded bg-bg-2 px-2 py-1 w-fit max-w-full">
              {(() => {
                const agentLabel = AGENTS.find(
                  (a) => a.model === project.model,
                )?.label;
                return (
                  <>
                    {agentLabel && (
                      <>
                        <div className="flex items-center gap-1 min-w-0">
                          <Bot className="h-[18px] w-[18px] shrink-0 text-text-2" />
                          <span className="text-[13px] text-text-2 truncate">
                            {agentLabel}
                          </span>
                        </div>
                        <span className="text-[13px] text-text-2 shrink-0">/</span>
                      </>
                    )}
                    <div className="flex items-center gap-1 min-w-0">
                      <PenSquare className="h-[18px] w-[18px] shrink-0 text-text-2" />
                      <span className="text-[13px] text-text-2 truncate">
                        {getModelLabel(project.model)}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          {/* Bottom section — Figma frame 14:3623 / 4659:69143 carries an
              avatar stack of up to 4 team members on the LEFT for team
              projects, then date + activity on the RIGHT. Personal
              projects (no teamMembers) skip the avatar block and keep
              just date + activity. */}
          <div className="flex items-center gap-3 px-3 py-2">
            {project.teamId &&
              project.teamMembers &&
              project.teamMembers.length > 0 && (
                <TeamMembersPopover teamId={project.teamId}>
                  <button
                    type="button"
                    aria-label={t("dashboard.viewTeamMembers")}
                    onClick={(e) => {
                      // Outer card wrapper navigates to the project on
                      // click — stopPropagation keeps the route swap
                      // from firing. Do NOT preventDefault: Radix
                      // Popover triggers on onClick, and composed
                      // handlers in `asChild` bail when the child
                      // calls preventDefault, leaving the popover
                      // closed.
                      e.stopPropagation();
                    }}
                    className="flex items-center gap-1 min-w-0 cursor-pointer rounded-md p-0.5 -m-0.5 hover:bg-bg-1"
                  >
                    <div className="flex items-center">
                      {project.teamMembers.map((m, i) => {
                        const extraClass = i > 0 ? "-ml-2" : "";
                        const initials = (m.userName ?? "?")
                          .trim()
                          .charAt(0)
                          .toUpperCase();
                        return m.userPicture ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={m.id}
                            src={m.userPicture}
                            alt={m.userName ?? ""}
                            className={`h-6 w-6 shrink-0 rounded-full border border-bg-white object-cover ${extraClass}`}
                          />
                        ) : (
                          <div
                            key={m.id}
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-bg-white bg-primary-6 text-[10px] font-medium text-white ${extraClass}`}
                          >
                            {initials}
                          </div>
                        );
                      })}
                    </div>
                    {project.teamMembersCount != null &&
                      project.teamMembersCount > project.teamMembers.length && (
                        <span className="ml-1 text-[13px] text-text-3 whitespace-nowrap">
                          +{project.teamMembersCount - project.teamMembers.length}
                        </span>
                      )}
                  </button>
                </TeamMembersPopover>
              )}
            <div className="ml-auto flex items-center gap-5">
              <div className="flex items-center gap-1">
                <PenSquare className="h-[18px] w-[18px] text-text-2" />
                <span className="text-[13px] text-text-2 whitespace-nowrap">
                  {formatDate(project.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Activity className="h-[18px] w-[18px] text-text-2" />
                <span className="text-[13px] text-text-2">0</span>
              </div>
            </div>
          </div>
        </div>
      <AddDocumentDialog
        projectId={project.id}
        open={docDialogOpen}
        onOpenChange={setDocDialogOpen}
      />
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.deleteProject")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.deleteProjectConfirm")} <strong>{project.name}</strong>? {t("dashboard.cannotUndo")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.renameTitle")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.renameDesc")} <strong>{project.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
            className="space-y-2"
          >
            <Label htmlFor={`rename-${project.id}`}>
              {t("dlg.createProj.name")}
            </Label>
            <Input
              id={`rename-${project.id}`}
              autoFocus
              placeholder={t("dlg.createProj.namePlaceholder")}
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setRenameTaken(false);
              }}
              aria-invalid={renameTaken}
              className={renameTaken ? "border-danger-5" : undefined}
            />
            {renameTaken && (
              <p className="text-[13px] text-danger-5">
                {t("projectCreate.nameTaken")}
              </p>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameDialogOpen(false)}
                disabled={renameMutation.isPending}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={renameMutation.isPending || !renameValue.trim()}
              >
                {renameMutation.isPending
                  ? t("dashboard.saving")
                  : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
        {/* Wider than the default dialog: the agent grid wants room
            for 3–4 cards across on a typical viewport. The same
            visual language as the Select Agent step on
            /projects/create — picking a card maps to that agent's
            preset model, which we save as the new project default. */}
        <DialogContent className="max-w-[960px] sm:max-w-[960px]">
          <DialogHeader>
            <DialogTitle>{t("dashboard.changeModel")}</DialogTitle>
            <DialogDescription>
              {t("dashboard.changeModelPickAgent")} <strong>{project.name}</strong>.{" "}
              {t("projectCreate.selectModelDesc")}
            </DialogDescription>
          </DialogHeader>
          {configuredModels.length === 0 ? (
            <div className="mx-auto my-2 rounded-lg border border-border-2 bg-bg-1 px-4 py-4 text-center text-[14px] text-text-2">
              {t("projectCreate.noModels")}{" "}
              <Link
                href="/teams?tab=models"
                className="text-primary-6 hover:underline"
              >
                {t("projectCreate.addModels")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2.5 py-2">
              {configuredModels.map((m) => {
                const isSelected = pendingAgentIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setPendingAgentIds((prev) =>
                        prev.includes(m.id)
                          ? prev.filter((x) => x !== m.id)
                          : [...prev, m.id],
                      )
                    }
                    title={m.id}
                    className={`flex w-[calc(50%-5px)] cursor-pointer flex-col items-start gap-1 rounded-lg p-4 text-left transition-colors sm:w-auto sm:min-w-[220px] sm:max-w-[260px] ${
                      isSelected
                        ? "border border-primary-6 bg-primary-1"
                        : "border border-transparent bg-bg-1 hover:border-border-3"
                    }`}
                  >
                    <span className="max-w-full truncate text-[14px] font-medium text-text-1">
                      {m.name}
                      {routingSuffix(m.routing)}
                    </span>
                    <span className="max-w-full truncate text-[11px] text-text-3">
                      {m.id}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mx-auto max-w-[700px] text-center text-[12px] text-text-3">
            <strong>(custom)</strong> {t("dashboard.customNote")}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setModelDialogOpen(false)}
              disabled={updateModelMutation.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (pendingAgentIds.length === 0) return;
                // Keep the current active entry if it's still in the pool,
                // otherwise fall back to the first picked one. The active
                // entry drives `model` — its preset model, or the model id
                // itself when the entry is a configured model.
                const activeId = pendingAgentIds.includes(project.agent)
                  ? project.agent
                  : pendingAgentIds[0];
                updateModelMutation.mutate({
                  agents: pendingAgentIds,
                  agent: activeId,
                  model: resolveSelectionModel(activeId),
                });
              }}
              // Disabled while the mutation is in flight or the pool is
              // empty (a project must keep at least one agent).
              disabled={
                updateModelMutation.isPending || pendingAgentIds.length === 0
              }
            >
              {updateModelMutation.isPending ? t("dashboard.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkenDashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  // Personal profiles have no team or company projects — only the
  // Personal view applies. The All / Team tabs are disabled (with a
  // reason) and the active tab is forced to Personal regardless of any
  // stale ?filter in the URL.
  const isPersonal = useIsPersonal();
  const VALID_FILTERS = ["all", "personal", "team"] as const;
  const filterParam = searchParams.get("filter");
  const derivedTab = VALID_FILTERS.includes(filterParam as typeof VALID_FILTERS[number])
    ? (filterParam as typeof VALID_FILTERS[number])
    : "all";
  const activeTab = isPersonal ? "personal" : derivedTab;

  const DASHBOARD_TABS = [
    { value: "all", label: t("common.all") },
    { value: "personal", label: t("common.personal") },
    { value: "team", label: t("common.team") },
  ] as const;

  // URL-driven tab switch — mirrors the appbar's setTab logic, but
  // owned here so the mobile in-page segmented control can drive it
  // directly without rounding through a custom event.
  const setMobileTab = (tab: string) => {
    if (isPersonal && tab !== "personal") return;
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "all") params.delete("filter");
    else params.set("filter", tab);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  };

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["projects", activeTab],
    queryFn: () => fetchProjects(activeTab),
    enabled: activeTab !== "all",
  });

  const { data: teamProjects, isLoading: teamLoading } = useQuery({
    queryKey: ["projects", "team"],
    queryFn: () => fetchProjects("team"),
    enabled: activeTab === "all",
  });

  const { data: personalProjects, isLoading: personalLoading } = useQuery({
    queryKey: ["projects", "personal"],
    queryFn: () => fetchProjects("personal"),
    enabled: activeTab === "all",
  });

  const canCreateProject = user?.canCreateProject;
  const allLoading = activeTab === "all" ? (teamLoading || personalLoading) : isLoading;

  // Recent arena runs power the comparisons section below. Capped
  // to a small batch — the dashboard only renders the top 3 cards,
  // and the full history lives on /compare-models.
  const { data: arenaRuns = [], isLoading: arenaRunsLoading } = useQuery({
    queryKey: ["arena-runs"],
    queryFn: fetchArenaRuns,
  });
  const recentRuns = arenaRuns.slice(0, 3);

  return (
    <div className="space-y-6 pt-4">
      {/* Mobile in-page header — the desktop appbar carries title +
          tabs + search; on <md we move that into the page content so
          the sticky top bar can shrink to a compact brand + menu row.
          Matches Figma node 4659:69128 (title row + segmented tabs). */}
      <div className="md:hidden flex flex-col gap-4 pb-2">
        <div className="flex items-center gap-3">
          <h4 className="text-[23px] font-bold text-text-1 shrink-0">{t("dashboard.aiChat")}</h4>
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border-3 bg-bg-white px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-text-3" />
            <input
              placeholder={t("dashboard.search")}
              className="flex-1 min-w-0 bg-transparent text-[14px] text-text-1 outline-none placeholder:text-text-3"
            />
          </div>
        </div>
        <div className="flex items-stretch overflow-hidden rounded-[4px] border border-border-2">
          {DASHBOARD_TABS.map((tab) => {
            const disabled = isPersonal && tab.value !== "personal";
            return (
              <DisabledReasonTooltip
                key={tab.value}
                disabled={disabled}
                reason={t("common.personalViewsDisabled")}
                className="flex-1"
              >
                <button
                  type="button"
                  onClick={() => setMobileTab(tab.value)}
                  disabled={disabled}
                  className={`w-full px-4 py-2.5 text-[14px] font-normal transition-colors ${
                    disabled
                      ? "cursor-not-allowed bg-bg-white text-text-3 opacity-50"
                      : activeTab === tab.value
                        ? "bg-bg-3 text-text-1 cursor-pointer"
                        : "bg-bg-white text-text-1 hover:bg-bg-1 cursor-pointer"
                  }`}
                >
                  {tab.label}
                </button>
              </DisabledReasonTooltip>
            );
          })}
        </div>
      </div>

      {/* All tab: two-column layout */}
      {activeTab === "all" && (
        <>
          {allLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-3" />
            </div>
          ) : (
            <div className="flex flex-col gap-6 md:flex-row md:gap-4">
              <div className="flex-1 min-w-0 space-y-4 md:space-y-4">
                <p className="text-[18px] md:text-[26px] font-bold text-text-1">{t("dashboard.teamProjects")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {teamProjects?.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                  {teamProjects?.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-text-3">{t("dashboard.noTeamProjects")}</p>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <p className="text-[18px] md:text-[26px] font-bold text-text-1">{t("dashboard.personalProjects")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {personalProjects?.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                  {personalProjects?.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-text-3">{t("dashboard.noPersonalProjects")}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Personal/Team tab: single grid */}
      {activeTab !== "all" && (
        <>
          <p className="text-[18px] md:text-[26px] font-bold text-text-1">
            {activeTab === "team" ? t("dashboard.teamProjects") : t("dashboard.personalProjects")}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <div className="col-span-full flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-text-3" />
          </div>
        )}

        {error && (
          <div className="col-span-full text-center py-12 text-sm text-danger-6">
            {t("dashboard.failedToLoadProjects")}
          </div>
        )}

        {projects?.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}

        {!isLoading &&
          !error &&
          projects?.length === 0 &&
          !canCreateProject && (
            <div className="col-span-full flex flex-col items-center justify-center py-16">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-2 bg-bg-white shadow-sm">
                <FolderOpen className="h-6 w-6 text-text-3" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-text-1">
                {t("dashboard.noProjectsYet")}
              </h3>
              <p className="mt-1 max-w-[260px] text-center text-xs text-text-3">
                {t("dashboard.noProjectsDesc")}
              </p>
            </div>
          )}

        {/* New Project Card */}
        {canCreateProject ? (
          <Link href="/projects/create">
            <Card className="group flex flex-col items-center justify-center border-dashed border-border-3 bg-bg-1 text-center transition-all duration-300 hover:border-primary-6 hover:bg-primary-1/30 cursor-pointer">
              <div className="flex flex-1 flex-col items-center justify-center p-4">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-white shadow-sm transition-transform group-hover:scale-110">
                  <PlusCircle className="h-5 w-5 text-text-3 group-hover:text-primary-6" />
                </div>
                <h3 className="text-sm font-semibold text-text-1">
                  {t("dashboard.createNewProject")}
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-text-3">
                  {t("dashboard.createNewProjectDesc")}
                </p>
              </div>
            </Card>
          </Link>
        ) : (
          <DisabledReasonTooltip
            disabled
            reason={t("sidebar.noCreateTooltip")}
          >
            <Card className="flex flex-col items-center justify-center border-dashed border-border-3 bg-bg-1 text-center opacity-50 cursor-not-allowed">
              <div className="flex flex-1 flex-col items-center justify-center p-4">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-white shadow-sm">
                  <PlusCircle className="h-5 w-5 text-text-3" />
                </div>
                <h3 className="text-sm font-semibold text-text-1">
                  {t("dashboard.createNewProject")}
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-text-3">
                  {t("dashboard.createNewProjectDesc")}
                </p>
              </div>
            </Card>
          </DisabledReasonTooltip>
        )}
      </div>
        </>
      )}

      {/* Comparisons Section */}
      <RecentComparisons runs={recentRuns} loading={arenaRunsLoading} />
    </div>
  );
}

/**
 * Recent model-arena history strip. Renders up to three of the
 * user's last comparison runs as cards with model avatars +
 * question excerpt + relative time. Cards link straight back to
 * /compare-models — once that page supports a `?run=<id>` query
 * param this can deep-link directly to a loaded run.
 *
 * Loading + empty states match the rest of the dashboard so the
 * section doesn't visually pop when there's no data yet.
 */
function RecentComparisons({
  runs,
  loading,
}: {
  runs: ArenaRunSummary[];
  loading: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className="border-t border-border-2 pt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text-1">
          {t("dashboard.recentComparisons")}
        </h2>
        <Link
          href="/compare-models"
          className="flex items-center gap-1 text-sm font-medium text-primary-6 hover:text-primary-7"
        >
          {t("common.viewAll")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-border-2 bg-bg-white py-10 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-text-3" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border-2 bg-bg-white py-10 text-center shadow-sm">
          <p className="text-sm text-text-3">
            {t("dashboard.noComparisons")}
          </p>
          <Link
            href="/compare-models"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-6 hover:text-primary-7"
          >
            {t("dashboard.openArena")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-2 bg-bg-white shadow-sm">
          {/* Stretch one card to full width when there's just 1 run,
              two columns at 2 runs, three at 3+. Keeps the grid
              visually balanced regardless of count. */}
          <div
            className={`grid grid-cols-1 divide-y divide-border-2 md:divide-x md:divide-y-0 ${
              runs.length === 1
                ? "md:grid-cols-1"
                : runs.length === 2
                  ? "md:grid-cols-2"
                  : "md:grid-cols-3"
            }`}
          >
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/compare-models?run=${run.id}`}
                className="group block cursor-pointer p-4 transition-colors hover:bg-bg-1"
              >
                <div className="mb-2 flex items-center gap-2">
                  {run.models.length > 0 && (
                    <div className="flex -space-x-1.5">
                      {run.models.slice(0, 3).map((m, idx) => (
                        <div
                          key={m}
                          title={m}
                          style={{ zIndex: 10 - idx }}
                          className="relative flex h-6 w-6 items-center justify-center rounded-full border border-border-2 bg-bg-white text-[8px] font-bold text-text-1 shadow-sm"
                        >
                          {modelAvatar(m)}
                        </div>
                      ))}
                      {run.models.length > 3 && (
                        <div
                          title={run.models.slice(3).join(", ")}
                          className="relative flex h-6 w-6 items-center justify-center rounded-full border border-border-2 bg-bg-1 text-[8px] font-bold text-text-2 shadow-sm"
                        >
                          +{run.models.length - 3}
                        </div>
                      )}
                    </div>
                  )}
                  <span className="text-xs font-medium text-text-2">
                    {run.models.length === 1
                      ? `1 ${t("dashboard.modelSingular")}`
                      : `${run.models.length} ${t("dashboard.modelPlural")}`}
                  </span>
                </div>
                <h4 className="line-clamp-2 text-sm font-medium text-text-1 transition-colors group-hover:text-primary-6">
                  {run.question}
                </h4>
                <div className="mt-3 flex items-center gap-4 text-xs text-text-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {relativeShort(run.createdAt, t)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
