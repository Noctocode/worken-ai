"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Eye, Pencil, Crown, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTeam, type TeamListItem } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const exceeded = spent > budget;
  return (
    <div className="h-[7px] w-[44px] shrink-0 rounded-full bg-bg-3 outline outline-1 outline-border-4 overflow-hidden">
      <div
        className={`h-full rounded-full ${exceeded ? "bg-danger-5" : "bg-success-2"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ProjectedBadge({
  projected,
  budget,
}: {
  projected: number;
  budget: number;
}) {
  if (budget <= 0) return <span className="text-text-1 text-sm">—</span>;

  const overBudget = projected > budget;

  if (overBudget)
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-text-1">{formatCurrency(projected)}</span>
        <span className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3 whitespace-nowrap">
          Over Budget
        </span>
      </div>
    );
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm text-text-1">{formatCurrency(projected)}</span>
      <span className="rounded-sm bg-success-1 px-1.5 py-0.5 text-[11px] font-medium text-text-1 whitespace-nowrap">
        On track
      </span>
    </div>
  );
}

function MemberAvatars({
  members,
  extra,
}: {
  members: { picture: string | null; name: string | null }[];
  extra?: number;
}) {
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {members.slice(0, 4).map((m, i) =>
          m.picture && m.picture.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={m.picture}
              alt={m.name ?? ""}
              referrerPolicy="no-referrer"
              className="h-6 w-6 rounded-full border-2 border-bg-white object-cover"
            />
          ) : (
            <div
              key={i}
              className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-white bg-bg-3 text-[9px] font-semibold text-text-3"
            >
              {(m.name ?? "?").charAt(0)}
            </div>
          ),
        )}
      </div>
      {extra != null && extra > 0 && (
        <span className="ml-1.5 text-[12px] text-text-2">+{extra}</span>
      )}
    </div>
  );
}

export function TeamRow({
  team,
  isOwner,
}: {
  team: TeamListItem;
  isOwner: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const budget = team.monthlyBudgetCents / 100;
  const spent = team.spentCents / 100;
  const projected = team.projectedCents / 100;
  const remaining = budget - spent;
  const extraMembers =
    team.memberCount > 4 ? team.memberCount - 4 : 0;

  const deleteMutation = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: () => {
      toast.success(`Deleted "${team.name}".`);
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setConfirmOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't delete team.");
    },
  });

  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={`Open ${team.name}`}
      className="h-14 cursor-pointer border-b border-bg-1 transition-colors hover:bg-bg-1/50 focus:outline-none focus-visible:bg-bg-1/60 focus-visible:ring-1 focus-visible:ring-primary-6"
      onClick={() => router.push(`/teams/${team.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/teams/${team.id}`);
        }
      }}
    >
      {/* Team name */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {team.name}
          {isOwner && (
            <Badge
              variant="secondary"
              className="gap-1 text-[11px] border-warning-2 bg-warning-1 text-warning-6"
            >
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
      </td>
      {/* Description */}
      <td className="px-4 align-middle text-sm text-text-2 whitespace-nowrap">
        {team.description ?? "—"}
      </td>
      {/* Monthly Budget */}
      <td className="px-4 align-middle text-sm text-text-1 whitespace-nowrap">
        {budget > 0 ? formatCurrency(budget) : "—"}
      </td>
      {/* Spent / Remaining */}
      <td className="w-[1%] px-4 align-middle whitespace-nowrap">
        {budget > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-sm leading-tight text-text-1">
              {formatCurrency(spent)} /{" "}
              {remaining < 0 ? (
                <span className="text-danger-5">
                  {formatCurrency(remaining)}
                </span>
              ) : (
                formatCurrency(remaining)
              )}
            </span>
            <span className="ml-auto">
              <SpentBar spent={spent} budget={budget} />
            </span>
          </div>
        ) : (
          <span className="text-sm text-text-1">—</span>
        )}
      </td>
      {/* Projected */}
      <td className="px-4 align-middle whitespace-nowrap">
        {budget > 0 ? (
          <ProjectedBadge projected={projected} budget={budget} />
        ) : (
          <span className="text-sm text-text-1">—</span>
        )}
      </td>
      {/* Members */}
      <td className="px-4 align-middle">
        {team.members.length > 0 ? (
          <MemberAvatars members={team.members} extra={extraMembers} />
        ) : (
          <span className="text-sm text-text-1">—</span>
        )}
      </td>
      {/* Actions */}
      <td
        className="px-4 align-middle text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-3 hover:text-text-1"
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
            {team.canManage && (
              <CreateTeamDialog team={team}>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Pencil className="h-4 w-4" />
                  Edit team
                </DropdownMenuItem>
              </CreateTeamDialog>
            )}
            <DropdownMenuItem
              className="gap-2 text-danger-6 focus:text-danger-6"
              disabled={!team.canManage}
              onSelect={(e) => {
                e.preventDefault();
                if (!team.canManage) return;
                setConfirmOpen(true);
              }}
              title={
                team.canManage ? undefined : "Not available for basic users"
              }
            >
              <Trash2 className="h-4 w-4" />
              Remove team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove team</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete{" "}
                <strong>{team.name}</strong>? This action cannot be undone and
                will remove all members and subteams.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Removing..." : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}