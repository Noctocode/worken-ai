"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, UserX, Eye } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { DisabledReasonTooltip } from "@/components/ui/tooltip";
import { useAuth } from "@/components/providers";
import { removeOrgUser, type OrgUser } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/**
 * Mobile-only card variant of `UserRow`. The 9-column table layout
 * doesn't survive on a 375px viewport, so each row collapses to a
 * stacked card per the same Figma 4720:31166 pattern used for teams:
 * a header row with avatar + name + role + kebab, role/status pills,
 * an optional team chip strip, a divider, and the budget block
 * (monthly / spent / progress / projected). Rendered at `<lg`; the
 * parent page keeps the desktop table at `lg+`.
 */
export function UserCard({ user }: { user: OrgUser }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const canRemove = currentUser?.role === "admin";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const detailHref = `/users/${user.id}`;

  const removeMutation = useMutation({
    mutationFn: () => removeOrgUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setConfirmOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't remove user.");
      setConfirmOpen(false);
    },
  });

  const budget = user.monthlyBudgetCents / 100;
  const spent = user.spentCents / 100;
  const remaining = budget - spent;
  const projected = user.projectedCents / 100;
  const overBudget = budget > 0 && projected > budget;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const spentOver = spent > budget;

  const cardClick = () => router.push(detailHref);

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open ${user.name ?? user.email}`}
      onClick={cardClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cardClick();
        }
      }}
      className="flex cursor-pointer flex-col gap-2.5 rounded-xl border border-border-2 bg-bg-white p-3.5 transition-colors hover:bg-bg-1/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-6"
    >
      {/* Row 1: avatar + name + kebab */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {user.picture && user.picture.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-2 text-[13px] font-semibold text-text-3">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-text-1">
              {user.name ?? "—"}
            </p>
            <p className="truncate text-[12px] text-text-3">{user.email}</p>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${user.name ?? user.email}`}
                className="h-8 w-8 shrink-0 rounded-lg border border-border-2 text-text-2 hover:bg-bg-1 hover:text-text-1"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild className="gap-2">
                <Link href={detailHref}>
                  <Eye className="h-4 w-4" />
                  View user
                </Link>
              </DropdownMenuItem>
              <DisabledReasonTooltip
                disabled={!canRemove}
                reason="Only admins can remove users"
              >
                <DropdownMenuItem
                  className="gap-2 text-danger-6 focus:text-danger-6"
                  disabled={!canRemove || removeMutation.isPending}
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!canRemove) return;
                    setConfirmOpen(true);
                  }}
                >
                  <UserX className="h-4 w-4" />
                  Remove user
                </DropdownMenuItem>
              </DisabledReasonTooltip>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Role + status pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            user.role === "admin"
              ? "bg-danger-1 text-danger-6"
              : user.role === "advanced"
                ? "bg-primary-1 text-primary-7"
                : "bg-bg-3 text-text-2"
          }`}
        >
          {user.role === "admin"
            ? "Admin"
            : user.role === "advanced"
              ? "Advanced"
              : "Basic"}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            user.inviteStatus === "pending"
              ? "bg-warning-1 text-warning-6"
              : "bg-success-1 text-success-7"
          }`}
        >
          {user.inviteStatus === "pending" ? "Pending" : "Active"}
        </span>
      </div>

      {/* Teams chip strip — only render when the user is in at least one */}
      {user.teams && user.teams.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {user.teams.map((t) => (
            <span
              key={t}
              className="rounded-sm bg-bg-2 px-1.5 py-0.5 text-[12px] text-text-2 whitespace-nowrap"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="h-px bg-border-2" />

      {/* Monthly Budget */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-text-3">Personal Monthly Budget</span>
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

      {/* Projected */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-text-3">Projected</span>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-1">
            {formatCurrency(projected)}
          </span>
          {overBudget ? (
            <span className="rounded bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3">
              Over Budget
            </span>
          ) : budget > 0 ? (
            <span className="rounded bg-success-1 px-1.5 py-0.5 text-[11px] font-medium text-text-1">
              On track
            </span>
          ) : null}
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove user</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove{" "}
                <strong>{user.name ?? user.email}</strong> from the
                organization? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={removeMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? "Removing..." : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
