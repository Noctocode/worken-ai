"use client";

import {
  BarChart2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Layers,
  Library,
  LogOut,
  PlusCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CreateProjectDialog } from "@/components/create-project-dialog";
import { useAuth } from "@/components/providers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSidebar } from "@/hooks/use-sidebar";
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
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  const activeClass =
    "bg-blue-50 text-blue-600 hover:bg-blue-50 hover:text-blue-700";
  const inactiveClass = "text-slate-500 hover:text-slate-900";

  const newProjectButton = (
    <Button
      className={`w-full gap-2 bg-slate-900 hover:bg-slate-800 ${collapsed ? "px-0" : ""}`}
      size="lg"
      title="New Project"
    >
      <PlusCircle className="h-4 w-4 shrink-0" />
      {!collapsed && <span>New Project</span>}
    </Button>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Logo Area */}
      <div className={`relative flex h-[4.5rem] items-center ${collapsed ? "" : "border-b"}`}>
        <div className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-between px-6"}`}>
          <Link
            href="/"
            className="flex cursor-pointer items-center group"
          >
            {collapsed ? (
              <Image
                src="/main-logo.png"
                alt="WorkenAI"
                width={30}
                height={14}
                className="shrink-0"
              />
            ) : (
              <Image
                src="/full-logo.png"
                alt="WorkenAI"
                width={140}
                height={32}
                className="shrink-0"
              />
            )}
          </Link>
        </div>
        {/* Toggle button – positioned on the edge of the sidebar */}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-1/2 -translate-y-1/2 -right-3 z-30 flex h-6 w-6 items-center justify-center rounded-lg border border-[#E5E6EB] bg-white text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Primary Actions */}
      <div className={`p-4 pb-2 ${collapsed ? "px-2" : ""}`}>
        {user?.canCreateProject ? (
          <CreateProjectDialog>{newProjectButton}</CreateProjectDialog>
        ) : (
          <Button
            className={`w-full gap-2 bg-slate-900 hover:bg-slate-800 opacity-50 cursor-not-allowed ${collapsed ? "px-0" : ""}`}
            size="lg"
            disabled
            title="New Project"
          >
            <PlusCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span>New Project</span>}
          </Button>
        )}
      </div>

      {/* Navigation Links */}
      <ScrollArea className={`flex-1 py-4 ${collapsed ? "px-2" : "px-3"}`}>
        <div className="space-y-8">
          <div className="space-y-1">
            {!collapsed && (
              <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                Workspace
              </div>
            )}
            <Link href="/">
              <Button
                variant="ghost"
                className={`w-full gap-3 ${collapsed ? "justify-center px-0" : "justify-start"} ${pathname === "/" ? activeClass : inactiveClass}`}
                title="Ongoing Projects"
              >
                <FolderOpen className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Ongoing Projects</span>}
              </Button>
            </Link>
            <Link href="/compare-models">
              <Button
                variant="ghost"
                className={`w-full gap-3 ${collapsed ? "justify-center px-0" : "justify-start"} ${pathname === "/compare-models" ? activeClass : inactiveClass}`}
                title="Compare Models"
              >
                <Layers className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Compare Models</span>}
              </Button>
            </Link>
            <Link href="/teams">
              <Button
                variant="ghost"
                className={`w-full gap-3 ${collapsed ? "justify-center px-0" : "justify-start"} ${pathname.startsWith("/teams") ? activeClass : inactiveClass}`}
                title="Team Management"
              >
                <Users className="h-5 w-5 shrink-0" />
                {!collapsed && <span>Team Management</span>}
              </Button>
            </Link>
          </div>

          <div className="space-y-1">
            {!collapsed && (
              <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                Intelligence
              </div>
            )}
            <Button
              variant="ghost"
              className={`w-full gap-3 text-slate-500 hover:text-slate-900 ${collapsed ? "justify-center px-0" : "justify-start"}`}
              title="Observability"
            >
              <BarChart2 className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Observability</span>}
            </Button>
            <Button
              variant="ghost"
              className={`w-full gap-3 text-slate-500 hover:text-slate-900 ${collapsed ? "justify-center px-0" : "justify-start"}`}
              title="Guardrails"
            >
              <ShieldCheck className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Guardrails</span>}
            </Button>
            <Button
              variant="ghost"
              className={`w-full gap-3 text-slate-500 hover:text-slate-900 ${collapsed ? "justify-center px-0" : "justify-start"}`}
              title="Prompt Library"
            >
              <Library className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Prompt Library</span>}
            </Button>
          </div>
        </div>
      </ScrollArea>

      {/* User Profile */}
      <div className={`mt-auto p-4 ${collapsed ? "" : "border-t"}`}>
        <div
          className={`group flex items-center rounded-lg p-2 ${collapsed ? "justify-center" : "gap-3"}`}
        >
          <Avatar className="h-9 w-9 shrink-0 border border-blue-100 bg-blue-50">
            {user?.picture && (
              <AvatarImage src={user.picture} alt={user.name ?? ""} />
            )}
            <AvatarFallback className="bg-gradient-to-tr from-blue-100 to-blue-50 text-xs font-medium text-blue-700">
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export const Sidebar = () => {
  const { collapsed } = useSidebar();

  return (
    <aside
      className={`relative hidden shrink-0 md:block transition-all duration-300 ${collapsed ? "w-[88px] bg-[#F7F8FA]" : "w-72 border-r border-slate-200 bg-white"}`}
    >
      <SidebarContent />
    </aside>
  );
};