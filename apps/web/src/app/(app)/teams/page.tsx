"use client";

import { Plus, Users, Loader2, Bot } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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
import { useAuth } from "@/components/providers";
import { fetchTeams, fetchOrgUsers } from "@/lib/api";
import { SearchInput } from "@/components/ui/search-input";
import { MODELS } from "@/lib/models";
import { TeamRow } from "@/components/management/team-row";
import { UserRow } from "@/components/management/user-row";
import { ModelRow } from "@/components/management/model-row";
import { CompanyTab } from "@/components/management/company-tab";
import { IntegrationTab } from "@/components/management/integration-tab";
import { BillingTab } from "@/components/management/billing-tab";
import { ApiTab } from "@/components/management/api-tab";

export default function TeamsPage() {
  const { user } = useAuth();
  const [teamSearch, setTeamSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");

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

  const filteredUsers = orgUsers.filter(
    (u) =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(userSearch.toLowerCase()),
  );

  const filteredModels = MODELS.filter(
    (m) =>
      m.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <PageTabs defaultValue="teams">
      <PageTabsList>
        <PageTabsTrigger value="teams">Teams</PageTabsTrigger>
        <PageTabsTrigger value="users">Users</PageTabsTrigger>
        <PageTabsTrigger value="models">Models</PageTabsTrigger>
        <PageTabsTrigger value="my-account">My Account</PageTabsTrigger>
        <PageTabsTrigger value="company">Company</PageTabsTrigger>
        <PageTabsTrigger value="api">API</PageTabsTrigger>
        <PageTabsTrigger value="billing">Billing</PageTabsTrigger>
        <PageTabsTrigger value="integration">Integration</PageTabsTrigger>
      </PageTabsList>

      {/* ── Teams ────────────────────────────────────────────────────────────── */}
      <PageTabsContent value="teams">
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-6">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Teams
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={teamSearch}
            onChange={(e) => setTeamSearch(e.target.value)}
          />
          {user?.isPaid && (
            <CreateTeamDialog>
              <Button variant="plusAction" className="w-full sm:w-auto">
                <Plus className="h-4 w-4 text-black-900" />
                Create Team
              </Button>
            </CreateTeamDialog>
          )}
        </div>
        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Team
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Description
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Monthly Budget
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Spent / Remaining
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Projected
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Members
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {teamsLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}
              {teamsError && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center align-middle text-sm text-red-500"
                  >
                    Failed to load teams. Is the API running?
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
                    <Users className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      {teamSearch
                        ? "No teams match your search."
                        : user?.isPaid
                          ? "No teams yet. Create your first team to get started."
                          : "You are not a member of any team yet."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Users ────────────────────────────────────────────────────────────── */}
      <PageTabsContent value="users">
        <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:gap-6">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Users
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          {user?.isPaid && (
            <InviteUserDialog>
              <Button variant="plusAction" className="w-full sm:w-auto">
                <Plus className="h-4 w-4 text-black-900" />
                Invite User
              </Button>
            </InviteUserDialog>
          )}
        </div>
        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full min-w-[850px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Name
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Email
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Teams
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Personal Monthly Budget
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Spent/Remaining
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Projected
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}
              {usersError && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 text-center align-middle text-sm text-red-500"
                  >
                    Failed to load users. Is the API running?
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
              {!usersLoading && !usersError && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      {userSearch
                        ? "No users match your search."
                        : "No users yet. Invite someone to get started."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Models ───────────────────────────────────────────────────────────── */}
      <PageTabsContent value="models">
        <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:gap-6">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Models
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
          />
          <AddModelDialog>
            <Button variant="plusAction" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 text-black-900" />
              Add New Model
            </Button>
          </AddModelDialog>
        </div>
        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Custom Name
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Status
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Model
                </th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">
                  Fallback models
                </th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center align-middle">
                    <Bot className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      No models match your search.
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
        <div className="py-16 text-center text-sm text-slate-400">
          Coming soon.
        </div>
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