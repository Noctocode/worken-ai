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
} from "lucide-react";
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
import { AddDocumentDialog } from "@/components/add-document-dialog";
import { useAuth } from "@/components/providers";
import {
  fetchProjects,
  deleteProject,
  fetchArenaRuns,
  type Project,
  type ArenaRunSummary,
} from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";

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
function relativeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day}d ago`;
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
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { getLabel: getModelLabel } = useAvailableModels();

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDeleteDialogOpen(false);
    },
  });

  return (
    <>
      <div
        className="group flex flex-col bg-bg-white cursor-pointer h-full transition-all duration-200 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.08)]"
        onClick={() => router.push(`/projects/${project.id}`)}
      >
          {/* Top section */}
          <div className="flex-1 flex flex-col gap-2 border border-border-2 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center rounded bg-primary-1 p-1">
                  <User className="h-[18px] w-[18px] text-primary-6" />
                </div>
                <span className="text-[18px] font-bold text-text-1">{project.name}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-text-3 hover:text-text-1 cursor-pointer"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  <DropdownMenuItem onSelect={() => setDocDialogOpen(true)}>
                    <FileText className="mr-2 h-4 w-4" />
                    Manage Context
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-danger-6 focus:text-danger-6"
                    onSelect={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* Model badge */}
            <div className="flex items-center gap-2.5 rounded bg-bg-2 px-2 py-1 w-fit">
              <div className="flex items-center gap-1">
                <Bot className="h-[18px] w-[18px] text-text-2" />
                <span className="text-[13px] text-text-2">{project.name}</span>
              </div>
              <span className="text-[13px] text-text-2">/</span>
              <div className="flex items-center gap-1">
                <PenSquare className="h-[18px] w-[18px] text-text-2" />
                <span className="text-[13px] text-text-2">{getModelLabel(project.model)}</span>
              </div>
            </div>
          </div>
          {/* Bottom section */}
          <div className="flex items-center gap-5 px-3 py-2">
            <div className="flex items-center gap-1">
              <PenSquare className="h-[18px] w-[18px] text-text-2" />
              <span className="text-[13px] text-text-2">{formatDate(project.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Activity className="h-[18px] w-[18px] text-text-2" />
              <span className="text-[13px] text-text-2">0</span>
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
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{project.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function WorkenDashboard() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const VALID_FILTERS = ["all", "personal", "team"] as const;
  const filterParam = searchParams.get("filter");
  const activeTab = VALID_FILTERS.includes(filterParam as typeof VALID_FILTERS[number])
    ? (filterParam as typeof VALID_FILTERS[number])
    : "all";

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
      {/* All tab: two-column layout */}
      {activeTab === "all" && (
        <>
          {allLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-3" />
            </div>
          ) : (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0 space-y-4">
                <p className="text-[26px] font-bold text-text-1">Team Projects</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {teamProjects?.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                  {teamProjects?.length === 0 && (
                    <p className="col-span-2 py-8 text-center text-sm text-text-3">No team projects yet.</p>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <p className="text-[26px] font-bold text-text-1">Personal Projects</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {personalProjects?.map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                  {personalProjects?.length === 0 && (
                    <p className="col-span-2 py-8 text-center text-sm text-text-3">No personal projects yet.</p>
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
          <p className="text-[26px] font-bold text-text-1">
            {activeTab === "team" ? "Team Projects" : "Personal Projects"}
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <div className="col-span-full flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-text-3" />
          </div>
        )}

        {error && (
          <div className="col-span-full text-center py-12 text-sm text-danger-6">
            Failed to load projects. Is the API running?
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
                No projects yet
              </h3>
              <p className="mt-1 max-w-[260px] text-center text-xs text-text-3">
                You don&apos;t have any projects to show. Ask your team owner to
                create one or upgrade to a paid plan.
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
                  Create New Project
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-text-3">
                  Start a new thread, compare models, or analyze documents.
                </p>
              </div>
            </Card>
          </Link>
        ) : (
          <DisabledReasonTooltip
            disabled
            reason="Not available for basic users"
          >
            <Card className="flex flex-col items-center justify-center border-dashed border-border-3 bg-bg-1 text-center opacity-50 cursor-not-allowed">
              <div className="flex flex-1 flex-col items-center justify-center p-4">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-border-2 bg-bg-white shadow-sm">
                  <PlusCircle className="h-5 w-5 text-text-3" />
                </div>
                <h3 className="text-sm font-semibold text-text-1">
                  Create New Project
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-text-3">
                  Start a new thread, compare models, or analyze documents.
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
  return (
    <div className="border-t border-border-2 pt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-text-1">
          Recent Model Comparisons
        </h2>
        <Link
          href="/compare-models"
          className="flex items-center gap-1 text-sm font-medium text-primary-6 hover:text-primary-7"
        >
          View all
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
            No comparisons yet. Run one in the Arena to compare
            models side-by-side.
          </p>
          <Link
            href="/compare-models"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-6 hover:text-primary-7"
          >
            Open Arena
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
                href="/compare-models"
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
                      ? "1 model"
                      : `${run.models.length} models`}
                  </span>
                </div>
                <h4 className="line-clamp-2 text-sm font-medium text-text-1 transition-colors group-hover:text-primary-6">
                  {run.question}
                </h4>
                <div className="mt-3 flex items-center gap-4 text-xs text-text-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {relativeShort(run.createdAt)}
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
