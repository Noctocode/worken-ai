"use client";

import { use, useState } from "react";
import {
  MoreVertical,
  Trash2,
  Info,
  LayoutList,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchOrgUser,
  updateMemberRole,
  updateUserBudget,
  updateUserRole,
  type OrgRole,
} from "@/lib/api";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useAuth } from "@/components/providers";

/* ─── Helper components ──────────────────────────────────────────────────── */

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function UserAvatar({ name, picture, size = 80 }: { name: string; picture: string | null; size?: number }) {
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={picture}
        alt={name}
        className="rounded-full object-cover border border-border-2"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full bg-bg-3 text-[18px] font-semibold text-text-3 border border-border-2"
      style={{ width: size, height: size }}
    >
      {getInitials(name)}
    </div>
  );
}

/**
 * Role indicator + admin-only role select. Non-admin viewers see a
 * read-only badge. Admins viewing other users see a Select that
 * mutates `users.role`. Admins viewing THEMSELVES still see a badge —
 * the BE blocks self-mutation (lockout prevention) so the FE doesn't
 * offer the affordance either.
 */
function UserRoleControl({
  user,
  canEdit,
  onChange,
  pending,
}: {
  user: { role: "basic" | "advanced" | "admin" };
  canEdit: boolean;
  onChange: (role: OrgRole) => void;
  pending: boolean;
}) {
  const badgeClass =
    user.role === "admin"
      ? "border-transparent bg-danger-1 text-danger-6 uppercase tracking-wide text-[10px] px-1.5 py-0"
      : user.role === "advanced"
        ? "border-transparent bg-primary-1 text-primary-7 uppercase tracking-wide text-[10px] px-1.5 py-0"
        : "border-transparent bg-bg-3 text-text-2 uppercase tracking-wide text-[10px] px-1.5 py-0";

  if (!canEdit) {
    return <Badge className={badgeClass}>{user.role}</Badge>;
  }

  return (
    <Select
      value={user.role}
      onValueChange={(v) => {
        if (v === user.role) return;
        onChange(v as OrgRole);
      }}
      disabled={pending}
    >
      <SelectTrigger className="h-7 w-[110px] rounded-full border-border-3 bg-bg-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="basic">Basic</SelectItem>
        <SelectItem value="advanced">Advanced</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const exceeded = spent > budget;
  return (
    <div className="flex items-center h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
      <div
        className={`h-full shrink-0 ${exceeded ? "bg-danger-5" : "bg-success-2"}`}
        style={{ width: `${pct}%` }}
      />
      <div className="h-full flex-1 bg-bg-white" />
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  // Mirrors the BE guard on PATCH /users/:id/budget — only admins may
  // change a user's spend cap, since the cap is enforced upstream on
  // OpenRouter and basic / advanced users letting each other lift it
  // would defeat the whole point of the budget.
  const canEditBudget = currentUser?.role === "admin";

  const { data: user, isLoading, error } = useQuery({
    queryKey: ["users", id],
    queryFn: () => fetchOrgUser(id),
  });

  // Budget editing
  const [budgetInput, setBudgetInput] = useState<string | null>(null);
  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateUserBudget(id, budgetUsd),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", id] }),
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't update budget.");
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({
      teamId,
      memberId,
      role,
    }: {
      teamId: string;
      memberId: string;
      role: "editor" | "viewer";
    }) => updateMemberRole(teamId, memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", id] });
      toast.success("Role updated.");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't update role.");
    },
  });

  const orgRoleMutation = useMutation({
    mutationFn: (role: OrgRole) => updateUserRole(id, role),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users", id] });
      // Refresh the org-users list so the role badge in Management →
      // Users updates immediately without a hard reload.
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      toast.success(`Role updated to ${data.role}.`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't update role.");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-3">Failed to load user.</p>
      </div>
    );
  }

  const displayName = user.name ?? user.email;
  const budget = user.monthlyBudgetCents / 100;
  const spent = user.spentCents / 100;
  const remaining = budget - spent;
  const projected = user.projectedCents / 100;
  const onTrack = projected <= budget;

  const displayBudget = budgetInput ?? budget.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleBudgetBlur = () => {
    if (budgetInput === null) return;
    const raw = budgetInput.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(raw);
    // Allow 0 — that's the "suspend" gesture (admin blocks all spend
    // for this user until they raise the budget again). BE enforces
    // non-negative.
    if (!isNaN(num) && num >= 0 && num !== budget) {
      budgetMutation.mutate(num);
    }
    setBudgetInput(null);
  };

  return (
    <div className="space-y-6">
      {/* ── User info + Budget card ──────────────────────────────── */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        {/* User info row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <UserAvatar name={displayName} picture={user.picture} size={80} />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-[18px] font-bold text-text-1">{displayName}</p>
                <UserRoleControl
                  user={user}
                  canEdit={
                    currentUser?.role === "admin" && currentUser.id !== id
                  }
                  onChange={(role) => orgRoleMutation.mutate(role)}
                  pending={orgRoleMutation.isPending}
                />
              </div>
              <p className="text-[16px] text-text-1">{user.email}</p>
            </div>
          </div>
          <Button variant="outline" className="h-10 gap-2 border-border-2 text-[14px] text-text-1 shrink-0">
            <LayoutList className="h-4 w-4" />
            Activity Log
          </Button>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Monthly Budget */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">$</span>
              <input
                type="text"
                value={displayBudget}
                onChange={(e) => setBudgetInput(e.target.value)}
                onBlur={handleBudgetBlur}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                disabled={!canEditBudget}
                title={
                  canEditBudget
                    ? undefined
                    : "Only admins can change a user's monthly budget."
                }
                className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-2 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            {!canEditBudget && (
              <p className="text-[12px] text-text-3">
                Only admins can change this — ask an admin to adjust the
                budget.
              </p>
            )}
          </div>

          {/* Spent / Remaining */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">
                {formatCurrency(spent)} / {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}
              </span>
              <SpentBar spent={spent} budget={budget} />
            </div>
          </div>

          {/* Projected */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-text-3" />
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              <span
                className={`rounded-lg px-2 py-1 text-[13px] ${
                  onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"
                }`}
              >
                {onTrack ? "On track" : "Over Budget"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Teams ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-[18px] font-bold text-text-1">Teams</p>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Team</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Role</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {user.teams.map((t) => (
                  <tr key={t.id} className="h-14 border-b border-border-2">
                    <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                      {t.name}
                      {t.status === "pending" && (
                        <span className="ml-2 rounded-lg bg-bg-2 px-2 py-0.5 text-[13px] text-text-3">Pending</span>
                      )}
                    </td>
                    <td className="bg-bg-white px-4 align-middle">
                      {t.role === "owner" ? (
                        <span className="inline-flex h-8 items-center rounded-md border border-border-2 bg-bg-1 px-3 text-sm font-medium text-text-1">
                          Team Owner
                        </span>
                      ) : (
                        <Select
                          value={t.role}
                          disabled={!t.canManage}
                          onValueChange={(value) =>
                            roleMutation.mutate({
                              teamId: t.id,
                              memberId: t.memberId,
                              role: value as "editor" | "viewer",
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-[130px] border-border-2 text-sm text-text-1 disabled:opacity-60 disabled:cursor-not-allowed">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="editor">Editor</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="bg-bg-white px-4 align-middle w-[93px]">
                      <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1">
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2 text-danger-6 focus:text-danger-6">
                              <Trash2 className="h-4 w-4" />
                              Remove from team
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {user.teams.length === 0 && (
                  <tr>
                    <td colSpan={3} className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3">
                      Not a member of any team.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
