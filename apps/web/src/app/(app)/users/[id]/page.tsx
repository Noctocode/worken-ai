"use client";

import { use, useState } from "react";
import {
  MoreVertical,
  Trash2,
  Info,
  LayoutList,
  Loader2,
  Pencil,
  Check,
  X,
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
 * Role indicator. In view mode (or for non-editable callers) shows a
 * read-only Badge. In edit mode shows a controlled Select; the parent
 * owns the staged value and decides when to commit on Confirm.
 */
function UserRoleControl({
  role,
  mode,
  onChange,
  disabled,
}: {
  role: OrgRole;
  mode: "view" | "edit";
  onChange?: (role: OrgRole) => void;
  disabled?: boolean;
}) {
  const badgeClass =
    role === "admin"
      ? "border-transparent bg-danger-1 text-danger-6 uppercase tracking-wide text-[10px] px-1.5 py-0"
      : role === "advanced"
        ? "border-transparent bg-primary-1 text-primary-7 uppercase tracking-wide text-[10px] px-1.5 py-0"
        : "border-transparent bg-bg-3 text-text-2 uppercase tracking-wide text-[10px] px-1.5 py-0";

  if (mode === "view") {
    return <Badge className={badgeClass}>{role}</Badge>;
  }

  return (
    <Select
      value={role}
      onValueChange={(v) => onChange?.(v as OrgRole)}
      disabled={disabled}
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
  const isAdmin = currentUser?.role === "admin";
  const isSelf = currentUser?.id === id;

  const { data: user, isLoading, error } = useQuery({
    queryKey: ["users", id],
    queryFn: () => fetchOrgUser(id),
  });

  // Edit mode — the page is read-only by default. Admins flip into
  // edit mode via the green pencil; both Monthly Budget and the
  // organization role are staged locally and committed atomically
  // on Confirm. Cancel discards the staged values.
  const [isEditing, setIsEditing] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editRole, setEditRole] = useState<OrgRole>("basic");

  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateUserBudget(id, budgetUsd),
  });

  const orgRoleMutation = useMutation({
    mutationFn: (role: OrgRole) => updateUserRole(id, role),
  });

  // Team-member role mutation kept separate — that table has its own
  // inline Select per row (Editor / Viewer) and doesn't go through the
  // edit-mode flow.
  const teamRoleMutation = useMutation({
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

  const formattedBudget = budget.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const isSubmitting = budgetMutation.isPending || orgRoleMutation.isPending;
  // Block editing your own role — BE rejects self-mutation to avoid
  // admin lockout, FE matches that.
  const canEditSelfRole = !isSelf;

  const enterEditMode = () => {
    setEditBudget(formattedBudget);
    setEditRole(user.role);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditBudget("");
  };

  const confirmEdit = async () => {
    // Parse budget — accept "1.234,56" (de-DE), "1234.56", "0".
    const raw = editBudget.replace(/\./g, "").replace(",", ".");
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0) {
      toast.error("Budget must be a non-negative number.");
      return;
    }

    const budgetChanged = parsed !== budget;
    const roleChanged = editRole !== user.role;
    if (!budgetChanged && !roleChanged) {
      setIsEditing(false);
      return;
    }

    // Fire the changed mutations in parallel; surface a per-mutation
    // toast so a partial failure (e.g. budget OK but role rejected) is
    // visible. React Query refetches the user on success; the staged
    // values are cleared regardless so the next edit starts fresh.
    const tasks: Array<Promise<unknown>> = [];
    if (budgetChanged) {
      tasks.push(
        budgetMutation
          .mutateAsync(parsed)
          .then(() => toast.success("Budget updated."))
          .catch((err: Error) => {
            toast.error(err.message || "Couldn't update budget.");
            throw err;
          }),
      );
    }
    if (roleChanged) {
      tasks.push(
        orgRoleMutation
          .mutateAsync(editRole)
          .then((data) =>
            toast.success(`Role updated to ${data.role}.`),
          )
          .catch((err: Error) => {
            toast.error(err.message || "Couldn't update role.");
            throw err;
          }),
      );
    }

    const results = await Promise.allSettled(tasks);
    queryClient.invalidateQueries({ queryKey: ["users", id] });
    queryClient.invalidateQueries({ queryKey: ["org-users"] });

    // Stay in edit mode if anything failed so the user can retry / see
    // their staged values; exit only on a fully clean run.
    const allOk = results.every((r) => r.status === "fulfilled");
    if (allOk) {
      setIsEditing(false);
      setEditBudget("");
    }
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
                <p className="text-[18px] font-bold text-text-1">
                  {displayName}
                </p>
                <UserRoleControl
                  role={isEditing ? editRole : user.role}
                  mode={
                    isEditing && canEditSelfRole ? "edit" : "view"
                  }
                  onChange={(r) => setEditRole(r)}
                  disabled={isSubmitting}
                />
                {isEditing && !canEditSelfRole && (
                  <span className="text-[11px] text-text-3">
                    (you can&apos;t change your own role)
                  </span>
                )}
              </div>
              <p className="text-[16px] text-text-1">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              className="h-10 gap-2 border-border-2 text-[14px] text-text-1"
            >
              <LayoutList className="h-4 w-4" />
              Activity Log
            </Button>

            {/* Admin-only edit toggle. View mode shows a green Pencil
                icon; clicking it stages the current values and reveals
                the inputs. Edit mode swaps the icon for a Confirm /
                Cancel pair. Non-admins never see any of these. */}
            {isAdmin && !isEditing && (
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 border-success-7/40 text-success-7 hover:bg-success-7/10 hover:text-success-7"
                onClick={enterEditMode}
                title="Edit Monthly Budget and role"
              >
                <Pencil className="h-4 w-4" strokeWidth={2.5} />
              </Button>
            )}
            {isAdmin && isEditing && (
              <>
                <Button
                  variant="outline"
                  className="h-10 gap-2 border-border-2"
                  onClick={cancelEdit}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  className="h-10 gap-2 bg-success-7 text-white hover:bg-success-7/90"
                  onClick={confirmEdit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  Confirm
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Monthly Budget — text in view mode, input in edit mode. */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Monthly Budget</p>
            {isEditing ? (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">
                  $
                </span>
                <input
                  type="text"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    }
                  }}
                  disabled={isSubmitting}
                  autoFocus
                  className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {budget > 0 ? (
                  <span>{formatCurrency(budget)}</span>
                ) : (
                  <span className="text-text-3">Not set</span>
                )}
              </div>
            )}
            {!isEditing && !isAdmin && (
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
                            teamRoleMutation.mutate({
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
