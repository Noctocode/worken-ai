"use client";

import {
  Infinity,
  PlusCircle,
  FolderOpen,
  Layers,
  Users,
  BarChart2,
  ShieldCheck,
  Library,
  LogOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateProjectDialog } from "@/components/create-project-dialog";
import { useAuth } from "@/components/providers";
import { logout } from "@/lib/api";

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const SidebarContent = () => {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      {/* Logo Area */}
      <div className="flex h-[4.5rem] items-center border-b px-6">
        <div className="flex cursor-pointer items-center gap-2.5 group">
          <div className="flex items-center justify-center text-blue-600">
            <Infinity className="h-7 w-7" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-slate-900 transition-colors group-hover:text-blue-600">
            WorkenAI
          </span>
        </div>
      </div>

      {/* Primary Actions */}
      <div className="p-4 pb-2">
        <CreateProjectDialog>
          <Button
            className="w-full gap-2 bg-slate-900 hover:bg-slate-800"
            size="lg"
          >
            <PlusCircle className="h-4 w-4" />
            New Project
          </Button>
        </CreateProjectDialog>
      </div>

      {/* Navigation Links */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-8">
          <div className="space-y-1">
            <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
              Workspace
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 bg-blue-50 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
            >
              <FolderOpen className="h-5 w-5" />
              Ongoing Projects
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-slate-500 hover:text-slate-900"
            >
              <Layers className="h-5 w-5" />
              Compare Models
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-slate-500 hover:text-slate-900"
            >
              <Users className="h-5 w-5" />
              Team Management
            </Button>
          </div>

          <div className="space-y-1">
            <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
              Intelligence
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-slate-500 hover:text-slate-900"
            >
              <BarChart2 className="h-5 w-5" />
              Observability
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-slate-500 hover:text-slate-900"
            >
              <ShieldCheck className="h-5 w-5" />
              Guardrails
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-slate-500 hover:text-slate-900"
            >
              <Library className="h-5 w-5" />
              Prompt Library
            </Button>
          </div>
        </div>
      </ScrollArea>

      {/* User Profile */}
      <div className="mt-auto border-t p-4">
        <div className="group flex items-center gap-3 rounded-lg p-2">
          <Avatar className="h-9 w-9 border border-blue-100 bg-blue-50">
            {user?.picture && <AvatarImage src={user.picture} alt={user.name ?? ""} />}
            <AvatarFallback className="bg-gradient-to-tr from-blue-100 to-blue-50 text-xs font-medium text-blue-700">
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-slate-900">
              {user?.name ?? "Loading..."}
            </p>
            <p className="truncate text-xs text-slate-500">
              {user?.email ?? ""}
            </p>
          </div>
          <button
            onClick={() => logout()}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const Sidebar = () => (
  <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white md:block">
    <SidebarContent />
  </aside>
);
