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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SidebarContent } from "./sidebar";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";
import { getRouteConfig } from "@/lib/route-config";

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