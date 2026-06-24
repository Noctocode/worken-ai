"use client";

import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FolderOpen,
  Layers,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  Wrench,
  Sun,
  User as UserIcon,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/providers";
import { MY_ACCOUNT_ROUTE } from "@/lib/routes";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { LanguageSelector } from "@/components/language-selector";
import { NotificationsPopover } from "@/components/notifications-popover";
import { useSidebar } from "@/hooks/use-sidebar";
import { useLanguage } from "@/lib/i18n";
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
  const { t } = useLanguage();
  const pathname = usePathname();
  const { collapsed: providerCollapsed, toggle } = useSidebar();
  const collapsed = forceCollapsed || providerCollapsed;

  // next-themes is client-only — guard against SSR/hydration mismatch by
  // rendering a stable fallback (Moon icon, "Light / Dark" label) until
  // mounted, then swap to the live theme.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const ThemeIcon = isDark ? Sun : Moon;
  const themeLabel = mounted
    ? isDark
      ? t("sidebar.switchToLight")
      : t("sidebar.switchToDark")
    : t("sidebar.toggleTheme");
  const themeButtonText = mounted
    ? isDark
      ? t("sidebar.lightMode")
      : t("sidebar.darkMode")
    : t("sidebar.toggleTheme");
  const toggleTheme = () => setTheme(isDark ? "light" : "dark");

  const activeClass = "text-text-1 hover:text-text-1";
  const activeIconClass = "text-primary-6";
  const inactiveClass = "text-text-2 font-normal hover:text-text-1";
  const inactiveIconClass = "text-text-3";

  type NavItem = { href: string; label: string; icon: typeof FolderOpen; match: "exact" | "prefix" };
  type NavGroup = NavItem[];

  const navGroups: NavGroup[] = [
    [
      { href: "/", label: t("sidebar.nav.ongoingProjects"), icon: FolderOpen, match: "exact" },
      { href: "/compare-models", label: t("sidebar.nav.modelArena"), icon: Layers, match: "exact" },
      { href: "/observability", label: t("sidebar.nav.observability"), icon: Activity, match: "exact" },
      {
        href: "/teams",
        // Personal profiles have no teams — the page is just their
        // account + models/api/billing settings, so label it generically.
        label:
          user?.profileType === "company"
            ? t("sidebar.nav.teamManagement")
            : t("sidebar.nav.management"),
        icon: Users,
        match: "prefix",
      },
    ],
    [
      { href: "/tender-ai", label: t("sidebar.nav.tenderAI"), icon: MessageSquare, match: "prefix" },
      { href: "/knowledge-core", label: t("sidebar.nav.knowledgeCore"), icon: Database, match: "prefix" },
    ],
    [
      { href: "/toolkit", label: t("sidebar.nav.toolkit"), icon: Wrench, match: "prefix" },
      { href: "/ai-cron", label: t("sidebar.nav.aiCron"), icon: CalendarClock, match: "prefix" },
      { href: "/learning", label: t("sidebar.nav.learning"), icon: BookOpen, match: "prefix" },
    ],
  ];

  // When a more specific item has its own exact entry for the current
  // path, the prefix parent yields so only the precise item lights up.
  const exactMatchExists = navGroups
    .flat()
    .some((i) => i.href === pathname);
  const isActive = (item: NavItem) => {
    if (item.match === "exact") return pathname === item.href;
    return (
      pathname.startsWith(item.href) &&
      !(exactMatchExists && item.href !== pathname)
    );
  };

  const newProjectButton = collapsed ? (
    <Button
      asChild
      className="h-[48px] w-[40px] bg-primary-6 p-0 hover:bg-primary-7 text-white"
      title={t("sidebar.newProject")}
    >
      <Link href="/projects/create">
        <Plus className="h-4 w-4 shrink-0" />
      </Link>
    </Button>
  ) : (
    <Button
      asChild
      className="h-[48px] w-full gap-2 bg-primary-6 hover:bg-primary-7 text-[16px] font-normal"
      title={t("sidebar.newProject")}
    >
      <Link href="/projects/create">
        <Plus className="h-4 w-4 shrink-0" />
        <span>{t("sidebar.newProject")}</span>
      </Link>
    </Button>
  );

  return (
    <div className="relative flex h-full flex-col py-[30px] px-[24px]">
      {/* Toggle button – centered on the border between sidebar and content */}
      {showToggle && (
        <button
          onClick={toggle}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
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
            {/* One full-logo Image at a time so the browser only fetches the
                wordmark variant the user actually sees. Pre-mount we don't
                know the theme, so render the light logo as a stable
                fallback (matches SSR output and gracefully shows on first
                paint for first-time dark visitors). */}
            <Image
              src={isDark ? "/full-logo-dark-mode.png" : "/full-logo.png"}
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
            reason={t("sidebar.noCreateTooltip")}
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
                <span>{t("sidebar.newProject")}</span>
              </Button>
            )}
          </DisabledReasonTooltip>
        )}
      </div>

      {/* Navigation Links */}
      <div className="scrollbar-on-hover min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col items-center gap-1">
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
        {/* Notifications + dark-mode share a tighter sub-cluster.
            Both are quick-action toggles, so visually they read as
            a pair — keeping them at `gap-1` distinguishes them from
            the heavier `gap-3` between the cluster and the user
            avatar row below. Wrapper is `w-full` in expanded mode so
            the buttons keep filling the sidebar width. */}
        <div
          className={`flex flex-col items-center gap-1 ${
            collapsed ? "" : "w-full"
          }`}
        >
          <LanguageSelector collapsed={collapsed} triggerFlag={false} />
          <NotificationsPopover>
          {({ unreadCount }) =>
            collapsed ? (
              <Button
                variant="ghost"
                aria-label={t("sidebar.notifications")}
                title={t("sidebar.notifications")}
                className="h-[40px] w-[40px] p-0 justify-center text-text-2 hover:text-text-1"
              >
                <span className="relative">
                  <Bell className="size-5 text-text-3" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-5 px-1 text-[10px] font-semibold leading-none text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="nav"
                aria-label={t("sidebar.notifications")}
                title={t("sidebar.notifications")}
                className="w-full cursor-pointer justify-start gap-3 font-normal text-text-2 hover:text-text-1"
              >
                <span className="relative">
                  <Bell className="size-5 shrink-0 text-text-3" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-5 px-1 text-[10px] font-semibold leading-none text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
                <span>{t("sidebar.notifications")}</span>
              </Button>
            )
          }
        </NotificationsPopover>
        {/* Dark mode toggle */}
        {collapsed ? (
          <Button
            variant="ghost"
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="h-[40px] w-[40px] cursor-pointer p-0 justify-center text-text-2 hover:text-text-1"
          >
            <ThemeIcon className="h-5 w-5 text-text-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="nav"
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="w-full cursor-pointer justify-start gap-3 font-normal text-text-2 hover:text-text-1"
          >
            <ThemeIcon className="size-5 shrink-0 text-text-3" />
            <span>{themeButtonText}</span>
          </Button>
        )}
        </div>
        <div
          className={`group flex items-center rounded-lg ${collapsed ? "justify-center" : "w-full gap-3"}`}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("sidebar.openUserMenu")}
                className={`flex items-center gap-3 overflow-hidden rounded-md transition-colors hover:bg-accent cursor-pointer ${collapsed ? "" : "flex-1"}`}
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
                  <div className="flex-1 overflow-hidden text-left">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-text-1">
                        {user?.name ?? "Loading..."}
                      </p>
                      {user && (
                        <Badge className={`shrink-0 border-transparent uppercase tracking-wide text-[10px] px-1.5 py-0 ${
                          user.role === "admin"
                            ? "bg-danger-1 text-danger-6"
                            : user.role === "advanced"
                              ? "bg-primary-1 text-primary-7"
                              : "bg-bg-3 text-text-2"
                        }`}>
                          {user.role === "admin"
                            ? t("mgmt.account.roleAdmin")
                            : user.role === "advanced"
                              ? t("mgmt.account.roleAdvanced")
                              : t("mgmt.account.roleBasic")}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-text-3">
                      {user?.email ?? ""}
                    </p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top" className="w-56">
              <DropdownMenuItem asChild>
                <Link href={MY_ACCOUNT_ROUTE} className="cursor-pointer">
                  <UserIcon className="mr-2 h-4 w-4" />
                  {t("sidebar.myAccount")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!collapsed && (
            <button
              onClick={() => logout()}
              className="cursor-pointer rounded-md p-1.5 text-text-3 transition-colors hover:bg-accent hover:text-text-2"
              title={t("sidebar.signOut")}
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
