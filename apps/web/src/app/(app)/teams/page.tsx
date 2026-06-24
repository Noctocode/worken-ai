"use client";

import {
  Plus,
  Users,
  Loader2,
  Bot,
  Trash2,
  Power,
  PowerOff,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  deleteModel,
  updateModel,
} from "@/lib/api";
import { invalidateModelMutations } from "@/lib/hooks/use-user-models";
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
import { useIsPersonal } from "@/lib/hooks/use-is-personal";
import { IntegrationTab } from "@/components/management/integration-tab";
import { ToolsTab } from "@/components/management/tools-tab";
import { BillingTab } from "@/components/management/billing-tab";
import { ApiTab } from "@/components/management/api-tab";
import { GuardrailsTab } from "@/components/management/guardrails-tab";
import { DriveSection } from "@/components/drive-section";
import { SharePointSection } from "@/components/sharepoint-section";
import { OneDriveSection } from "@/components/onedrive-section";
import { ConfluenceSection } from "@/components/confluence-section";
import { useLanguage } from "@/lib/i18n";

export default function TeamsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const VALID_TABS = ["teams", "users", "models", "guardrails", "my-account", "company", "api", "billing", "integration"] as const;
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
  const isPersonal = useIsPersonal();
  const rawTab = searchParams.get("tab");
  // Personal profiles land on My Account by default — the Teams tab is
  // just a "no teams" notice for them, so it's a poor first screen.
  const defaultTab = isPersonal ? "my-account" : "teams";
  const activeTab = VALID_TABS.includes(rawTab as (typeof VALID_TABS)[number])
    ? rawTab!
    : defaultTab;
  const setActiveTab = (tab: string) => {
    router.replace(`/teams?tab=${encodeURIComponent(tab)}`, { scroll: false });
  };
  const [teamSearch, setTeamSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  // When the "X users awaiting budget approval" banner is clicked, the
  // table narrows to just those rows so the admin can quickly action them.
  const [showPendingOnly, setShowPendingOnly] = useState(false);

  // Personal profiles see a notice on the Teams/Users tabs, never the
  // tables — so skip the list fetches entirely for them.
  const {
    data: teams = [],
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    enabled: !isPersonal,
  });

  const {
    data: orgUsers = [],
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
    enabled: !isPersonal,
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

  // Once nothing is pending, drop the "show pending only" filter.
  // The banner that hosts the toggle hides when pendingApprovalCount
  // reaches 0, so after approving the last pending user the list would
  // otherwise be stuck on an empty filtered view (showing "no users")
  // with no way to clear it short of a reload. Adjusting state during
  // render (React's documented pattern) re-runs the body before commit,
  // so the full list shows immediately without an empty flash.
  if (showPendingOnly && pendingApprovalCount === 0) {
    setShowPendingOnly(false);
  }

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

  // ── Bulk select + delete for the Models table (admin-only) ──────────
  // Selection is keyed by model id and survives search-filter changes;
  // the header checkbox only acts on the currently-filtered rows so
  // toggling "select all" while a search is active never silently
  // selects hidden models.
  const queryClient = useQueryClient();
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const clearModelSelection = () => setSelectedModelIds(new Set());
  const toggleModelSelected = (modelId: string) =>
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });

  const allFilteredModelsSelected =
    filteredModels.length > 0 &&
    filteredModels.every((m) => selectedModelIds.has(m.id));
  const someFilteredModelsSelected =
    !allFilteredModelsSelected &&
    filteredModels.some((m) => selectedModelIds.has(m.id));
  const modelHeaderCheckboxState: boolean | "indeterminate" =
    allFilteredModelsSelected
      ? true
      : someFilteredModelsSelected
        ? "indeterminate"
        : false;
  const toggleSelectAllModels = (checked: boolean | "indeterminate") =>
    setSelectedModelIds((prev) => {
      const next = new Set(prev);
      if (checked === true) {
        for (const m of filteredModels) next.add(m.id);
      } else {
        for (const m of filteredModels) next.delete(m.id);
      }
      return next;
    });

  const bulkDeleteModelsMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        Array.from(selectedModelIds).map((modelId) => deleteModel(modelId)),
      );
      const fulfilled = results.filter(
        (r) => r.status === "fulfilled",
      ).length;
      const rejected = results.length - fulfilled;
      return { fulfilled, rejected };
    },
    onSuccess: ({ fulfilled, rejected }) => {
      invalidateModelMutations(queryClient);
      setBulkDeleteOpen(false);
      clearModelSelection();
      if (rejected === 0) {
        toast.success(
          t("teams.modelsDeletedToast").replace("{n}", String(fulfilled)),
        );
      } else if (fulfilled === 0) {
        toast.error(t("teams.modelsDeleteFailedAll"));
      } else {
        toast.warning(
          t("teams.modelsDeletePartial")
            .replace("{n}", String(fulfilled))
            .replace("{m}", String(rejected)),
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("teams.modelsDeleteFailedAll")),
  });

  // Bulk enable / disable — flips isActive on the selected models. Same
  // fan-out + aggregated-toast pattern as bulk delete; the `active`
  // flag picks the success/partial copy so one mutation serves both.
  const bulkSetActiveMutation = useMutation({
    mutationFn: async (active: boolean) => {
      const results = await Promise.allSettled(
        Array.from(selectedModelIds).map((modelId) =>
          updateModel(modelId, { isActive: active }),
        ),
      );
      const fulfilled = results.filter(
        (r) => r.status === "fulfilled",
      ).length;
      const rejected = results.length - fulfilled;
      return { active, fulfilled, rejected };
    },
    onSuccess: ({ active, fulfilled, rejected }) => {
      invalidateModelMutations(queryClient);
      clearModelSelection();
      const doneKey = active
        ? "teams.modelsEnabledToast"
        : "teams.modelsDisabledToast";
      const failKey = active
        ? "teams.modelsEnableFailedAll"
        : "teams.modelsDisableFailedAll";
      if (rejected === 0) {
        toast.success(t(doneKey).replace("{n}", String(fulfilled)));
      } else if (fulfilled === 0) {
        toast.error(t(failKey));
      } else {
        toast.warning(
          t("teams.modelsUpdatePartial")
            .replace("{n}", String(fulfilled))
            .replace("{m}", String(rejected)),
        );
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || t("teams.modelsUpdateFailed")),
  });

  const bulkModelsBusy =
    bulkDeleteModelsMutation.isPending || bulkSetActiveMutation.isPending;

  // Column count for the models table's loading / error / empty rows —
  // the select column only renders for admins.
  const modelColSpan = isAdmin ? 6 : 5;

  return (
    <PageTabs value={activeTab} onValueChange={setActiveTab}>
      <PageTabsList>
        <PageTabsTrigger value="teams">{t("teams.title")}</PageTabsTrigger>
        <PageTabsTrigger value="users">{t("teams.users")}</PageTabsTrigger>
        <PageTabsTrigger value="models">{t("teams.models")}</PageTabsTrigger>
        <PageTabsTrigger value="guardrails">{t("teams.guardrails")}</PageTabsTrigger>
        <PageTabsTrigger value="tools">{t("tools.tab")}</PageTabsTrigger>
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
        <div className="flex flex-col gap-2.5 py-3 lg:flex-row lg:items-center lg:gap-6 lg:py-5">
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
          {isPersonal ? (
            // Spacer fills the flex-1 slot the search normally occupies
            // so the Create Team button stays right-aligned on the lg
            // single-row layout.
            <div className="hidden lg:block lg:flex-1" aria-hidden />
          ) : (
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
          {isPersonal ? (
            // Spacer fills the flex-1 slot the search normally occupies
            // so the Invite User button stays right-aligned on the lg
            // single-row layout.
            <div className="hidden lg:block lg:flex-1" aria-hidden />
          ) : (
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

        {/* Bulk-action bar — appears once one or more models are
            selected (admin-only, since the checkboxes are admin-gated). */}
        {isAdmin && selectedModelIds.size > 0 && (
          <div className="mb-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-primary-2 bg-primary-1/40 px-4 py-3">
            <span className="text-[13px] font-semibold text-text-1">
              {selectedModelIds.size}{" "}
              {selectedModelIds.size !== 1
                ? t("teams.modelMany")
                : t("teams.modelOne")}{" "}
              {t("teams.modelsSelected")}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkSetActiveMutation.mutate(true)}
                disabled={bulkModelsBusy}
                className="cursor-pointer gap-1.5"
              >
                <Power className="h-3.5 w-3.5" />
                {t("teams.bulkEnableModels")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkSetActiveMutation.mutate(false)}
                disabled={bulkModelsBusy}
                className="cursor-pointer gap-1.5"
              >
                <PowerOff className="h-3.5 w-3.5" />
                {t("teams.bulkDisableModels")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkModelsBusy}
                className="cursor-pointer gap-1.5 border-danger-3 text-danger-6 hover:bg-danger-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("teams.bulkDeleteModels")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearModelSelection}
                disabled={bulkModelsBusy}
                className="cursor-pointer"
              >
                {t("teams.bulkCancel")}
              </Button>
            </div>
          </div>
        )}

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
            <ModelCard
              key={model.id}
              model={model}
              selectable={isAdmin}
              selected={selectedModelIds.has(model.id)}
              onToggleSelected={() => toggleModelSelected(model.id)}
            />
          ))}
        </div>

        <div className="hidden lg:block overflow-x-auto bg-bg-white rounded-lg">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                {isAdmin && (
                  <th className="px-4 align-middle w-10">
                    <Checkbox
                      aria-label={t("teams.selectAllModels")}
                      checked={modelHeaderCheckboxState}
                      onCheckedChange={toggleSelectAllModels}
                      disabled={filteredModels.length === 0}
                    />
                  </th>
                )}
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
                  <td
                    colSpan={modelColSpan}
                    className="py-12 text-center align-middle"
                  >
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" />
                  </td>
                </tr>
              )}
              {modelsError && (
                <tr>
                  <td
                    colSpan={modelColSpan}
                    className="py-12 text-center align-middle text-sm text-danger-6"
                  >
                    {t("teams.failedToLoadModels")}
                  </td>
                </tr>
              )}
              {filteredModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selectable={isAdmin}
                  selected={selectedModelIds.has(model.id)}
                  onToggleSelected={() => toggleModelSelected(model.id)}
                />
              ))}
              {!modelsLoading && !modelsError && filteredModels.length === 0 && (
                <tr>
                  <td
                    colSpan={modelColSpan}
                    className="py-12 text-center align-middle"
                  >
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

        {/* Subsection 2: provider API keys + Custom LLMs (moved here from the
            former Integrations tab). Everything model-related lives under one
            tab now; nothing is configured under Integrations anymore. */}
        <div className="mt-8 border-t border-border-2 pt-6">
          <h3 className="text-[16px] font-semibold text-black-900 lg:text-[18px] lg:font-bold">
            {t("teams.keysSection")}
          </h3>
          <p className="mt-1 text-[13px] text-text-3">
            {t("teams.keysSectionDesc")}
          </p>
          <IntegrationTab />
        </div>

        {/* Bulk delete confirmation — destructive and irreversible, so a
            full dialog (not an inline action) keeps the consequences hard
            to skip. Mirrors the per-row delete-model dialog. */}
        <Dialog
          open={bulkDeleteOpen}
          onOpenChange={(open) =>
            !bulkDeleteModelsMutation.isPending && setBulkDeleteOpen(open)
          }
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("teams.bulkDeleteTitle")}</DialogTitle>
              <DialogDescription>
                {t("teams.bulkDeleteDesc1")}{" "}
                <strong>
                  {selectedModelIds.size}{" "}
                  {selectedModelIds.size !== 1
                    ? t("teams.modelMany")
                    : t("teams.modelOne")}
                </strong>
                {t("teams.bulkDeleteDesc2")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkDeleteModelsMutation.isPending}
                className="cursor-pointer"
              >
                {t("teams.bulkCancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => bulkDeleteModelsMutation.mutate()}
                disabled={bulkDeleteModelsMutation.isPending}
                className="cursor-pointer"
              >
                {bulkDeleteModelsMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("teams.bulkDeleting")}
                  </>
                ) : (
                  t("teams.bulkDeleteConfirm")
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageTabsContent>

      <PageTabsContent value="guardrails">
        <GuardrailsTab />
      </PageTabsContent>

      <PageTabsContent value="tools">
        <ToolsTab />
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
        {/* Cloud Connections — connect cloud storage (Drive / OneDrive /
            SharePoint / Confluence) here. Importing + re-syncing documents
            from a connected source stays in Knowledge Core. Connection
            state is per-user. The sections in `mode="connection"` render
            only the connect / account / disconnect UI and own the OAuth
            callback toast (the backend redirects here after consent). */}
        <div className="py-5">
          <h3 className="text-[16px] font-semibold text-black-900 lg:text-[18px] lg:font-bold">
            {t("mgmt.integ.cloudConnections")}
          </h3>
          <p className="mt-1 text-[13px] text-text-3">
            {t("mgmt.integ.cloudConnectionsDesc")}
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <DriveSection mode="connection" />
            <SharePointSection mode="connection" />
            <OneDriveSection mode="connection" />
            <ConfluenceSection mode="connection" />
          </div>
        </div>
      </PageTabsContent>
    </PageTabs>
  );
}
