"use client";

import Link from "next/link";
import { PlusCircle, Users, ChevronRight, Loader2, Crown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { useAuth } from "@/components/providers";
import { fetchTeams, type Team } from "@/lib/api";

function TeamCard({ team }: { team: Team }) {
  const { user } = useAuth();
  const isOwner = user?.id === team.ownerId;

  return (
    <Link href={`/teams/${team.id}`} className="block">
      <Card className="group flex flex-col border-slate-200 transition-all duration-300 hover:border-blue-300 hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="mb-2 flex items-start justify-between">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600">
              <Users className="h-4 w-4" />
            </div>
            {isOwner && (
              <Badge variant="secondary" className="gap-1 text-xs border-amber-200 bg-amber-50 text-amber-700">
                <Crown className="h-3 w-3" />
                Owner
              </Badge>
            )}
          </div>
          <CardTitle className="text-sm font-semibold text-slate-900 transition-colors group-hover:text-blue-600">
            {team.name}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1" />
        <CardFooter className="border-t border-slate-100 pt-3">
          <div className="flex w-full items-center justify-between text-xs text-slate-400">
            <span>View team</span>
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </div>
        </CardFooter>
      </Card>
    </Link>
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
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Team Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Create and manage your teams.
          </p>
        </div>
        {user?.isPaid && (
          <CreateTeamDialog>
            <Button size="sm" className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Create Team
            </Button>
          </CreateTeamDialog>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <div className="col-span-full flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="col-span-full text-center py-12 text-sm text-red-500">
            Failed to load teams. Is the API running?
          </div>
        )}

        {teams?.map((team) => (
          <TeamCard key={team.id} team={team} />
        ))}

        {!isLoading && !error && teams?.length === 0 && (
          <div className="col-span-full text-center py-12">
            <Users className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              {user?.isPaid
                ? "No teams yet. Create your first team to get started."
                : "You are not a member of any team yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
