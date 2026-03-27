"use client";

import Link from "next/link";
import {
  Plus,
  Search,
  Users,
  Loader2,
  MoreVertical,
  Eye,
  Crown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { useAuth } from "@/components/providers";
import { fetchTeams, type Team } from "@/lib/api";

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

export default function TeamsPage() {
  const { user } = useAuth();
  const {
    data: teams,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });

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

      <PageTabsContent value="teams">
        {/* Toolbar row */}
        <div className="flex items-center gap-6 py-5">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Teams
          </span>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black-800" />
            <Input
              placeholder="Search"
              className="w-full h-14 pl-9 bg-transparent border-black-600 rounded text-[16px] font-normal text-black-800 placeholder:text-black-800"
            />
          </div>
          {user?.isPaid && (
            <CreateTeamDialog>
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Create Team
              </Button>
            </CreateTeamDialog>
          )}
        </div>

        {/* Table */}
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
              {isLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}

              {error && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle text-sm text-red-500">
                    Failed to load teams. Is the API running?
                  </td>
                </tr>
              )}

              {teams?.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  isOwner={user?.id === team.ownerId}
                />
              ))}

              {!isLoading && !error && teams?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      {user?.isPaid
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

      <PageTabsContent value="users">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="models">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
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