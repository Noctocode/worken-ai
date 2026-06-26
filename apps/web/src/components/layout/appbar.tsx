"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import {
  ChevronRight,
  Search,
  Bell,
  ArrowLeft,
  Calendar,
  Pencil,
  Trash2,
  Users,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Plus,
  Share2,
  X,
  CheckCircle,
  Globe,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { MobileTopbar } from "./mobile-topbar";
import { InviteMembersDialog } from "@/components/project-chat/invite-members-dialog";
import { useBreadcrumbs } from "@/hooks/use-breadcrumbs";
import { getRouteConfig } from "@/lib/route-config";
import {
  fetchProject,
  fetchTeam,
  fetchOrgSettings,
  updateProject,
} from "@/lib/api";
import { useAvailableModels } from "@/lib/hooks/use-available-models";
import { useUserModels } from "@/lib/hooks/use-user-models";
import { ModelCombobox } from "@/components/ui/model-combobox";
import { useAuth } from "@/components/providers";
import { isPersonalProfile } from "@/lib/hooks/use-is-personal";
import { useOnlineUsers } from "@/components/realtime-provider";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

const AI_CHAT_TABS = [
  { value: "all", labelKey: "appbar.tabAll" as TranslationKey },
  { value: "personal", labelKey: "appbar.tabPersonal" as TranslationKey },
  { value: "team", labelKey: "appbar.tabTeam" as TranslationKey },
] as const;

export const Appbar = () => {
  const { t } = useLanguage();
  const breadcrumbs = useBreadcrumbs();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const config = getRouteConfig(pathname);
  const queryClient = useQueryClient();
  const { getLabel: getModelLabel } = useAvailableModels();
  // The user's configured models (Team → Models) carry admin-set custom
  // names that the catalog doesn't know. Prefer those for header labels so a
  // Custom-model pool entry shows its alias name, falling back to the catalog
  // name (presets resolve a raw catalog slug) and then the raw id.
  const { effective: effectiveModels } = useUserModels();
  const labelForModel = (id: string): string => {
    const alias = effectiveModels.find((m) => m.id === id);
    return alias ? alias.name : getModelLabel(id);
  };

  // Model Arena back-arrow: the compare-models page dispatches its "viewing a
  // comparison" state so the appbar can show a back icon (left of the title)
  // that returns to the composer — mirrors the teamDetail back icon. Clicking
  // reuses the existing `compare-models:new` reset the page already handles.
  const [arenaViewing, setArenaViewing] = useState(false);
  useEffect(() => {
    const onViewing = (e: Event) =>
      setArenaViewing(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("compare-models:viewing", onViewing);
    return () =>
      window.removeEventListener("compare-models:viewing", onViewing);
  }, []);
  useEffect(() => {
    // Never let a stale "true" leak onto another route.
    if (pathname !== "/compare-models") setArenaViewing(false);
  }, [pathname]);

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
  // Org master switch — lets the web-search tooltip distinguish "off for the
  // organization" from "off for this team" when the toggle is disabled.
  const { data: _orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: fetchOrgSettings,
    enabled: isProjectDetail,
  });

  // Per-project web search toggle (header). Only rendered when the
  // org/team allows it; refetches the project so the chat path (which
  // reads project.webSearch server-side) and the toggle stay in sync.
  const webSearchMutation = useMutation({
    mutationFn: (next: boolean) =>
      updateProject(projectId, { webSearch: next }),
    onSuccess: (_data, next) => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success(next ? t("appbar.webSearchOn") : t("appbar.webSearchOff"));
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : t("appbar.webSearchFailed"),
      ),
  });

  // Change the project's model straight from the header — the user picks any
  // of their available models (same dynamic list as New Project), not a fixed
  // agent pool. Persists project.model (the chat path reads it), then refetches
  // so the label + chat pick it up.
  const switchModelMutation = useMutation({
    // Keep `agent` (the documented "active selection that maps to model") in
    // sync — a model id is itself a valid pool/active entry — so other
    // surfaces that read project.agent don't go stale.
    mutationFn: (model: string) =>
      updateProject(projectId, { agent: model, model }),
    onSuccess: (_data, model) => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success(
        `${t("projDetail.switchedTo1")} ${labelForModel(model)} ${t("projDetail.switchedTo2")}`,
      );
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("projDetail.failedChangeModel"),
      );
    },
  });

  // Team detail team fetch — reuse the page's query so there's only one HTTP
  // round-trip. Data drives the Edit/Delete gate in the team header.
  const isTeamDetail = config.appbarType === "teamDetail";
  const teamDetailId = isTeamDetail ? (pathname.split("/").pop() ?? "") : "";
  const { data: teamDetailData } = useQuery({
    queryKey: ["teams", teamDetailId],
    queryFn: () => fetchTeam(teamDetailId),
    enabled: isTeamDetail && !!teamDetailId,
  });
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const isPersonal = isPersonalProfile(currentUser, authLoading);
  const onlineUserIds = useOnlineUsers();
  const canManageCurrentTeam = (() => {
    if (!teamDetailData || !currentUser) return false;
    if (currentUser.id === teamDetailData.ownerId) return true;
    const me = teamDetailData.members.find(
      (m) =>
        m.userId &&
        m.userId === currentUser.id &&
        m.status === "accepted",
    );
    return (
      me?.role === "owner" ||
      me?.role === "admin" ||
      me?.role === "manager" ||
      me?.role === "editor"
    );
  })();

  /* ── Team detail appbar ──────────────────────────────────────────────── */
  if (config.appbarType === "teamDetail") {
    // Last breadcrumb holds the team name (or "Loading...")
    const teamName = breadcrumbs[breadcrumbs.length - 1]?.label ?? "";

    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center justify-between border-b border-bg-1 px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-2">
          <Link href="/teams">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-[26px] font-bold text-text-1">{teamName}</h4>
        </div>
        {/* Edit + Delete dispatch window events the team detail page
            listens for — same pattern as /users/[id]. Page handles
            the inline edit-mode flip and the delete confirmation
            dialog so the chrome controls drive page state without
            prop-drilling through the layout. */}
        <div className="flex items-center gap-1">
          <DisabledReasonTooltip
            disabled={!canManageCurrentTeam}
            reason={t("appbar.notAvailBasic")}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-success-7 hover:text-success-7/80 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canManageCurrentTeam}
              onClick={() =>
                window.dispatchEvent(new CustomEvent("team-detail:edit"))
              }
              title={canManageCurrentTeam ? t("appbar.editTeam") : undefined}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </DisabledReasonTooltip>
          <DisabledReasonTooltip
            disabled={!canManageCurrentTeam}
            reason={t("appbar.notAvailBasic")}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-success-7 hover:text-success-7/80 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canManageCurrentTeam}
              onClick={() =>
                window.dispatchEvent(new CustomEvent("team-detail:delete"))
              }
              title={canManageCurrentTeam ? t("appbar.deleteTeam") : undefined}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </DisabledReasonTooltip>
        </div>
        </header>
      </>
    );
  }

  /* ── User detail appbar ──────────────────────────────────────────────── */
  if (config.appbarType === "userDetail") {
    const userName = breadcrumbs[breadcrumbs.length - 1]?.label ?? "";
    // Two edit gates fold into one Pencil:
    //  - Admin can edit anyone (budget + role + delete).
    //  - A non-company user can self-edit their own budget. Anything
    //    other than profileType='company' (including NULL from edge-
    //    case accounts) self-manages — they land on /users/<own-id>
    //    and want the Pencil to enter edit mode without admin
    //    involvement. Trash (delete) stays admin-only.
    const userDetailId =
      pathname.match(/^\/users\/([^/]+)/)?.[1] ?? "";
    const isAdmin = currentUser?.role === "admin";
    const isSelfManaged =
      !!currentUser &&
      currentUser.id === userDetailId &&
      currentUser.profileType !== "company";
    const canEdit = isAdmin || isSelfManaged;
    const canDelete = isAdmin;

    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center justify-between border-b border-bg-1 px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-2">
          <Link href="/teams?tab=users">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-[26px] font-bold text-text-1">{userName}</h4>
        </div>
        {(canEdit || canDelete) && (
          <div className="flex items-center gap-1">
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-success-7 hover:text-success-7/80"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("user-detail:edit"))
                }
                title={t("appbar.editUser")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-success-7 hover:text-success-7/80"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("user-detail:delete"))
                }
                title={t("appbar.removeUser")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
        </header>
      </>
    );
  }

  /* ── AI Chat appbar (dashboard) ────────────────────────────────────────── */
  if (config.appbarType === "aiChat") {
    // Personal profiles only have the Personal view — All / Team are
    // disabled with a reason and the active tab is forced to Personal.
    // `isPersonal` is computed at the component top (shared helper).
    const activeTab = isPersonal
      ? "personal"
      : (searchParams.get("filter") ?? "all");

    const setTab = (tab: string) => {
      if (isPersonal && tab !== "personal") return;
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "all") {
        params.delete("filter");
      } else {
        params.set("filter", tab);
      }
      const qs = params.toString();
      router.push(qs ? `/?${qs}` : "/");
    };

    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 items-center gap-6 lg:gap-12 px-6 py-6 ${config.bg}`}
        >
        <h4 className="text-text-1 shrink-0">{t("appbar.aiChat")}</h4>

        <div className="flex items-start rounded-[4px] border border-border-2 overflow-hidden shrink-0">
          {AI_CHAT_TABS.map((tab) => {
            const disabled = isPersonal && tab.value !== "personal";
            return (
              <DisabledReasonTooltip
                key={tab.value}
                disabled={disabled}
                reason={t("common.personalViewsDisabled")}
              >
                <button
                  onClick={() => setTab(tab.value)}
                  disabled={disabled}
                  className={`px-[14px] py-[8px] text-[16px] font-normal transition-colors ${
                    disabled
                      ? "cursor-not-allowed bg-bg-white text-text-3 opacity-50"
                      : activeTab === tab.value
                        ? "bg-bg-3 text-text-1 cursor-pointer"
                        : "bg-bg-white text-text-1 hover:bg-bg-1 cursor-pointer"
                  }`}
                >
                  {t(tab.labelKey)}
                </button>
              </DisabledReasonTooltip>
            );
          })}
        </div>

        <div className="flex flex-1 items-center gap-[8px] rounded-[6px] border border-border-3 bg-bg-white px-[13px] py-[9px]">
          <Search className="h-5 w-5 shrink-0 text-text-3" />
          <input
            placeholder={t("appbar.search")}
            className="flex-1 bg-transparent text-[16px] leading-[24px] text-text-1 outline-none placeholder:text-text-3"
          />
        </div>
        </header>
      </>
    );
  }

  /* ── Project detail appbar ─────────────────────────────────────────────── */
  if (isProjectDetail) {
    const members = _projectTeam?.members ?? [];
    const visibleMembers = members.slice(0, 4);
    const extraCount = members.length > 4 ? members.length - 4 : 0;

    // Web search header toggle is ALWAYS shown on a project so the control
    // never just vanishes. It's interactive only when the org/team allows web
    // search AND the active model routes via OpenRouter; otherwise it stays
    // visible but disabled with a reason and reads as off. Disabling it at the
    // org/team level therefore greys the project toggle rather than hiding it.
    const webSearchAllowed = !!_project?.webSearchAllowed;
    const webSearchSupported = !!_project?.webSearchSupported;
    const webSearchInteractive = webSearchAllowed && webSearchSupported;
    const webSearchOn = !!_project?.webSearch && webSearchAllowed;
    // When disabled, point the user at the right place: if the org master
    // switch is ON, it's the team that turned web search off (enable in team
    // settings); otherwise it's the org default (enable in Management →
    // Company). Supported-but-not-allowed falls through to the model reason.
    const webSearchReason = !webSearchAllowed
      ? _orgSettings?.webSearchEnabled === true && !!_project?.teamId
        ? t("appbar.webSearchTeamDisabled")
        : t("appbar.webSearchOrgDisabled")
      : t("appbar.webSearchUnsupported");

    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 items-center justify-between py-6 px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-black-700 hover:text-black-900">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>

          <h4 className="text-[26px] font-bold text-text-1">{_project?.name ?? t("appbar.loading")}</h4>

          {_project?.teamId && (
            <div className="flex items-center gap-2 rounded-lg bg-bg-white px-2 py-1">
              <Users className="h-[18px] w-[18px] text-text-2" />
              <span className="text-[13px] text-text-2">{t("appbar.team")}</span>
            </div>
          )}

          {_project ? (
            // Change the project's model from any of the user's available
            // models (dynamic + searchable, like New Project).
            <ModelCombobox
              value={_project.model}
              onChange={(id) => switchModelMutation.mutate(id)}
              models={effectiveModels}
              contentClassName="min-w-[260px]"
              trigger={
                <button
                  type="button"
                  className="flex items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-6 py-4 cursor-pointer hover:bg-bg-1 disabled:opacity-60"
                  disabled={switchModelMutation.isPending}
                >
                  <span className="text-[16px] text-text-1">
                    {labelForModel(_project.model)}
                  </span>
                  <ChevronDown className="h-4 w-4 text-text-2" />
                </button>
              }
            />
          ) : (
            <div className="flex items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-6 py-4">
              <span className="text-[16px] text-text-1">
                {t("appbar.model")}
              </span>
            </div>
          )}

          {/* Per-project web search toggle. Always shown on a project so the
              control never vanishes. Interactive only when the org/team allows
              web search AND the active model can use it (native Anthropic BYOK
              bypasses the OpenRouter plugin); otherwise it stays visible but
              disabled with a reason and reads as off. */}
          {_project && (
            <DisabledReasonTooltip
              disabled={!webSearchInteractive}
              reason={webSearchReason}
            >
              <button
                type="button"
                onClick={() => webSearchMutation.mutate(!_project.webSearch)}
                disabled={webSearchMutation.isPending || !webSearchInteractive}
                role="switch"
                aria-checked={webSearchOn}
                title={t("appbar.webSearch")}
                className="flex items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-4 py-4 cursor-pointer hover:bg-bg-1 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Globe
                  className={`h-4 w-4 ${
                    webSearchOn ? "text-primary-6" : "text-text-2"
                  }`}
                />
                <span className="text-[15px] text-text-1">
                  {t("appbar.webSearch")}
                </span>
                <span
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    webSearchOn ? "bg-primary-6" : "bg-border-3"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                      webSearchOn ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </DisabledReasonTooltip>
          )}
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
                  <span className="text-[14px] font-bold text-text-1">{t("appbar.teamMembers")} ({members.length})</span>
                  <Popover.Close asChild>
                    <button className="cursor-pointer text-text-3 hover:text-text-1">
                      <X className="h-4 w-4" />
                    </button>
                  </Popover.Close>
                </div>
                <div className="flex flex-col gap-3 max-h-[300px] overflow-auto">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3">
                      <div className="relative shrink-0">
                      {m.userPicture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.userPicture} alt={m.userName ?? ""} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-6 text-[12px] font-medium text-white">
                          {(m.userName ?? m.email)?.[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      {m.userId && onlineUserIds.has(m.userId) && (
                        <span
                          title={t("appbar.online")}
                          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-white bg-success-7"
                        />
                      )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-text-1 truncate">{m.userName ?? m.email}</p>
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-text-3 truncate">{m.email}</span>
                          {m.status === "accepted" ? (
                            <CheckCircle className="h-3 w-3 shrink-0 text-success-7" />
                          ) : (
                            <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-warning-2 text-warning-5">{t("appbar.pending")}</span>
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

          {_project?.teamId && _project && (
            // Project-aware modal (Figma 179:16073): multi-email
            // invite + the existing-members roster with the team and
            // direct-invitee groups. The old single-email
            // InviteMemberDialog still ships for /teams + dashboard;
            // we only swap the trigger inside the projectDetail
            // header.
            <InviteMembersDialog project={_project}>
              <Button variant="plusAction" className="rounded-lg w-[174px]">
                <Plus className="h-4 w-4 text-text-white" />
                {t("appbar.inviteMember")}
              </Button>
            </InviteMembersDialog>
          )}
        </div>
        </header>
      </>
    );
  }

  /* ── Create project appbar ────────────────────────────────────────────── */
  if (config.appbarType === "createProject") {
    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center border-b border-bg-1 px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-black-700 hover:text-black-900"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h4 className="text-[26px] font-bold text-text-1">{t("appbar.createProject")}</h4>
        </div>
        </header>
      </>
    );
  }

  /* ── AI Cron new/edit form appbar ─────────────────────────────────────── */
  if (config.appbarType === "aiCronForm") {
    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center border-b border-bg-1 px-6 ${config.bg}`}
        >
          <div className="flex items-center gap-2">
            <Link href="/ai-cron">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-black-700 hover:text-black-900"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h4 className="text-[26px] font-bold text-text-1">
              {config.titleKey ? t(config.titleKey) : ""}
            </h4>
          </div>
        </header>
      </>
    );
  }

  /* ── Tender create appbar ─────────────────────────────────────────────── */
  if (config.appbarType === "tenderCreate") {
    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-3">
          <Link
            href="/tender-ai"
            className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-text-2 hover:text-primary-6"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("appbar.backToDashboard")}
          </Link>
        </div>
        </header>
      </>
    );
  }

  /* ── Tender detail appbar ─────────────────────────────────────────────── */
  if (config.appbarType === "tenderDetail") {
    return (
      <>
        <MobileTopbar />
        <header
          className={`hidden md:flex sticky top-0 z-20 py-6 items-center justify-between gap-4 px-6 ${config.bg}`}
        >
        <div className="flex items-center gap-3">
          <Link href="/tender-ai">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-text-1 hover:text-text-1"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Link
            href="/tender-ai"
            className="hidden text-[14px] text-text-2 hover:text-primary-6 sm:inline"
          >
            {t("appbar.dashboard")}
          </Link>
          <ChevronRight className="hidden h-3.5 w-3.5 text-text-3 sm:inline" />
          <span className="text-[14px] font-medium text-text-1">
            {t("appbar.tenderDetails")}
          </span>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <Button variant="outline" className="cursor-pointer gap-2 text-[13px]">
            <Download className="h-3.5 w-3.5" />
            {t("appbar.downloadPDF")}
          </Button>
          <Button variant="outline" className="cursor-pointer gap-2 text-[13px]">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {t("appbar.exportCSV")}
          </Button>
          <Button variant="outline" className="cursor-pointer gap-2 text-[13px]">
            <FolderPlus className="h-3.5 w-3.5" />
            {t("appbar.createTenderProject")}
          </Button>
          <Button className="cursor-pointer gap-2 bg-primary-6 text-[13px] hover:bg-primary-7">
            <Share2 className="h-3.5 w-3.5" />
            {t("appbar.shareWithTeam")}
          </Button>
        </div>
        </header>
      </>
    );
  }

  /* ── Default appbar ──────────────────────────────────────────────────── */
  return (
    <>
      <MobileTopbar />
      <header className={`hidden md:flex sticky top-0 z-20 py-6 items-center justify-between gap-4 px-6 ${config.bg}`}>
      <div className="flex items-center gap-2">
        {pathname === "/compare-models" && arenaViewing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-black-700 hover:text-black-900"
            aria-label={t("arena.backToComparison")}
            title={t("arena.backToComparison")}
            onClick={() =>
              window.dispatchEvent(new CustomEvent("compare-models:new"))
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        {config.titleKey ? (
          <h4 className="text-[26px] font-bold text-text-1">{t(config.titleKey)}</h4>
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
      <div className={`flex items-center gap-3 ${config.appbarExpandControls ? "flex-1" : ""}`}>
        {config.appbarType === "observability" && <ObservabilityAppbarSlot />}

        {config.appbarSearch && (
          // Fills the right-controls container; the left margin (34px)
          // stacks with the header's gap-4 (16px) for a consistent
          // ~50px breathing room between the title and the search,
          // independent of how wide the appbar gets.
          <div className="relative hidden flex-1 sm:block ml-[34px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              type="text"
              placeholder={t(config.appbarSearch.placeholderKey)}
              className="h-10 w-full border-[#C9CDD4] bg-white pl-9 placeholder:text-text-3"
              onChange={(e) =>
                window.dispatchEvent(
                  new CustomEvent(config.appbarSearch!.event, {
                    detail: e.target.value,
                  }),
                )
              }
            />
          </div>
        )}

        {config.appbarAction && (
          <Button
            onClick={() =>
              window.dispatchEvent(new CustomEvent(config.appbarAction!.event))
            }
            className={`shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7 ${config.appbarSearch ? "hidden sm:inline-flex" : ""} ${config.appbarActionLgOnly ? "hidden lg:inline-flex" : ""}`}
          >
            <Plus className="h-4 w-4" />
            {t(config.appbarAction.labelKey)}
          </Button>
        )}

        {!config.hideSearch && (
          <>
            <div className="relative hidden group sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-500" />
              <Input
                type="text"
                placeholder={t("appbar.searchProjects")}
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
          </>
        )}
      </div>
      </header>
    </>
  );
};

/* ─── Observability appbar slot ────────────────────────────────────────
   Two controls live here per Figma frame 116:3959 — the time range
   dropdown and the Export CSV button. The page (/observability) listens
   for the events emitted below to keep its state in sync. The default
   range "7d" matches the page's initial useState value, so they boot in
   sync without any extra plumbing. */

// Labels include the "Time Range: " prefix so we can lean on the stock
// SelectValue rendering — wrapping a custom <span> inside the trigger
// was eating the click target on first paint.
const OBSERVABILITY_RANGES = [
  { value: "24h", labelKey: "appbar.timeRange24h" as TranslationKey },
  { value: "7d", labelKey: "appbar.timeRange7d" as TranslationKey },
  { value: "30d", labelKey: "appbar.timeRange30d" as TranslationKey },
  { value: "90d", labelKey: "appbar.timeRange90d" as TranslationKey },
] as const;

function ObservabilityAppbarSlot() {
  const { t } = useLanguage();
  const [range, setRange] = useState<string>("7d");
  // Page → appbar signal: enables / disables Export CSV based on
  // whether the current filter set has any rows on the BE. Default
  // disabled until the page reports a non-empty result, so the button
  // can't be clicked before the first events fetch resolves.
  const [exportEnabled, setExportEnabled] = useState(false);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    const onEnabled = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setExportEnabled(Boolean(detail));
    };
    const onExporting = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setExporting(Boolean(detail));
    };
    window.addEventListener("observability:export-enabled", onEnabled);
    window.addEventListener("observability:export-busy", onExporting);
    return () => {
      window.removeEventListener("observability:export-enabled", onEnabled);
      window.removeEventListener("observability:export-busy", onExporting);
    };
  }, []);
  return (
    <>
      <Select
        value={range}
        onValueChange={(value) => {
          setRange(value);
          window.dispatchEvent(
            new CustomEvent("observability:range-change", { detail: value }),
          );
        }}
      >
        <SelectTrigger className="h-9 cursor-pointer gap-2 rounded-lg border-border-2 bg-bg-white px-3 text-sm text-text-1">
          <Calendar className="h-4 w-4 shrink-0" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          // Right-align under the trigger (sits at the appbar's right
          // edge) and use popper positioning so the menu drops cleanly
          // below instead of overlapping. Match the trigger's rounded-lg
          // + bg/border tokens so the open state looks like an extension
          // of the chip rather than a generic popover.
          position="popper"
          align="end"
          sideOffset={6}
          className="min-w-[var(--radix-select-trigger-width)] rounded-lg border-border-2 bg-bg-white p-1 shadow-md"
        >
          {OBSERVABILITY_RANGES.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="rounded-md px-3 py-2 text-sm text-text-1"
            >
              {t(opt.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        disabled={!exportEnabled || exporting}
        onClick={() =>
          window.dispatchEvent(new CustomEvent("observability:export"))
        }
        title={
          exporting
            ? t("appbar.preparingCSV")
            : exportEnabled
              ? t("appbar.exportTooltip")
              : t("appbar.noEventsMatch")
        }
        // Project Button defaults to h-12 (size=default in this fork), so
        // the Time Range Select at h-9 looked shorter. Pin h-9 + matching
        // px-3 / text-sm so the two controls read as a pair.
        className="h-9 shrink-0 cursor-pointer gap-2 rounded-lg border-border-2 bg-bg-white px-3 text-sm font-normal text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Download className="h-4 w-4" />
        {exporting ? t("appbar.exporting") : t("appbar.exportCSVButton")}
      </Button>
    </>
  );
}