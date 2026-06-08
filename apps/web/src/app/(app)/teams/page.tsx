"use client";

import { Plus, Users, Loader2, Bot } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@/components/ui/page-tabs";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import { AddModelDialog } from "@/components/add-model-dialog";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/components/providers";
import {
  fetchTeams,
  fetchOrgUsers,
  fetchModels,
  fetchOrgSettings,
} from "@/lib/api";
import { SearchInput } from "@/components/ui/search-input";
import { TeamRow } from "@/components/management/team-row";
import { TeamCard } from "@/components/management/team-card";
import { UserRow } from "@/components/management/user-row";
import { UserCard } from "@/components/management/user-card";
import { ModelRow } from "@/components/management/model-row";
import { ModelCard } from "@/components/management/model-card";
import { AccountTab } from "@/components/management/account-tab";
import { CompanyTab } from "@/components/management/company-tab";
import { PersonalProfileNotice } from "@/components/personal-profile-notice";
import { IntegrationTab } from "@/components/management/integration-tab";
import { BillingTab } from "@/components/management/billing-tab";
import { ApiTab } from "@/components/management/api-tab";
import { useLanguage } from "@/lib/i18n";

export default function TeamsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const VALID_TABS = ["teams", "users", "models", "my-account", "company", "api", "billing", "integration"] as const;
  // Tabs always render for everyone — basic users keep visibility
  // into management surfaces but the action buttons inside each tab
  // are individually disabled by their components (Add New Model,
  // Generate API Link, integration add/remove, etc.).
  const isAdmin = user?.role === "admin";
  // A personal profile is a sole account with no company tenant — no
  // teams, no other users to invite. Team/Users tabs swap to a notice
  // and their create/invite CTAs are disabled (the BE profileType-gates
  // these too). Nothing is removed; the user can switch profile type
  // from My Account.
  const isPersonal = user?.profileType !== "company";
  const rawTab = searchParams.get("tab");
  const activeTab = VALID_TABS.includes(rawTab as (typeof VALID_TABS)[number])
    ? rawTab!
    : "teams";
  const setActiveTab = (tab: string) => {
    router.replace(`/teams?tab=${encodeURIComponent(tab)}`, { scroll: false });
  };
  const [teamSearch, setTeamSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  // When the "X users awaiting budget approval" banner is clicked, the
  // table narrows to just those rows so the admin can quickly action them.
  const [showPendingOnly, setShowPendingOnly] = useState(false);

  const {
    data: teams = [],
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });

  const {
    data: orgUsers = [],
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });

  const filteredTeams = teams.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase()),
  );

  const filteredUsers = orgUsers
    .filter((u) =>
      showPendingOnly ? u.pendingBudgetApproval : true,
    )
    .filter(
      (u) =>
        u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
        (u.name ?? "").toLowerCase().includes(userSearch.toLowerCase()),
    );

  const pendingApprovalCount = orgUsers.filter(
    (u) => u.pendingBudgetApproval,
  ).length;

  // Share the org-settings query with CompanyTab via React Query's
  // cache (same query key) so we don't fetch it twice. We only need
  // the result to decide whether the Company tab trigger should show
  // its "needs attention" red dot — when an admin has never set a
  // company-wide cap. Non-admins see no prompt because they can't
  // act on it, matching the users-tab pendingBudgetApproval gating.
  // Personal-profile admins are gated out too: the Company tab renders
  // a "this is a personal profile" empty state (no budget editor), so
  // a budget-not-set dot would point at an action that doesn't exist
  // there — same `profileType === "company"` gate CompanyTab uses.
  // staleTime: the default QueryClient has none, so without this
  // CompanyTab would refetch on mount despite the shared cache key —
  // 60s matches the cadence other admin-settings queries use here.
  const isCompanyAdmin =
    user?.role === "admin" && user?.profileType === "company";
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: fetchOrgSettings,
    enabled: isCompanyAdmin,
    staleTime: 60 * 1000,
  });
  const companyBudgetUnset =
    isCompanyAdmin && orgSettings?.monthlyBudgetCents === null;

  const {
    data: models = [],
    isLoading: modelsLoading,
    error: modelsError,
  } = useQuery({
    queryKey: ["models"],
    queryFn: fetchModels,
  });

  const filteredModels = models.filter(
    (m) =>
      m.customName.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.modelIdentifier.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <PageTabs value={activeTab} onValueChange={setActiveTab}>
      <PageTabsList>
        <PageTabsTrigger value="teams">{t("teams.title")}</PageTabsTrigger>
        <PageTabsTrigger value="users">{t("teams.users")}</PageTabsTrigger>
        <PageTabsTrigger value="models">{t("teams.models")}</PageTabsTrigger>
        <PageTabsTrigger value="my-account">{t("teams.myAccount")}</PageTabsTrigger>
        <PageTabsTrigger value="company">
          {t("teams.company")}
          {/* Red dot mirrors the per-row kebab indicator on
              /teams?tab=users — same "budget not set" signal,
              scoped to the org level so admins notice it even
              from another tab. */}
          {companyBudgetUnset ? (
            <>
              {/* sr-only sibling carries the meaning into the tab's
                  accessible name; the dot itself is decoration so it
                  gets aria-hidden to avoid double-announcing. */}
              <span className="sr-only"> ({t("teams.companyBudgetNotSet")})</span>
              <span
                aria-hidden="true"
                className="ml-1.5 inline-block h-2 w-2 rounded-full bg-danger-6 align-middle"
              />
            </>
          ) : null}
        </PageTabsTrigger>
        <PageTabsTrigger value="api">{t("teams.api")}</PageTabsTrigger>
        <PageTabsTrigger value="billing">{t("teams.billing")}</PageTabsTrigger>
        <PageTabsTrigger value="integration">{t("teams.integration")}</PageTabsTrigger>
      </PageTabsList>

      {/* ── Teams ────────────────────────────────────────────────────────────── */}
      <PageTabsContent value="teams">
        {/* Filter bar per Figma 4719:31181. Mobile: row 1 = Teams +
            Create Team, row 2 = full-width search. Desktop: original
            single-row layout. */}
        <div className="flex flex-col gap-2.5 py-3 lg:flex-row lg:items-center lg:gap-6 lg:py-4">
          <div className="flex items-center justify-between gap-3 lg:contents">
            <span className="text-[16px] font-semibold text-black-900 whitespace-nowrap lg:text-[18px] lg:font-bold">
              {t("teams.title")}
            </span>
            <DisabledReasonTooltip
              disabled={!user?.canCreateProject || isPersonal}
              reason={
                isPersonal
                  ? t("teams.personalNoCreate")
                  : t("sidebar.noCreateTooltip")
              }
              className="lg:order-last lg:w-auto"
            >
              <CreateTeamDialog>
                <Button
                  variant="plusAction"
                  className="disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!user?.canCreateProject || isPersonal}
                >
                  <Plus className="h-4 w-4 text-white" />
                  {t("teams.createTeam")}
                </Button>
              </CreateTeamDialog>
            </DisabledReasonTooltip>
          </div>
          {!isPersonal && (
            <SearchInput
              className="flex-1"
              placeholder={t("teams.searchTeams")}
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
            />
          )}
        </div>

        {isPersonal ? (
          <PersonalProfileNotice message={t("mgmt.teams.personalOnly")} />
        ) : (
        <>
        {/* Mobile card list (<lg) — 7-col table doesn't survive on a
            375px viewport. Figma 4720:31166 spec: each team is a
            white card with name + kebab, description, divider, then
            stacked rows for Monthly Budget / Spent / progress /
            Projected / Members. */}
        <div className="lg:hidden flex flex-col gap-2.5">
          {teamsLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-3" />
            </div>
          )}
          {teamsError && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-10 text-center text-sm text-danger-6">
              {t("teams.failedToLoad")}
            </div>
          )}
          {!teamsLoading && !teamsError && filteredTeams.length === 0 && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-12 text-center">
              <Users className="mx-auto h-10 w-10 text-text-3" />
              <p className="mt-3 text-sm text-text-2">
                {teamSearch
                  ? t("teams.noMatch")
                  : user?.canCreateProject
                    ? t("teams.noTeams")
                    : t("teams.notMember")}
              </p>
            </div>
          )}
          {filteredTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              isOwner={user?.id === team.ownerId}
            />
          ))}
        </div>

        <div className="hidden lg:block overflow-x-auto bg-bg-white rounded-lg">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.title")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.description")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.monthlyBudget")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.spentRemaining")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.projected")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.members")}
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {teamsLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" />
                  </td>
                </tr>
              )}
              {teamsError && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center align-middle text-sm text-danger-6"
                  >
                    {t("teams.failedToLoad")}
                  </td>
                </tr>
              )}
              {filteredTeams.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  isOwner={user?.id === team.ownerId}
                />
              ))}
              {!teamsLoading && !teamsError && filteredTeams.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-text-3" />
                    <p className="mt-3 text-sm text-text-2">
                      {teamSearch
                        ? t("teams.noMatch")
                        : user?.canCreateProject
                          ? t("teams.noTeams")
                          : t("teams.notMember")}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </PageTabsContent>

      {/* ── Users ────────────────────────────────────────────────────────────── */}
      <PageTabsContent value="users">
        {/* Mirror the Teams filter section: mobile stacks "Users +
            Invite" on row 1 and search on row 2; desktop keeps the
            single-row layout via `lg:contents`. */}
        <div className="flex flex-col gap-2.5 py-3 lg:flex-row lg:items-center lg:gap-6 lg:py-5">
          <div className="flex items-center justify-between gap-3 lg:contents">
            <span className="text-[16px] font-semibold text-black-900 whitespace-nowrap lg:text-[18px] lg:font-bold">
              {t("teams.users")}
            </span>
            <DisabledReasonTooltip
              disabled={!user?.canCreateProject || isPersonal}
              reason={
                isPersonal
                  ? t("teams.personalNoInvite")
                  : t("sidebar.noCreateTooltip")
              }
              className="lg:order-last lg:w-auto"
            >
              <InviteUserDialog>
                <Button
                  variant="plusAction"
                  className="disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!user?.canCreateProject || isPersonal}
                >
                  <Plus className="h-4 w-4 text-white" />
                  {t("teams.inviteUser")}
                </Button>
              </InviteUserDialog>
            </DisabledReasonTooltip>
          </div>
          {!isPersonal && (
            <SearchInput
              className="flex-1"
              placeholder={t("teams.searchUsers")}
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
            />
          )}
        </div>
        {/* Pending-budget-approval banner. Surfaces users who finished
            Managed-Cloud onboarding but still have monthlyBudgetCents = 0
            — they can't make AI calls until an admin sets a budget. The
            banner is clickable: it filters the table to just those rows
            so the action is one click away. Admin-only because only
            admins can mutate budgets — basic / advanced users seeing
            this would have no way to act on it. Company-only: budget
            approval is a managed-cloud / tenant concept, so a personal
            admin (sole member, no org-users) never has anything to
            action here — same isCompanyAdmin gate as the budget dot. */}
        {isCompanyAdmin && pendingApprovalCount > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warning-7/30 bg-warning-1 px-4 py-3">
            <p className="text-[13px] text-text-1">
              <strong className="font-semibold">
                {pendingApprovalCount}{" "}
                {pendingApprovalCount === 1 ? t("teams.userIs") : t("teams.usersAre")}
              </strong>{" "}
              {t("teams.awaitingApproval")} — {t("teams.setPlan")}{" "}
              {pendingApprovalCount === 1 ? "them" : "each"} to {t("teams.enableAccess")}
            </p>
            <button
              type="button"
              onClick={() => setShowPendingOnly((v) => !v)}
              className="shrink-0 rounded-md px-3 py-1 text-[12px] font-medium text-warning-7 transition-colors hover:bg-warning-7/10"
            >
              {showPendingOnly ? t("teams.showAllUsers") : t("teams.showPendingOnly")}
            </button>
          </div>
        )}

        {isPersonal ? (
          <PersonalProfileNotice message={t("mgmt.users.personalOnly")} />
        ) : (
        <>
        {/* Mobile card list (<lg) — 9-col table doesn't fit on a
            375px viewport. Each user becomes a stacked card per
            UserCard. */}
        <div className="lg:hidden flex flex-col gap-2.5">
          {usersLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-3" />
            </div>
          )}
          {usersError && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-10 text-center text-sm text-danger-6">
              {t("teams.failedToLoadUsers")}
            </div>
          )}
          {!usersLoading && !usersError && filteredUsers.length === 0 && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-12 text-center">
              <Users className="mx-auto h-10 w-10 text-text-3" />
              <p className="mt-3 text-sm text-text-2">
                {userSearch
                  ? t("teams.noMatchUsers")
                  : t("teams.noUsers")}
              </p>
            </div>
          )}
          {filteredUsers.map((u) => (
            <UserCard key={u.id} user={u} />
          ))}
        </div>

        <div className="hidden lg:block overflow-x-auto bg-bg-white rounded-lg">
          <table className="w-full min-w-[850px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.name")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.email")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.role")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.status")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.title")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.personalMonthlyBudget")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.spentRemainingShort")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.projected")}
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" />
                  </td>
                </tr>
              )}
              {usersError && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center align-middle text-sm text-danger-6"
                  >
                    {t("teams.failedToLoadUsers")}
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
              {!usersLoading && !usersError && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-text-3" />
                    <p className="mt-3 text-sm text-text-2">
                      {userSearch
                        ? t("teams.noMatchUsers")
                        : t("teams.noUsers")}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
        )}
      </PageTabsContent>

      {/* ── Models ───────────────────────────────────────────────────────────── */}
      <PageTabsContent value="models">
        {/* Same filter pattern as Teams + Users: title and primary CTA
            share the top row on mobile, search fills the second row.
            Desktop collapses back to a single row via lg:contents. */}
        <div className="flex flex-col gap-2.5 py-3 lg:flex-row lg:items-center lg:gap-6 lg:py-5">
          <div className="flex items-center justify-between gap-3 lg:contents">
            <span className="text-[16px] font-semibold text-black-900 whitespace-nowrap lg:text-[18px] lg:font-bold">
              {t("teams.models")}
            </span>
            {isAdmin ? (
              <AddModelDialog>
                <Button variant="plusAction" className="lg:order-last">
                  <Plus className="h-4 w-4 text-white" />
                  {t("teams.addNewModel")}
                </Button>
              </AddModelDialog>
            ) : (
              <DisabledReasonTooltip
                disabled
                reason={t("teams.onlyAdminsModels")}
                className="lg:order-last"
              >
                <Button
                  variant="plusAction"
                  className="disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled
                >
                  <Plus className="h-4 w-4 text-white" />
                  {t("teams.addNewModel")}
                </Button>
              </DisabledReasonTooltip>
            )}
          </div>
          <SearchInput
            className="flex-1"
            placeholder={t("teams.searchModels")}
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
          />
        </div>

        {/* Mobile card list (<lg) — the 5-col table doesn't survive
            once a model identifier + BYOK badge + fallback chips stack
            up at 375px wide. */}
        <div className="lg:hidden flex flex-col gap-2.5">
          {modelsLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-3" />
            </div>
          )}
          {modelsError && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-10 text-center text-sm text-danger-6">
              {t("teams.failedToLoadModels")}
            </div>
          )}
          {!modelsLoading && !modelsError && filteredModels.length === 0 && (
            <div className="rounded-xl border border-border-2 bg-bg-white py-12 text-center">
              <Bot className="mx-auto h-10 w-10 text-text-3" />
              <p className="mt-3 text-sm text-text-2">
                {modelSearch
                  ? t("teams.noMatchModels")
                  : t("teams.noModels")}
              </p>
            </div>
          )}
          {filteredModels.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>

        <div className="hidden lg:block overflow-x-auto bg-bg-white rounded-lg">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.customName")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.status")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("common.model")}
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  {t("teams.fallbackModels")}
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  {t("common.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {modelsLoading && (
                <tr>
                  <td colSpan={5} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" />
                  </td>
                </tr>
              )}
              {modelsError && (
                <tr>
                  <td
                    colSpan={5}
                    className="py-12 text-center align-middle text-sm text-danger-6"
                  >
                    {t("teams.failedToLoadModels")}
                  </td>
                </tr>
              )}
              {filteredModels.map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
              {!modelsLoading && !modelsError && filteredModels.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center align-middle">
                    <Bot className="mx-auto h-10 w-10 text-text-3" />
                    <p className="mt-3 text-sm text-text-2">
                      {modelSearch
                        ? t("teams.noMatchModels")
                        : t("teams.noModels")}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Other tabs ───────────────────────────────────────────────────────── */}
      <PageTabsContent value="my-account">
        <AccountTab />
      </PageTabsContent>
      <PageTabsContent value="company">
        <CompanyTab />
      </PageTabsContent>
      <PageTabsContent value="api">
        <ApiTab />
      </PageTabsContent>
      <PageTabsContent value="billing">
        <BillingTab />
      </PageTabsContent>
      <PageTabsContent value="integration">
        <IntegrationTab />
      </PageTabsContent>
    </PageTabs>
  );
}
