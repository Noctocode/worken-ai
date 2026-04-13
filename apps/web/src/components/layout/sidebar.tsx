"use client";

import {
  BarChart2,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Layers,
  Library,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

export const SidebarContent = ({ showToggle = true }: { showToggle?: boolean }) => {
  const { user } = useAuth();
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  const activeClass = "text-text-1 hover:text-text-1";
  const activeIconClass = "text-primary-6";
  const inactiveClass = "text-text-2 font-normal hover:text-text-1";
  const inactiveIconClass = "text-text-3";

  const newProjectButton = collapsed ? (
    <Button
      asChild
      className="h-[48px] w-[40px] bg-primary-6 p-0 hover:bg-primary-7 text-white"
      title="New Project"
    >
      <Link href="/projects/create">
        <Plus className="h-4 w-4 shrink-0" />
      </Link>
    </Button>
  ) : (
    <Button
      asChild
      className="h-[48px] w-full gap-2 bg-primary-6 hover:bg-primary-7"
      title="New Project"
    >
      <Link href="/projects/create">
        <Plus className="h-4 w-4 shrink-0" />
        <span>New Project</span>
      </Link>
    </Button>
  );

  return (
    <div className="flex h-full flex-col py-[30px] px-[24px]">
      {/* Logo Area */}
      <div className="relative flex items-center">
        <div className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-between"}`}>
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
        {showToggle && (
          <button
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute top-1/2 -translate-y-1/2 -right-3 z-30 flex h-6 w-6 items-center justify-center rounded-lg border border-border-2 bg-white text-text-3 transition-colors hover:bg-bg-1 hover:text-text-2"
          >
            {collapsed ? (
              <ChevronsRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronsLeft className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Primary Actions */}
      <div className="flex justify-center py-[60px]">
        {user?.canCreateProject ? (
          newProjectButton
        ) : collapsed ? (
          <Button
            className="h-[48px] w-[40px] bg-primary-6 p-0 text-white opacity-50 cursor-not-allowed"
            disabled
            title="New Project"
          >
            <Plus className="h-4 w-4 shrink-0" />
          </Button>
        ) : (
          <Button
            className="h-[48px] w-full gap-2 bg-primary-6 hover:bg-primary-7 opacity-50 cursor-not-allowed"
            disabled
            title="New Project"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Project</span>
          </Button>
        )}
      </div>

      {/* Navigation Links */}
      <ScrollArea className="flex-1 py-4 px-0">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Button
              asChild
              variant="ghost"
              className={`h-[40px] w-[40px] p-0 justify-center ${pathname === "/" ? activeIconClass : inactiveIconClass}`}
              title="Ongoing Projects"
            >
              <Link href="/">
                <FolderOpen className="h-5 w-5 shrink-0" />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className={`h-[40px] w-[40px] p-0 justify-center ${pathname === "/compare-models" ? activeIconClass : inactiveIconClass}`}
              title="Compare Models"
            >
              <Link href="/compare-models">
                <Layers className="h-5 w-5 shrink-0" />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className={`h-[40px] w-[40px] p-0 justify-center ${pathname.startsWith("/teams") ? activeIconClass : inactiveIconClass}`}
              title="Team Management"
            >
              <Link href="/teams">
                <Users className="h-5 w-5 shrink-0" />
              </Link>
            </Button>

            {/* Divider */}
            <div className="my-4 w-[40px] border-t border-border-2" />

            {/* Chat */}
            <Button
              variant="ghost"
              className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
              title="Chat"
            >
              <MessageSquare className="h-5 w-5 shrink-0" />
            </Button>

            {/* Divider */}
            <div className="my-4 w-[40px] border-t border-border-2" />

            {/* Intelligence icons */}
            <Button
              variant="ghost"
              className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
              title="Observability"
            >
              <BarChart2 className="h-5 w-5 shrink-0" />
            </Button>
            <Button
              variant="ghost"
              className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
              title="Guardrails"
            >
              <ShieldCheck className="h-5 w-5 shrink-0" />
            </Button>
            <Button
              variant="ghost"
              className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
              title="Prompt Library"
            >
              <Library className="h-5 w-5 shrink-0" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Button
              asChild
              variant="ghost"
              size="nav"
              className={`w-full justify-start gap-3 ${pathname === "/" ? activeClass : inactiveClass}`}
              title="Ongoing Projects"
            >
              <Link href="/">
                <FolderOpen className={`h-5 w-5 shrink-0 ${pathname === "/" ? activeIconClass : inactiveIconClass}`} />
                <span>Ongoing Projects</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="nav"
              className={`w-full justify-start gap-3 ${pathname === "/compare-models" ? activeClass : inactiveClass}`}
              title="Compare Models"
            >
              <Link href="/compare-models">
                <Layers className={`h-5 w-5 shrink-0 ${pathname === "/compare-models" ? activeIconClass : inactiveIconClass}`} />
                <span>Compare Models</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="nav"
              className={`w-full justify-start gap-3 ${pathname.startsWith("/teams") ? activeClass : inactiveClass}`}
              title="Team Management"
            >
              <Link href="/teams">
                <Users className={`h-5 w-5 shrink-0 ${pathname.startsWith("/teams") ? activeIconClass : inactiveIconClass}`} />
                <span>Team Management</span>
              </Link>
            </Button>

            {/* Divider */}
            <div className="my-4 w-full border-t border-border-2" />

            {/* Chat */}
            <Button
              variant="ghost"
              size="nav"
              className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1"
              title="Chat"
            >
              <MessageSquare className="h-5 w-5 shrink-0 text-text-3" />
              <span>AI Chat</span>
            </Button>

            {/* Divider */}
            <div className="my-4 w-full border-t border-border-2" />

            {/* Intelligence */}
            <Button
              variant="ghost"
              size="nav"
              className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1"
              title="Observability"
            >
              <BarChart2 className="h-5 w-5 shrink-0 text-text-3" />
              <span>Observability</span>
            </Button>
            <Button
              variant="ghost"
              size="nav"
              className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1"
              title="Guardrails"
            >
              <ShieldCheck className="h-5 w-5 shrink-0 text-text-3" />
              <span>Guardrails</span>
            </Button>
            <Button
              variant="ghost"
              size="nav"
              className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1"
              title="Prompt Library"
            >
              <Library className="h-5 w-5 shrink-0 text-text-3" />
              <span>Prompt Library</span>
            </Button>
          </div>
        )}
      </ScrollArea>

      {/* User Profile */}
      <div className={`mt-auto ${collapsed ? "flex flex-col items-center gap-3" : "flex flex-col items-center gap-3"}`}>
        {/* Dark mode toggle */}
        {collapsed ? (
          <Button
            variant="ghost"
            className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
            title="Toggle dark mode"
          >
            <Moon className="h-5 w-5 text-text-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="nav"
            className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1"
            title="Toggle dark mode"
          >
            <Moon className="h-5 w-5 shrink-0 text-text-3" />
            <span>Light / Dark</span>
          </Button>
        )}
        <div
          className={`group flex items-center rounded-lg ${collapsed ? "justify-center" : "w-full gap-3"}`}
        >
          <Avatar className={`shrink-0 ${collapsed ? "h-8 w-8 border border-black-400" : "h-9 w-9 border border-black-400"}`}>
            <AvatarImage src={user?.picture || "/default-avatar.png"} alt={user?.name ?? ""} />
            <AvatarFallback className={collapsed ? "text-xs font-medium text-text-1" : "bg-primary-1 text-xs font-medium text-primary-6"}>
              {getInitials(user?.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-text-1">
                  {user?.name ?? "Loading..."}
                </p>
                <p className="truncate text-xs text-text-3">
                  {user?.email ?? ""}
                </p>
              </div>
              <button
                onClick={() => logout()}
                className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-white hover:text-text-2"
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
      className={`relative hidden shrink-0 md:block transition-all duration-300 ${collapsed ? "w-[88px] bg-bg-1" : "w-72 bg-bg-1"}`}
    >
      <SidebarContent />
    </aside>
  );
};
