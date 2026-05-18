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

/**
 * Mobile-only card variant of `TeamRow`. Same data shape, same
 * mutations (edit / delete via DropdownMenu), but stacked vertically
 * per Figma 4720:31166 because a 7-column table is unreadable at
 * 375px wide. The parent page renders this at `<lg` and the table
 * at `lg+`.
 */
export function TeamCard({
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
  const extraMembers = team.memberCount > 4 ? team.memberCount - 4 : 0;
  const overBudget = budget > 0 && projected > budget;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const spentOver = spent > budget;

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

  const cardClick = () => router.push(`/teams/${team.id}`);

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open ${team.name}`}
      onClick={cardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cardClick();
        }
      }}
      className="flex cursor-pointer flex-col gap-2.5 rounded-xl border border-border-2 bg-bg-white p-3.5 transition-colors hover:bg-bg-1/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-6"
    >
      {/* Row 1: name + kebab */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-text-1">
            {team.name}
          </span>
          {isOwner && (
            <Badge
              variant="secondary"
              className="shrink-0 gap-1 text-[11px] border-warning-2 bg-warning-1 text-warning-6"
            >
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
        {/* Stop propagation so opening the kebab menu doesn't fire the
            outer card click → page navigation. */}
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${team.name}`}
                className="h-8 w-8 shrink-0 rounded-lg border border-border-2 text-text-2 hover:bg-bg-1 hover:text-text-1"
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
        </div>
      </div>

      {/* Description */}
      {team.description && (
        <p className="text-[13px] text-text-3 line-clamp-2">{team.description}</p>
      )}

      <div className="h-px bg-border-2" />

      {/* Monthly Budget */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-3">Monthly Budget</span>
        <span className="text-[13px] font-semibold text-text-1">
          {budget > 0 ? formatCurrency(budget) : "—"}
        </span>
      </div>

      {/* Spent / Remaining */}
      {budget > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-text-3">Spent / Remaining:</span>
            <span className="text-[13px] font-semibold text-text-1">
              {formatCurrency(spent)}{" "}
              <span className="font-normal text-text-3">/</span>{" "}
              <span className={remaining < 0 ? "text-danger-5" : ""}>
                {formatCurrency(remaining)}
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-3">
            <div
              className={`h-full rounded-full ${spentOver ? "bg-danger-5" : "bg-success-2"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-3">Spent / Remaining:</span>
          <span className="text-[13px] text-text-1">—</span>
        </div>
      )}

      {/* Projected + status badge */}
      {budget > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-text-3">Projected</span>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-text-1">
              {formatCurrency(projected)}
            </span>
            {projected > budget && spent > budget ? (
              <span className="rounded bg-danger-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
                Over Budget
              </span>
            ) : overBudget ? (
              <span className="rounded bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
                Will Exceed
              </span>
            ) : (
              <span className="rounded bg-success-1 px-1.5 py-0.5 text-[11px] font-medium text-text-1">
                On track
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-text-3">Projected</span>
          <span className="text-[13px] text-text-1">—</span>
        </div>
      )}

      {/* Members */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-3">Members</span>
        {team.members.length > 0 ? (
          <div className="flex items-center">
            <div className="flex -space-x-2">
              {team.members.slice(0, 4).map((m, i) =>
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
            {extraMembers > 0 && (
              <span className="ml-1.5 text-[12px] text-text-3">+{extraMembers}</span>
            )}
          </div>
        ) : (
          <span className="text-[13px] text-text-1">—</span>
        )}
      </div>

      {/* Delete confirmation — stopPropagation so dialog backdrop click
          doesn't bubble into the card-level navigate. */}
      <div onClick={(e) => e.stopPropagation()}>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove team</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{team.name}</strong>?
                This action cannot be undone and will remove all members and
                subteams.
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
      </div>
    </div>
  );
}
