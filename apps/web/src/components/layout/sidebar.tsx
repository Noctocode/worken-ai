"use client";

import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Layers,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/components/providers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
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

export const SidebarContent = ({
  showToggle = true,
  forceCollapsed = false,
}: {
  showToggle?: boolean;
  forceCollapsed?: boolean;
}) => {
  const { user } = useAuth();
  const pathname = usePathname();
  const { collapsed: providerCollapsed, toggle } = useSidebar();
  const collapsed = forceCollapsed || providerCollapsed;

  const activeClass = "text-text-1 hover:text-text-1";
  const activeIconClass = "text-primary-6";
  const inactiveClass = "text-text-2 font-normal hover:text-text-1";
  const inactiveIconClass = "text-text-3";

  type NavItem = { href: string; label: string; icon: typeof FolderOpen; match: "exact" | "prefix" };
  type NavGroup = NavItem[];

  const navGroups: NavGroup[] = [
    [
      { href: "/", label: "Ongoing Projects", icon: FolderOpen, match: "exact" },
      { href: "/compare-models", label: "Compare Models", icon: Layers, match: "exact" },
      { href: "/teams", label: "Team Management", icon: Users, match: "prefix" },
    ],
    [
      { href: "/tender-ai", label: "Tender AI", icon: MessageSquare, match: "exact" },
    ],
    [
      { href: "/resources", label: "Resources & Learning", icon: BookOpen, match: "prefix" },
    ],
  ];

  const isActive = (item: NavItem) =>
    item.match === "prefix" ? pathname.startsWith(item.href) : pathname === item.href;

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
      className="h-[48px] w-full gap-2 bg-primary-6 hover:bg-primary-7 text-[16px] font-normal"
      title="New Project"
    >
      <Link href="/projects/create">
        <Plus className="h-4 w-4 shrink-0" />
        <span>New Project</span>
      </Link>
    </Button>
  );

  return (
    <div className="relative flex h-full flex-col py-[30px] px-[24px]">
      {/* Toggle button – centered on the border between sidebar and content */}
      {showToggle && (
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-[50px] -right-3 -translate-y-1/2 z-30 flex h-6 w-6 items-center justify-center rounded-lg border border-border-2 bg-white text-text-3 cursor-pointer transition-colors hover:bg-bg-1 hover:text-text-2"
        >
          {collapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronsLeft className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {/* Logo Area */}
      <div className="relative flex items-center py-[9px]">
        <div className={`flex w-full items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <Link
            href="/"
            className="relative flex cursor-pointer items-center group"
          >
            <Image
              src="/main-logo.png"
              alt="WorkenAI"
              width={30}
              height={14}
              className={`shrink-0 transition-opacity duration-300 ${collapsed ? "opacity-100" : "opacity-0 absolute"}`}
            />
            <Image
              src="/full-logo.png"
              alt="WorkenAI"
              width={140}
              height={32}
              className={`shrink-0 transition-opacity duration-300 ${collapsed ? "opacity-0 absolute" : "opacity-100"}`}
            />
          </Link>
        </div>
      </div>

      {/* Primary Actions */}
      <div className="flex justify-center pt-9 pb-6">
        {user?.canCreateProject ? (
          newProjectButton
        ) : (
          <DisabledReasonTooltip
            disabled
            reason="Not available for basic users"
            className={collapsed ? undefined : "block w-full"}
          >
            {collapsed ? (
              <Button
                className="h-[48px] w-[40px] bg-primary-6 p-0 text-white opacity-50 cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 shrink-0" />
              </Button>
            ) : (
              <Button
                className="h-[48px] w-full gap-2 bg-primary-6 hover:bg-primary-7 opacity-50 cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span>New Project</span>
              </Button>
            )}
          </DisabledReasonTooltip>
        )}
      </div>

      {/* Navigation Links */}
      <div className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className={`flex flex-col ${collapsed ? "items-center" : "items-center"} gap-1`}>
          {navGroups.map((group, gi) => (
            <div key={gi} className="contents">
              {gi > 0 && (
                <div className={`my-4 border-t border-border-2 ${collapsed ? "w-[40px]" : "w-full"}`} />
              )}
              {group.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                return collapsed ? (
                  <Button
                    key={item.href}
                    asChild
                    variant="ghost"
                    className={`h-[40px] w-[40px] p-0 justify-center ${active ? activeIconClass : inactiveIconClass}`}
                    title={item.label}
                  >
                    <Link href={item.href}>
                      <Icon className="size-5 shrink-0" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    key={item.href}
                    asChild
                    variant="ghost"
                    size="nav"
                    className={`w-full justify-start gap-3 ${active ? activeClass : inactiveClass}`}
                    title={item.label}
                  >
                    <Link href={item.href}>
                      <Icon className={`size-5 shrink-0 ${active ? activeIconClass : inactiveIconClass}`} />
                      <span>{item.label}</span>
                    </Link>
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* User Profile */}
      <div className={`mt-auto ${collapsed ? "flex flex-col items-center gap-3" : "flex flex-col items-center gap-3"}`}>
        {/* Dark mode toggle */}
        {collapsed ? (
          <DisabledReasonTooltip disabled reason="Coming Soon">
            <Button
              variant="ghost"
              className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled
            >
              <Moon className="h-5 w-5 text-text-3" />
            </Button>
          </DisabledReasonTooltip>
        ) : (
          <DisabledReasonTooltip
            disabled
            reason="Coming Soon"
            className="w-full"
          >
            <Button
              variant="ghost"
              size="nav"
              className="w-full justify-start gap-3 font-normal text-text-2 hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled
            >
              <Moon className="size-5 shrink-0 text-text-3" />
              <span>Light / Dark</span>
            </Button>
          </DisabledReasonTooltip>
        )}
        <div
          className={`group flex items-center rounded-lg ${collapsed ? "justify-center" : "w-full gap-3"}`}
        >
          <Link
            href="/account"
            title="My account"
            className={`flex items-center gap-3 overflow-hidden rounded-md transition-colors hover:bg-white ${collapsed ? "p-0" : "flex-1 p-1"}`}
          >
            <Avatar
              className={`shrink-0 ${collapsed ? "h-8 w-8 border border-black-400" : "h-9 w-9 border border-black-400"}`}
            >
              <AvatarImage
                src={user?.picture || "/default-avatar.png"}
                alt={user?.name ?? ""}
              />
              <AvatarFallback
                className={
                  collapsed
                    ? "text-xs font-medium text-text-1"
                    : "bg-primary-1 text-xs font-medium text-primary-6"
                }
              >
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-text-1">
                    {user?.name ?? "Loading..."}
                  </p>
                  {user &&
                    (user.canCreateProject ? (
                      <Badge className="shrink-0 border-transparent bg-primary-1 text-primary-7 uppercase tracking-wide text-[10px] px-1.5 py-0">
                        Advanced
                      </Badge>
                    ) : (
                      <Badge className="shrink-0 border-transparent bg-bg-3 text-text-2 uppercase tracking-wide text-[10px] px-1.5 py-0">
                        Basic
                      </Badge>
                    ))}
                </div>
                <p className="truncate text-xs text-text-3">
                  {user?.email ?? ""}
                </p>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button
              onClick={() => logout()}
              className="cursor-pointer rounded-md p-1.5 text-text-3 transition-colors hover:bg-white hover:text-text-2"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
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
