"use client";

import Link from "next/link";
import { PlusCircle, Users, Loader2, MoreVertical, Eye, Crown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
            <Badge variant="secondary" className="gap-1 text-[11px] border-amber-200 bg-amber-50 text-amber-700">
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Create and manage your teams.
        </p>
        {user?.isPaid && (
          <CreateTeamDialog>
            <Button size="sm" className="gap-2 bg-primary-6 hover:bg-primary-7">
              <PlusCircle className="h-4 w-4" />
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
    </div>
  );
}