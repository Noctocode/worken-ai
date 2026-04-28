"use client";

import { useState } from "react";
import { MoreVertical, UserX, Eye } from "lucide-react";
import Link from "next/link";
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

export function UserRow({ user }: { user: OrgUser }) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const canRemove = currentUser?.role === "admin";
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  const overBudget = projected > budget;

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-bg-1/50">
      {/* Name */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {user.picture && user.picture.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              className="h-7 w-7 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-2 text-[11px] font-semibold text-text-3">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <span>{user.name ?? "—"}</span>
        </div>
      </td>
      {/* Email */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
        {user.email}
      </td>
      {/* Role */}
      <td className="px-4 align-middle whitespace-nowrap">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
          user.role === "admin"
            ? "bg-danger-1 text-danger-6"
            : user.role === "advanced"
              ? "bg-primary-1 text-primary-7"
              : "bg-bg-3 text-text-2"
        }`}>
          {user.role === "admin" ? "Admin" : user.role === "advanced" ? "Advanced" : "Basic"}
        </span>
      </td>
      {/* Status */}
      <td className="px-4 align-middle whitespace-nowrap">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
          user.inviteStatus === "pending"
            ? "bg-warning-1 text-warning-6"
            : "bg-success-1 text-success-7"
        }`}>
          {user.inviteStatus === "pending" ? "Pending" : "Active"}
        </span>
      </td>
      {/* Teams */}
      <td className="px-4 align-middle">
        <div className="flex flex-wrap gap-1">
          {user.teams && user.teams.length > 0 ? (
            user.teams.map((t) => (
              <span
                key={t}
                className="rounded-sm bg-bg-2 px-1.5 py-0.5 text-[12px] text-text-2 whitespace-nowrap"
              >
                {t}
              </span>
            ))
          ) : (
            <span className="text-text-3">—</span>
          )}
        </div>
      </td>
      {/* Personal Monthly Budget */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
        {budget > 0 ? formatCurrency(budget) : "—"}
      </td>
      {/* Spent / Remaining */}
      <td className="w-[1%] px-4 align-middle whitespace-nowrap">
        {budget > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-sm leading-tight text-text-1">
              {formatCurrency(spent)} /{" "}
              {remaining < 0 ? (
                <span className="text-danger-5">{formatCurrency(remaining)}</span>
              ) : (
                formatCurrency(remaining)
              )}
            </span>
            <span className="ml-auto">
              <SpentBar spent={spent} budget={budget} />
            </span>
          </div>
        ) : (
          "—"
        )}
      </td>
      {/* Projected */}
      <td className="px-4 align-middle whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-text-1">{formatCurrency(projected)}</span>
          {overBudget ? (
            <span className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[11px] font-medium text-text-3 whitespace-nowrap">
              Over Budget
            </span>
          ) : budget > 0 ? (
            <span className="rounded-sm bg-success-1 px-1.5 py-0.5 text-[11px] font-medium text-text-1 whitespace-nowrap">
              On track
            </span>
          ) : null}
        </div>
      </td>
      {/* Actions */}
      <td className="px-4 align-middle text-right">
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
            <DropdownMenuItem asChild className="gap-2">
              <Link href={`/users/${user.id}`}>
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
      </td>
    </tr>
  );
}