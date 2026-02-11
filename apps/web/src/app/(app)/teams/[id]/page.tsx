"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Crown,
  Loader2,
  Mail,
  MoreHorizontal,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { useAuth } from "@/components/providers";
import {
  fetchTeam,
  updateMemberRole,
  removeTeamMember,
  type TeamMember,
} from "@/lib/api";

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MemberRow({
  member,
  teamId,
  isOwner,
  currentUserId,
}: {
  member: TeamMember;
  teamId: string;
  isOwner: boolean;
  currentUserId: string;
}) {
  const queryClient = useQueryClient();

  const roleMutation = useMutation({
    mutationFn: (newRole: "basic" | "advanced") =>
      updateMemberRole(teamId, member.id, newRole),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] }),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeTeamMember(teamId, member.id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["teams", teamId] }),
  });

  const isSelf = member.userId === currentUserId;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3">
        <Avatar className="h-8 w-8 border border-slate-100">
          {member.userPicture && (
            <AvatarImage src={member.userPicture} alt={member.userName ?? ""} />
          )}
          <AvatarFallback className="bg-slate-50 text-xs text-slate-600">
            {getInitials(member.userName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium text-slate-900">
            {member.userName || member.email}
            {isSelf && (
              <span className="ml-1.5 text-xs text-slate-400">(you)</span>
            )}
          </p>
          {member.userName && (
            <p className="text-xs text-slate-500">{member.email}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member.status === "pending" ? (
          <Badge variant="secondary" className="gap-1 text-xs border-yellow-200 bg-yellow-50 text-yellow-700">
            <Mail className="h-3 w-3" />
            Pending
          </Badge>
        ) : member.role === "advanced" ? (
          <Badge variant="secondary" className="gap-1 text-xs border-blue-200 bg-blue-50 text-blue-700">
            <ShieldCheck className="h-3 w-3" />
            Advanced
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 text-xs border-slate-200 bg-slate-50 text-slate-600">
            <Shield className="h-3 w-3" />
            Basic
          </Badge>
        )}

        {isOwner && !isSelf && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  roleMutation.mutate(
                    member.role === "advanced" ? "basic" : "advanced",
                  )
                }
              >
                {member.role === "advanced"
                  ? "Downgrade to Basic"
                  : "Upgrade to Advanced"}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-600"
                onSelect={() => removeMutation.mutate()}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const {
    data: team,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["teams", id],
    queryFn: () => fetchTeam(id),
  });

  const isOwner = user?.id === team?.ownerId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="text-center py-20 text-sm text-red-500">
        Failed to load team.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/teams">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {team.name}
          </h1>
          {isOwner && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <Crown className="h-3 w-3" /> You own this team
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Members</CardTitle>
          {isOwner && (
            <InviteMemberDialog teamId={team.id}>
              <Button size="sm" variant="outline" className="gap-2">
                <UserPlus className="h-4 w-4" />
                Invite
              </Button>
            </InviteMemberDialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {/* Owner first */}
            {team.members
              .sort((a, b) => {
                if (a.userId === team.ownerId) return -1;
                if (b.userId === team.ownerId) return 1;
                if (a.status === "accepted" && b.status !== "accepted") return -1;
                if (a.status !== "accepted" && b.status === "accepted") return 1;
                return 0;
              })
              .map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  teamId={team.id}
                  isOwner={isOwner}
                  currentUserId={user?.id ?? ""}
                />
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
