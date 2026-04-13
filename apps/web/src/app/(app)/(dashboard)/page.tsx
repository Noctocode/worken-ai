"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  PlusCircle,
  MoreVertical,
  Trash2,
  ArrowRight,
  Clock,
  DollarSign,
  TrendingUp,
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
import { fetchProjects, deleteProject, type Project } from "@/lib/api";
import { MODEL_LABELS } from "@/lib/models";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProjectCard({ project }: { project: Project }) {
  const router = useRouter();
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const queryClient = useQueryClient();

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
                    className="text-red-600 focus:text-red-600"
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
                <span className="text-[13px] text-text-2">{MODEL_LABELS[project.model] || project.model}</span>
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

  return (
    <div className="space-y-6 pt-4">
      {/* All tab: two-column layout */}
      {activeTab === "all" && (
        <>
          {allLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
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
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="col-span-full text-center py-12 text-sm text-red-500">
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
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
                <FolderOpen className="h-6 w-6 text-slate-300" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-700">
                No projects yet
              </h3>
              <p className="mt-1 max-w-[260px] text-center text-xs text-slate-400">
                You don&apos;t have any projects to show. Ask your team owner to
                create one or upgrade to a paid plan.
              </p>
            </div>
          )}

        {/* New Project Card */}
        {canCreateProject ? (
          <Link href="/projects/create">
            <Card className="group flex flex-col items-center justify-center border-dashed border-slate-300 bg-slate-50 text-center transition-all duration-300 hover:border-blue-400 hover:bg-blue-50/30 cursor-pointer">
              <div className="flex flex-1 flex-col items-center justify-center p-4">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition-transform group-hover:scale-110">
                  <PlusCircle className="h-5 w-5 text-slate-400 group-hover:text-blue-600" />
                </div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Create New Project
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-slate-400">
                  Start a new thread, compare models, or analyze documents.
                </p>
              </div>
            </Card>
          </Link>
        ) : (
          <div
            title="Requires a paid plan or an Advanced role in a team."
            aria-disabled="true"
          >
            <Card className="flex flex-col items-center justify-center border-dashed border-slate-300 bg-slate-50 text-center opacity-50 cursor-not-allowed">
              <div className="flex flex-1 flex-col items-center justify-center p-4">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
                  <PlusCircle className="h-5 w-5 text-slate-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-700">
                  Create New Project
                </h3>
                <p className="mt-1 max-w-[180px] text-xs text-slate-400">
                  Start a new thread, compare models, or analyze documents.
                </p>
              </div>
            </Card>
          </div>
        )}
      </div>
        </>
      )}

      {/* Comparisons Section */}
      <div className="border-t border-slate-200/60 pt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Recent Model Comparisons
          </h2>
          <Link
            href="#"
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">
            {/* Comparison Item 1 */}
            <div className="group cursor-pointer p-4 transition-colors hover:bg-slate-50">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  <div className="z-10 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[8px] font-bold text-slate-700 shadow-sm">
                    G4
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[8px] font-bold text-slate-700 shadow-sm">
                    C3
                  </div>
                </div>
                <span className="text-xs font-medium text-slate-500">
                  vs. Baseline
                </span>
              </div>
              <h4 className="text-sm font-medium text-slate-900 transition-colors group-hover:text-blue-600">
                Legal Contract Summary
              </h4>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> 0.4s faster
                </span>
                <span className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> $0.02 saved
                </span>
              </div>
            </div>

            {/* Comparison Item 2 */}
            <div className="group cursor-pointer p-4 transition-colors hover:bg-slate-50">
              <div className="mb-2 flex items-center gap-2">
                <div className="flex -space-x-1.5">
                  <div className="z-10 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[8px] font-bold text-slate-700 shadow-sm">
                    L3
                  </div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[8px] font-bold text-slate-700 shadow-sm">
                    M
                  </div>
                </div>
              </div>
              <h4 className="text-sm font-medium text-slate-900 transition-colors group-hover:text-blue-600">
                Python Code Gen Accuracy
              </h4>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1 text-emerald-600">
                  <TrendingUp className="h-3 w-3" /> 12% better
                </span>
              </div>
            </div>

            {/* Comparison Item 3 */}
            <div className="group cursor-pointer p-4 transition-colors hover:bg-slate-50">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">
                  Benchmark Test
                </span>
              </div>
              <h4 className="text-sm font-medium text-slate-900 transition-colors group-hover:text-blue-600">
                Customer Sentiment Analysis
              </h4>
              <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Yesterday
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
