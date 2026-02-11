"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  PlusCircle,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Sparkles,
  ArrowRight,
  Clock,
  DollarSign,
  TrendingUp,
  Calendar,
  Loader2,
  FileText,
  FolderOpen,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { AddDocumentDialog } from "@/components/add-document-dialog";
import { useAuth } from "@/components/providers";
import { fetchProjects, type Project } from "@/lib/api";
import { MODEL_LABELS } from "@/lib/models";

function formatTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ProjectCard({ project }: { project: Project }) {
  const [docDialogOpen, setDocDialogOpen] = useState(false);

  return (
    <>
      <Link href={`/projects/${project.id}`} className="block">
        <Card className="group relative flex flex-col border-slate-200 transition-all duration-300 hover:border-blue-300 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] cursor-pointer h-full">
          <CardHeader className="pb-1 pt-3">
            <div className="mb-2 flex items-start justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1.5">
                {project.teamId && (
                  <Badge variant="secondary" className="gap-1 text-xs border-purple-200 bg-purple-50 text-purple-700">
                    <Users className="h-3 w-3" />
                    Team
                  </Badge>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 group-hover:opacity-100"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <DropdownMenuItem onSelect={() => setDocDialogOpen(true)}>
                      <FileText className="mr-2 h-4 w-4" />
                      Add Context
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <CardTitle className="text-sm font-semibold text-slate-900 transition-colors group-hover:text-blue-600">
              {project.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-2">
            <CardDescription className="line-clamp-2 text-xs text-slate-500">
              {project.description || "No description"}
            </CardDescription>
          </CardContent>
          <CardFooter className="mt-auto border-t border-slate-100 pt-3">
            <div className="flex w-full items-center justify-between">
              <Badge
                variant="secondary"
                className="gap-1 border border-slate-100 bg-slate-50 text-xs font-medium text-slate-600"
              >
                <Sparkles className="h-3 w-3" />
                {MODEL_LABELS[project.model] || project.model}
              </Badge>
              <span className="text-xs font-medium text-slate-400">
                {formatTimeAgo(project.createdAt)}
              </span>
            </div>
          </CardFooter>
        </Card>
      </Link>
      <AddDocumentDialog
        projectId={project.id}
        open={docDialogOpen}
        onOpenChange={setDocDialogOpen}
      />
    </>
  );
}

export default function WorkenDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"all" | "personal" | "team">("all");

  const {
    data: projects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["projects", activeTab],
    queryFn: () => fetchProjects(activeTab),
  });

  const canCreateProject = user?.canCreateProject;

  return (
    <div className="space-y-8">
      {/* Page Title & Mobile Search */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Ongoing Projects
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage and monitor your AI development workflows.
          </p>
        </div>
        <div className="w-full sm:hidden">
          <Input
            placeholder="Search..."
            className="bg-white border-slate-200"
          />
        </div>
      </div>

      {/* Filters & Controls */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200/60 pb-2 sm:flex-row sm:items-center">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-auto">
          <TabsList className="bg-slate-100 p-1">
            <TabsTrigger value="all" className="px-4 text-xs font-medium">
              All Projects
            </TabsTrigger>
            <TabsTrigger value="personal" className="px-4 text-xs font-medium">
              Personal
            </TabsTrigger>
            <TabsTrigger value="team" className="px-4 text-xs font-medium">
              Team
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
            <span>Sort by:</span>
            <Button
              variant="ghost"
              className="h-auto p-0 font-medium text-slate-700 hover:bg-transparent hover:text-blue-600"
            >
              Last Activity
              <ChevronRight className="ml-1 h-3 w-3 rotate-90" />
            </Button>
          </div>
          <Separator
            orientation="vertical"
            className="h-4 hidden sm:block bg-slate-300"
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Filter className="h-4 w-4" />
            Filter
          </Button>
          {canCreateProject && (
            <CreateProjectDialog>
              <Button size="sm" className="gap-2 sm:hidden">
                <PlusCircle className="h-4 w-4" />
                New
              </Button>
            </CreateProjectDialog>
          )}
        </div>
      </div>

      {/* Projects Grid */}
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

        {!isLoading && !error && projects?.length === 0 && !canCreateProject && (
          <div className="col-span-full flex flex-col items-center justify-center py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
              <FolderOpen className="h-6 w-6 text-slate-300" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-700">
              No projects yet
            </h3>
            <p className="mt-1 max-w-[260px] text-center text-xs text-slate-400">
              You don&apos;t have any projects to show. Ask your team owner to create one or upgrade to a paid plan.
            </p>
          </div>
        )}

        {/* New Project Card */}
        {canCreateProject && (
          <CreateProjectDialog>
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
          </CreateProjectDialog>
        )}
      </div>

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
