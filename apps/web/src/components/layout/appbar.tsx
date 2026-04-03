"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  Menu,
  ChevronRight,
  Search,
  Bell,
  ArrowLeft,
  Pencil,
  Trash2,
  Users,
  ChevronDown,
  Plus,
  X,
  CheckCircle,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";
import { getRouteConfig } from "@/lib/route-config";
import { fetchProject, fetchTeam } from "@/lib/api";
import { MODEL_LABELS } from "@/lib/models";

const AI_CHAT_TABS = [
  { value: "all", label: "All" },
  { value: "personal", label: "Personal" },
  { value: "team", label: "Team" },
] as const;

export const Appbar = () => {
  const breadcrumbs = useBreadcrumbs();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const config = getRouteConfig(pathname);

  // Project detail data — hooks always called, gated by `enabled`
  const isProjectDetail = config.appbarType === "projectDetail";
  const projectId = isProjectDetail ? (pathname.split("/").pop() ?? "") : "";
  const { data: _project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    enabled: isProjectDetail && !!projectId,
  });
  const { data: _projectTeam } = useQuery({
    queryKey: ["teams", _project?.teamId],
    queryFn: () => fetchTeam(_project!.teamId!),
    enabled: isProjectDetail && !!_project?.teamId,
  });

  /* ── Team detail appbar ──────────────────────────────────────────────── */
  if (config.appbarType === "teamDetail") {
    // Last breadcrumb holds the team name (or "Loading...")
    const teamName = breadcrumbs[breadcrumbs.length - 1]?.label ?? "";

    return (
      <header
        className={`sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-bg-1 px-6 ${config.bg}`}
      >
        <div className="flex items-center gap-2">
          {/* Mobile Menu Trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              <SidebarContent showToggle={false} />
            </SheetContent>
          </Sheet>

          <Link href="/teams">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-text-1">{teamName}</h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-success-7 hover:text-success-7/80"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-success-7 hover:text-success-7/80"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>
    );
  }

  /* ── User detail appbar ──────────────────────────────────────────────── */
  if (config.appbarType === "userDetail") {
    const userName = breadcrumbs[breadcrumbs.length - 1]?.label ?? "";

    return (
      <header
        className={`sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-bg-1 px-6 ${config.bg}`}
      >
        <div className="flex items-center gap-2">
          {/* Mobile Menu Trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              <SidebarContent showToggle={false} />
            </SheetContent>
          </Sheet>

          <Link href="/teams">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-text-1">{userName}</h4>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-success-7 hover:text-success-7/80"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-success-7 hover:text-success-7/80"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>
    );
  }

  /* ── AI Chat appbar (dashboard) ────────────────────────────────────────── */
  if (config.appbarType === "aiChat") {
    const activeTab = searchParams.get("filter") ?? "all";

    const setTab = (tab: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "all") {
        params.delete("filter");
      } else {
        params.set("filter", tab);
      }
      router.push(`/?${params.toString()}`);
    };

    return (
      <header
        className={`sticky top-0 z-20 flex items-center gap-[80px] px-6 py-6 ${config.bg}`}
      >
        {/* Mobile Menu */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SidebarContent showToggle={false} />
          </SheetContent>
        </Sheet>

        <h4 className="text-text-1 shrink-0">AI Chat</h4>

        <div className="flex items-start rounded-[4px] border border-border-2 overflow-hidden shrink-0">
          {AI_CHAT_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setTab(tab.value)}
              className={`px-[12px] py-[12px] text-[16px] cursor-pointer transition-colors ${
                activeTab === tab.value
                  ? "bg-bg-3 text-text-1"
                  : "bg-bg-white text-text-1 hover:bg-bg-1"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 items-center gap-[8px] rounded-[6px] border border-border-3 bg-bg-white px-[13px] py-[9px]">
          <Search className="h-5 w-5 shrink-0 text-text-3" />
          <input
            placeholder="Search"
            className="flex-1 bg-transparent text-[16px] leading-[24px] text-text-1 outline-none placeholder:text-text-3"
          />
        </div>
      </header>
    );
  }

  /* ── Project detail appbar ─────────────────────────────────────────────── */
  if (isProjectDetail) {
    const members = _projectTeam?.members ?? [];
    const visibleMembers = members.slice(0, 4);
    const extraCount = members.length > 4 ? members.length - 4 : 0;

    return (
      <header
        className={`sticky top-0 z-20 flex items-center justify-between py-6 px-6 ${config.bg}`}
      >
        <div className="flex items-center gap-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              <SidebarContent showToggle={false} />
            </SheetContent>
          </Sheet>

          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-black-700 hover:text-black-900">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          <h4 className="text-text-1">{_project?.name ?? "Loading..."}</h4>

          {_project?.teamId && (
            <div className="flex items-center gap-2 rounded-lg bg-bg-white px-2 py-1">
              <Users className="h-[18px] w-[18px] text-text-2" />
              <span className="text-[13px] text-text-2">team</span>
            </div>
          )}

          <button className="flex items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-6 py-4 cursor-pointer hover:bg-bg-1">
            <span className="text-[16px] text-text-1">
              {_project ? (MODEL_LABELS[_project.model] || _project.model) : "Model"}
            </span>
            <ChevronDown className="h-4 w-4 text-text-2" />
          </button>
        </div>

        <div className="flex items-center gap-6">
          <button className="cursor-pointer text-text-2 hover:text-text-1">
            <Search className="h-6 w-6" />
          </button>

          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="flex items-center gap-1 cursor-pointer">
                <div className="flex items-center">
                  {visibleMembers.map((m, i) =>
                    m.userPicture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={m.id}
                        src={m.userPicture}
                        alt={m.userName ?? ""}
                        className={`${i > 0 ? "ml-[-10px]" : ""} h-8 w-8 shrink-0 rounded-full object-cover`}
                      />
                    ) : (
                      <div
                        key={m.id}
                        className={`${i > 0 ? "ml-[-10px]" : ""} flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[12px] font-medium text-white`}
                      >
                        {(m.userName ?? m.email)?.[0]?.toUpperCase() ?? "?"}
                      </div>
                    ),
                  )}
                </div>
                {extraCount > 0 && (
                  <span className="ml-1 text-[11px] text-text-3">+{extraCount}</span>
                )}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                className="z-50 w-[320px] rounded-lg border border-border-2 bg-bg-white p-4 shadow-lg"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[14px] font-bold text-text-1">Team Members ({members.length})</span>
                  <Popover.Close asChild>
                    <button className="cursor-pointer text-text-3 hover:text-text-1">
                      <X className="h-4 w-4" />
                    </button>
                  </Popover.Close>
                </div>
                <div className="flex flex-col gap-3 max-h-[300px] overflow-auto">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3">
                      {m.userPicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.userPicture} alt={m.userName ?? ""} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[12px] font-medium text-white">
                          {(m.userName ?? m.email)?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-text-1 truncate">{m.userName ?? m.email}</p>
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-text-3 truncate">{m.email}</span>
                          {m.status === "accepted" ? (
                            <CheckCircle className="h-3 w-3 shrink-0 text-success-7" />
                          ) : (
                            <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-warning-2 text-warning-5">Pending</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] text-text-3 capitalize shrink-0">{m.role}</span>
                    </div>
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          {_project?.teamId && (
            <InviteMemberDialog teamId={_project.teamId}>
              <Button variant="plusAction" className="rounded-lg w-[174px]">
                <Plus className="h-4 w-4 text-text-white" />
                Invite Member
              </Button>
            </InviteMemberDialog>
          )}
        </div>
      </header>
    );
  }

  /* ── Create project appbar ────────────────────────────────────────────── */
  if (config.appbarType === "createProject") {
    return (
      <header
        className={`sticky top-0 z-20 flex h-[4.5rem] items-center border-b border-bg-1 px-6 ${config.bg}`}
      >
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              <SidebarContent showToggle={false} />
            </SheetContent>
          </Sheet>

          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-text-1">Create Project</h4>
        </div>
      </header>
    );
  }

  /* ── Default appbar ──────────────────────────────────────────────────── */
  return (
    <header className={`sticky top-0 z-20 flex h-[4.5rem] items-center justify-between px-6 ${config.bg}`}>
      <div className="flex items-center gap-4">
        {/* Mobile Menu Trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-500 hover:bg-slate-100 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72">
            <SidebarContent showToggle={false} />
          </SheetContent>
        </Sheet>

        {config.title ? (
          <h4 className="text-text-1">{config.title}</h4>
        ) : (
          <nav className="hidden items-center text-sm font-medium text-slate-500 sm:flex">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <span key={i} className="flex items-center">
                  {i > 0 && (
                    <ChevronRight className="mx-2 h-4 w-4 text-slate-400" />
                  )}
                  {isLast ? (
                    <Badge
                      variant="secondary"
                      className="rounded-md bg-slate-100 px-2 py-0.5 font-normal text-slate-900 hover:bg-slate-100"
                    >
                      {crumb.label}
                    </Badge>
                  ) : crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="cursor-pointer transition-colors hover:text-slate-800"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="cursor-default">{crumb.label}</span>
                  )}
                </span>
              );
            })}
          </nav>
        )}
      </div>

      {/* Right Header Controls */}
      {!config.hideSearch && (
        <div className="flex items-center gap-3">
          <div className="relative hidden group sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-500" />
            <Input
              type="text"
              placeholder="Search projects..."
              className="w-64 border-slate-200 bg-white pl-10 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500/10 focus-visible:ring-offset-0 focus-visible:border-blue-500"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <kbd className="hidden h-5 items-center rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-400 lg:inline-flex">
                ⌘K
              </kbd>
            </div>
          </div>

          {!config.hideNotifications && (
            <Button
              variant="ghost"
              size="icon"
              className="relative rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-white bg-red-500"></span>
            </Button>
          )}
        </div>
      )}
    </header>
  );
};