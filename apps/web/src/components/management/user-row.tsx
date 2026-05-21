"use client";

import { useState } from "react";
import { MoreVertical, UserX, Eye, Wallet, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/providers";
import { removeOrgUser, updateUserBudget, type OrgUser } from "@/lib/api";
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const canRemove = currentUser?.role === "admin";
  // Mirrors the BE rule on PATCH /users/:id/budget: admin can edit
  // anyone; everyone else can edit their OWN row unless they're
  // explicitly 'company'-profile (where the org admin owns the cap).
  const isSelf = currentUser?.id === user.id;
  const canEditBudget =
    currentUser?.role === "admin" ||
    (isSelf && currentUser?.profileType !== "company");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
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
  const overBudget = projected > budget;
  // Same flag that powers the "N users awaiting budget approval"
  // banner — true when a managed-cloud user finished onboarding
  // without a cap and is blocked from AI calls until one is set.
  // Surfacing it on the row's actions column lets admins jump
  // straight from a scan of the table into the fix.
  const needsBudget = user.pendingBudgetApproval;

  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateUserBudget(user.id, budgetUsd),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["users", user.id] });
      toast.success("Monthly budget updated.");
      setBudgetOpen(false);
      setBudgetInput("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't update budget.");
    },
  });

  const openBudgetDialog = () => {
    // Pre-fill with the current value so the admin adjusts rather
    // than re-types. Blank when there's no budget yet so the empty
    // input cues "this is uninitialised, set it now".
    setBudgetInput(budget > 0 ? budget.toFixed(2) : "");
    setBudgetOpen(true);
  };

  const submitBudget = () => {
    const parsed = parseFloat(budgetInput);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Budget must be a non-negative number.");
      return;
    }
    budgetMutation.mutate(parsed);
  };

  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={`Open ${user.name ?? user.email}`}
      className="h-14 cursor-pointer border-b border-bg-1 transition-colors hover:bg-bg-1/50 focus:outline-none focus-visible:bg-bg-1/60 focus-visible:ring-1 focus-visible:ring-primary-6"
      onClick={() => router.push(detailHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(detailHref);
        }
      }}
    >
      {/* Name */}
      <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
        <div className="flex items-center gap-2">
          {user.picture && user.picture.length > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              referrerPolicy="no-referrer"
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
      {/* Actions — stopPropagation so clicking the kebab / Remove
          button doesn't also fire the row's navigate-to-detail click. */}
      <td
        className="px-4 align-middle text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7 text-text-3 hover:text-text-1"
              aria-label={
                needsBudget
                  ? `Actions for ${user.name ?? user.email} — budget not set`
                  : `Actions for ${user.name ?? user.email}`
              }
            >
              <MoreVertical className="h-4 w-4" />
              {/* Red dot when this user is blocked on a missing
                  budget — same signal that drives the page-level
                  awaiting-approval banner, scoped to the row so
                  admins can locate the affected user at a glance. */}
              {needsBudget ? (
                <span
                  aria-hidden="true"
                  className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-danger-6 ring-1 ring-bg-white"
                />
              ) : null}
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
              disabled={!canEditBudget}
              reason={
                isSelf
                  ? "Your admin manages your budget"
                  : "Only admins can change another user's budget"
              }
            >
              <DropdownMenuItem
                className={`gap-2 ${needsBudget ? "text-danger-6 focus:text-danger-6" : ""}`}
                disabled={!canEditBudget || budgetMutation.isPending}
                onSelect={(e) => {
                  e.preventDefault();
                  if (!canEditBudget) return;
                  openBudgetDialog();
                }}
              >
                {needsBudget ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <Wallet className="h-4 w-4" />
                )}
                {budget > 0 ? "Change budget" : "Set budget"}
              </DropdownMenuItem>
            </DisabledReasonTooltip>
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
        <Dialog
          open={budgetOpen}
          onOpenChange={(next) => {
            if (budgetMutation.isPending) return;
            setBudgetOpen(next);
            if (!next) setBudgetInput("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {budget > 0 ? "Change monthly budget" : "Set monthly budget"}
              </DialogTitle>
              <DialogDescription>
                {user.name ? (
                  <>
                    {user.name}{" "}
                    <span className="text-text-3">· {user.email}</span>
                  </>
                ) : (
                  user.email
                )}
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitBudget();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor={`user-row-budget-${user.id}`}>
                  Monthly cap (USD)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-text-3">
                    $
                  </span>
                  <Input
                    id={`user-row-budget-${user.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    autoFocus
                    disabled={budgetMutation.isPending}
                    className="pl-7"
                  />
                </div>
                <p className="text-[12px] text-text-3">
                  Caps the user&apos;s personal-project and arena spend.
                  Enter <strong>0</strong> to suspend AI access until the
                  cap is raised again.
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBudgetOpen(false)}
                  disabled={budgetMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    budgetMutation.isPending || budgetInput.trim() === ""
                  }
                  className="bg-primary-6 text-white hover:bg-primary-7"
                >
                  {budgetMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
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