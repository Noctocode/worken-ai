"use client";

import Link from "next/link";
import {
  Plus,
  Users,
  Loader2,
  MoreVertical,
  Eye,
  Crown,
  UserX,
  Bot,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@/components/ui/page-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import { AddModelDialog } from "@/components/add-model-dialog";
import { useAuth } from "@/components/providers";
import { fetchTeams, fetchOrgUsers, removeOrgUser, type Team, type OrgUser } from "@/lib/api";
import { SearchInput } from "@/components/ui/search-input";
import { MODELS } from "@/lib/models";

// ─── Teams ────────────────────────────────────────────────────────────────────

function TeamRow({ team, isOwner }: { team: Team; isOwner: boolean }) {
  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {team.name}
          {isOwner && (
            <Badge
              variant="secondary"
              className="gap-1 text-[11px] border-amber-200 bg-amber-50 text-amber-700"
            >
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/teams/${team.id}`} className="gap-2">
                <Eye className="h-4 w-4" />
                View team
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  basic: "Basic",
  advanced: "Advanced",
  admin: "Admin",
};

function UserRow({ user }: { user: OrgUser }) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => removeOrgUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
    },
  });

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <span>{user.name ?? "—"}</span>
        </div>
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">
        {user.email}
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">
        {ROLE_LABELS[user.role] ?? user.role}
      </td>
      <td className="px-4 align-middle">
        <Badge
          variant="secondary"
          className={
            user.status === "accepted"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px]"
              : "border-slate-200 bg-slate-50 text-slate-500 text-[11px]"
          }
        >
          {user.status === "accepted" ? "Active" : "Pending"}
        </Badge>
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2 text-red-600 focus:text-red-600"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              <UserX className="h-4 w-4" />
              Remove user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Models ───────────────────────────────────────────────────────────────────

function ModelRow({ model }: { model: (typeof MODELS)[number] }) {
  const provider = model.id.split("/")[0] ?? "—";

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-400" />
          {model.label}
        </div>
      </td>
      <td className="px-4 align-middle font-mono text-sm text-slate-500">
        {model.id}
      </td>
      <td className="px-4 align-middle text-base font-normal text-black capitalize">
        {provider}
      </td>
      <td className="px-4 align-middle">
        <Badge
          variant="secondary"
          className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px]"
        >
          Active
        </Badge>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const { user } = useAuth();
  const [teamSearch, setTeamSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");

  const {
    data: teams,
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });

  const {
    data: orgUsers,
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });

  const filteredTeams = teams?.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase()),
  );

  const filteredUsers = orgUsers?.filter(
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

      {/* ── Teams tab ────────────────────────────────────────────────────────── */}
      <PageTabsContent value="teams">
        <div className="flex items-center gap-6 py-5">
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
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Create Team
              </Button>
            </CreateTeamDialog>
          )}
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Team</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Description</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Monthly Budget</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Spent / Remaining</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Projected</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Members</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
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
                  <td colSpan={7} className="py-12 text-center align-middle text-sm text-red-500">
                    Failed to load teams. Is the API running?
                  </td>
                </tr>
              )}
              {filteredTeams?.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  isOwner={user?.id === team.ownerId}
                />
              ))}
              {!teamsLoading && !teamsError && filteredTeams?.length === 0 && (
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

      {/* ── Users tab ────────────────────────────────────────────────────────── */}
      <PageTabsContent value="users">
        <div className="flex items-center gap-6 py-5">
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
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Invite User
              </Button>
            </InviteUserDialog>
          )}
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">User</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Email</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Role</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Status</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Joined</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}
              {usersError && (
                <tr>
                  <td colSpan={6} className="py-12 text-center align-middle text-sm text-red-500">
                    Failed to load users. Is the API running?
                  </td>
                </tr>
              )}
              {filteredUsers?.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
              {!usersLoading && !usersError && filteredUsers?.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center align-middle">
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

      {/* ── Models tab ───────────────────────────────────────────────────────── */}
      <PageTabsContent value="models">
        <div className="flex items-center gap-6 py-5">
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
            <Button variant="plusAction">
              <Plus className="h-4 w-4 text-black-900" />
              Add New Model
            </Button>
          </AddModelDialog>
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Model</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">ID</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Provider</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-12 text-center align-middle">
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

      {/* ── Remaining tabs ───────────────────────────────────────────────────── */}
      <PageTabsContent value="my-account">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="company">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="api">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="billing">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="integration">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
    </PageTabs>
  );
}