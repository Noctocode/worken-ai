"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MoreVertical,
  Trash2,
  Info,
  LayoutList,
  Loader2,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchOrgUser,
  fetchUserActivity,
  removeOrgUser,
  removeTeamMember,
  updateMemberRole,
  updateUserBudget,
  updateUserRole,
  type OrgRole,
  type UserActivityEvent,
} from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatBudgetInput, formatCurrency } from "@/lib/utils";
import { useAuth } from "@/components/providers";
import { useLanguage } from "@/lib/i18n";

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
        referrerPolicy="no-referrer"
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
  const { t } = useLanguage();
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
        <SelectItem value="basic">{t("userDetail.roleBasic")}</SelectItem>
        <SelectItem value="advanced">{t("userDetail.roleAdvanced")}</SelectItem>
        <SelectItem value="admin">{t("userDetail.roleAdmin")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * Activity-log row. One per observability event for this user. Compact
 * grid: time + type pill / model + provider / tokens + cost + latency
 * + status. Failed events get the danger-tinted dot and surface the
 * error message; successful ones show only the metrics.
 */
function ActivityRow({ event }: { event: UserActivityEvent }) {
  const { t } = useLanguage();
  const when = new Date(event.createdAt);
  const time = when.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const eventLabel = (() => {
    switch (event.eventType) {
      case "chat_call":
        return t("userDetail.eventChat");
      case "arena_call":
        return t("userDetail.eventArena");
      case "evaluator_call":
        return t("userDetail.eventEvaluator");
      case "guardrail_trigger":
        return t("userDetail.eventGuardrail");
      default:
        return event.eventType;
    }
  })();
  const cost =
    event.costUsd != null
      ? `$${event.costUsd.toFixed(event.costUsd < 1 ? 4 : 2)}`
      : null;

  return (
    <li className="flex flex-col gap-1.5 border-b border-bg-1 px-4 py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
              event.success ? "bg-success-7" : "bg-danger-6"
            }`}
            aria-label={event.success ? t("userDetail.success") : t("userDetail.failed")}
          />
          <span className="rounded bg-bg-1 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-2">
            {eventLabel}
          </span>
          {event.model && (
            <span className="truncate text-[13px] text-text-1">
              {event.model}
            </span>
          )}
        </div>
        <span className="shrink-0 text-[12px] text-text-3 whitespace-nowrap">
          {time}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-3 pl-4">
        {event.provider && <span>{event.provider}</span>}
        {event.totalTokens != null && (
          <span>{event.totalTokens.toLocaleString()} {t("userDetail.tokens")}</span>
        )}
        {cost && <span>{cost}</span>}
        {event.latencyMs != null && (
          <span>
            {event.latencyMs >= 1000
              ? `${(event.latencyMs / 1000).toFixed(1)}s`
              : `${event.latencyMs}ms`}
          </span>
        )}
        {event.teamName && <span>· {event.teamName}</span>}
      </div>
      {!event.success && event.errorMessage && (
        <p className="pl-4 text-[12px] text-danger-6 line-clamp-2">
          {event.errorMessage}
        </p>
      )}
      {event.promptPreview && (
        <p className="pl-4 text-[12px] text-text-2 line-clamp-2 italic">
          “{event.promptPreview}”
        </p>
      )}
    </li>
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
  const { t } = useLanguage();
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const isSelf = currentUser?.id === id;

  const { data: user, isLoading, error } = useQuery({
    queryKey: ["users", id],
    queryFn: () => fetchOrgUser(id),
  });

  // Edit mode — the page is read-only by default. Admins flip into
  // edit mode via the appbar pencil (which dispatches user-detail:edit
  // on the window); both Monthly Budget and the organization role are
  // staged locally and committed atomically on Confirm. Cancel
  // discards the staged values.
  const [isEditing, setIsEditing] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editRole, setEditRole] = useState<OrgRole>("basic");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  // Pending team-removal target. Triggered by the "Remove from team"
  // dropdown item in the Teams table; surfaces a confirm dialog
  // before actually firing the mutation.
  const [pendingTeamRemoval, setPendingTeamRemoval] = useState<{
    teamId: string;
    memberId: string;
    teamName: string;
  } | null>(null);

  // Lazy-load: only fetch when the dialog is opened. 50 most recent
  // events is enough for a glance; if the user wants the full history
  // they can drill into the Observability dashboard with a userId
  // filter (separate page, supports search + range).
  const activityQuery = useQuery({
    queryKey: ["user-activity", id],
    queryFn: () => fetchUserActivity(id, { page: 1, pageSize: 50 }),
    enabled: activityOpen,
  });

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
      role: "admin" | "manager" | "editor" | "viewer";
    }) => updateMemberRole(teamId, memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", id] });
      toast.success(t("userDetail.roleUpdated"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("userDetail.couldntUpdateRole"));
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removeOrgUser(id),
    onSuccess: () => {
      toast.success(t("userDetail.userRemoved"));
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      router.push("/teams?tab=users");
    },
    onError: (err: Error) => {
      toast.error(err.message || t("userDetail.couldntRemoveUser"));
    },
  });

  const removeTeamMemberMutation = useMutation({
    mutationFn: ({
      teamId,
      memberId,
    }: {
      teamId: string;
      memberId: string;
    }) => removeTeamMember(teamId, memberId),
    onSuccess: () => {
      toast.success(t("userDetail.removedFromTeam"));
      queryClient.invalidateQueries({ queryKey: ["users", id] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      setPendingTeamRemoval(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("userDetail.couldntRemoveTeam"));
      setPendingTeamRemoval(null);
    },
  });

  // The appbar's Pencil / Trash2 buttons fire `user-detail:edit` and
  // `user-detail:delete` window events (see appbar.tsx — same pattern
  // as the other appbar actions). Wire them here so the chrome
  // controls drive page state without prop-drilling through the
  // layout. Admin gating lives on the appbar side; if a non-admin
  // somehow dispatches the event, the BE would reject anyway.
  //
  // MUST stay above the early-return guards below — React's rules of
  // hooks require the hook count to match across every render, so
  // placing this after `if (isLoading) return ...` would crash the
  // page on the first load → loaded transition.
  useEffect(() => {
    const onEdit = () => {
      if (!user) return;
      // First-time edit with no budget set yet: seed the $10 product
      // default so personal-profile users hitting Save right away
      // get a meaningful amount instead of provisioning $0.
      const dollars =
        user.monthlyBudgetCents > 0 ? user.monthlyBudgetCents / 100 : 10;
      setEditBudget(
        dollars.toLocaleString("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );
      setEditRole(user.role);
      setIsEditing(true);
    };
    const onDelete = () => {
      setConfirmDeleteOpen(true);
    };
    window.addEventListener("user-detail:edit", onEdit);
    window.addEventListener("user-detail:delete", onDelete);
    return () => {
      window.removeEventListener("user-detail:edit", onEdit);
      window.removeEventListener("user-detail:delete", onDelete);
    };
  }, [user]);

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
        <p className="text-text-3">{t("userDetail.failedLoad")}</p>
      </div>
    );
  }

  const displayName = user.name ?? user.email;
  const budget = user.monthlyBudgetCents / 100;
  const spent = user.spentCents / 100;
  const remaining = budget - spent;
  const projected = user.projectedCents / 100;
  const onTrack = projected <= budget;

  const isSubmitting = budgetMutation.isPending || orgRoleMutation.isPending;
  // Block editing your own role — BE rejects self-mutation to avoid
  // admin lockout, FE matches that.
  const canEditSelfRole = !isSelf;
  // Budget edit gating — mirrors the BE rule in users.controller.ts
  // (PATCH /users/:id/budget): admin can edit anyone; everyone else
  // can edit their OWN row unless they're explicitly 'company'-
  // profile (where the org admin owns the spend cap). 'personal' and
  // NULL profileType both self-manage. Gating the rendered controls
  // on this closes the devtools-dispatch loophole described below.
  const canEditBudget =
    isAdmin || (isSelf && currentUser?.profileType !== "company");
  // The edit affordances should only ever render for callers the BE
  // would accept. `isEditing` can be flipped to true by anyone who
  // knows to dispatch `user-detail:edit` from devtools (the appbar
  // icon hides for ineligible callers, but the event is global).
  // Gating on canEditBudget here closes that loophole — ineligible
  // callers can't end up looking at editable inputs they have no
  // way to submit, even if they trip the state.
  const editing = canEditBudget && isEditing;

  const cancelEdit = () => {
    setIsEditing(false);
    setEditBudget("");
  };

  const confirmEdit = async () => {
    // Parse budget — accept "1.234,56" (de-DE), "1234.56", "0".
    const raw = editBudget.replace(/\./g, "").replace(",", ".");
    const parsed = parseFloat(raw);
    if (isNaN(parsed) || parsed < 0) {
      toast.error(t("userDetail.budgetNonNegative"));
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
          .then(() => toast.success(t("userDetail.budgetUpdated")))
          .catch((err: Error) => {
            toast.error(err.message || t("userDetail.couldntUpdateBudget"));
            throw err;
          }),
      );
    }
    if (roleChanged) {
      tasks.push(
        orgRoleMutation
          .mutateAsync(editRole)
          .then((data) =>
            toast.success(`${t("userDetail.roleUpdatedTo")} ${data.role}.`),
          )
          .catch((err: Error) => {
            toast.error(err.message || t("userDetail.couldntUpdateRole"));
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
                  role={editing ? editRole : user.role}
                  mode={editing && canEditSelfRole ? "edit" : "view"}
                  onChange={(r) => setEditRole(r)}
                  disabled={isSubmitting}
                />
                {editing && !canEditSelfRole && (
                  <span className="text-[11px] text-text-3">
                    {t("userDetail.cantChangeOwnRole")}
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
              onClick={() => setActivityOpen(true)}
            >
              <LayoutList className="h-4 w-4" />
              {t("userDetail.activityLog")}
            </Button>

            {/* Edit-mode controls. The "enter edit mode" pencil lives
                up in the appbar (see appbar.tsx — userDetail variant);
                clicking it dispatches a window event the page listens
                for. Confirm / Cancel are inline because they're
                contextual to the form state, not chrome. */}
            {editing && (
              <>
                <Button
                  variant="outline"
                  className="h-10 gap-2 border-border-2"
                  onClick={cancelEdit}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                  {t("userDetail.cancel")}
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
                  {t("userDetail.confirm")}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Personal Monthly Budget — text in view mode, input in edit mode. */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <p className="text-[18px] font-bold text-text-1">
                {t("userDetail.personalMonthlyBudget")}
              </p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    className="h-3.5 w-3.5 text-text-3 cursor-help"
                    aria-label={t("userDetail.whatBudgetCovers")}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {t("userDetail.budgetTooltip")}
                </TooltipContent>
              </Tooltip>
            </div>
            {editing ? (
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editBudget}
                  onChange={(e) =>
                    setEditBudget(formatBudgetInput(e.target.value))
                  }
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
                  <span className="text-text-3">{t("userDetail.notSet")}</span>
                )}
              </div>
            )}
            {!editing && !canEditBudget && (
              <p className="text-[12px] text-text-3">
                {t("userDetail.adminOnly")}
              </p>
            )}
          </div>

          {/* Spent / Remaining */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("userDetail.spentRemaining")}</p>
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
              <p className="text-[18px] font-bold text-text-1">{t("userDetail.projected")}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("userDetail.projectedTooltipAria")}
                    className="flex items-center justify-center text-text-3 hover:text-text-1"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                  {t("userDetail.projectedTooltip")}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              <span
                className={`rounded-lg px-2 py-1 text-[13px] ${
                  onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"
                }`}
              >
                {onTrack ? t("userDetail.onTrack") : t("userDetail.overBudget")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Teams ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <p className="text-[18px] font-bold text-text-1">{t("userDetail.teamsTitle")}</p>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("userDetail.colTeam")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("userDetail.colRole")}</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("userDetail.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {user.teams.map((team) => (
                  <tr key={team.id} className="h-14 border-b border-border-2">
                    <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                      {team.name}
                      {team.status === "pending" && (
                        <span className="ml-2 rounded-lg bg-bg-2 px-2 py-0.5 text-[13px] text-text-3">{t("userDetail.pending")}</span>
                      )}
                    </td>
                    <td className="bg-bg-white px-4 align-middle">
                      {team.role === "owner" ? (
                        <span className="inline-flex h-8 items-center rounded-md border border-border-2 bg-bg-1 px-3 text-sm font-medium text-text-1">
                          {t("userDetail.teamOwner")}
                        </span>
                      ) : (
                        <Select
                          value={team.role}
                          disabled={!team.canManage}
                          onValueChange={(value) =>
                            teamRoleMutation.mutate({
                              teamId: team.id,
                              memberId: team.memberId,
                              role: value as
                                | "admin"
                                | "manager"
                                | "editor"
                                | "viewer",
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-[130px] border-border-2 text-sm text-text-1 disabled:opacity-60 disabled:cursor-not-allowed">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* 'Admin' and 'Manager' are gated by
                                the BE — promoting to / from those
                                tiers requires owner-level rights.
                                Options stay visible so the Select
                                renders the current value even when
                                read-only; the 403 surfaces as a
                                toast for editors who try. */}
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                            <SelectItem value="editor">Editor</SelectItem>
                            <SelectItem value="viewer">{t("userDetail.tmViewer")}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="bg-bg-white px-4 align-middle w-[93px]">
                      <div className="flex justify-center">
                        {!isSelf && team.canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-text-2 hover:text-text-1"
                              >
                                <MoreVertical className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="gap-2 text-danger-6 focus:text-danger-6"
                                onClick={() =>
                                  setPendingTeamRemoval({
                                    teamId: team.id,
                                    memberId: team.memberId,
                                    teamName: team.name,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                                {t("userDetail.removeFromTeam")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {user.teams.length === 0 && (
                  <tr>
                    <td colSpan={3} className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3">
                      {t("userDetail.notMemberAny")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Activity Log — opened by the page-level Activity Log button.
          Lazy-fetches the last 50 observability events for this user
          (chat / arena / evaluator calls, guardrail triggers). Admin
          can see anyone's activity; non-admins only their own (gated
          on the BE). */}
      <Dialog
        open={activityOpen}
        onOpenChange={(open) => !open && setActivityOpen(false)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("userDetail.activityTitle")} {displayName}</DialogTitle>
            <DialogDescription>
              {t("userDetail.activityDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-bg-1 bg-bg-white">
            {activityQuery.isLoading && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-text-3" />
              </div>
            )}
            {activityQuery.isError && (
              <div className="px-4 py-10 text-center text-sm text-danger-6">
                {activityQuery.error instanceof Error
                  ? activityQuery.error.message
                  : t("userDetail.failedActivity")}
              </div>
            )}
            {activityQuery.data &&
              !activityQuery.isLoading &&
              activityQuery.data.events.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-text-3">
                  {t("userDetail.noActivity")}
                </div>
              )}
            {activityQuery.data &&
              activityQuery.data.events.length > 0 && (
                <ul className="flex flex-col">
                  {activityQuery.data.events.map((e) => (
                    <ActivityRow key={e.id} event={e} />
                  ))}
                </ul>
              )}
          </div>
          {activityQuery.data &&
            activityQuery.data.total > activityQuery.data.events.length && (
              <p className="text-[12px] text-text-3">
                {t("userDetail.showing")} {activityQuery.data.events.length} {t("userDetail.of")}{" "}
                {activityQuery.data.total.toLocaleString()} {t("userDetail.mostRecent")}
              </p>
            )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActivityOpen(false)}
            >
              {t("userDetail.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove-from-team confirm — opened by the per-row dropdown
          in the Teams table. Stays separate from the org-level
          "Remove user" dialog below because the action and target
          are different (team membership vs whole user account). */}
      <Dialog
        open={!!pendingTeamRemoval}
        onOpenChange={(open) => !open && setPendingTeamRemoval(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("userDetail.removeFromTeamTitle")}</DialogTitle>
            <DialogDescription>
              {t("userDetail.removeTeamDesc1")} <strong>{displayName}</strong> {t("userDetail.removeTeamDesc2")}{" "}
              <strong>{pendingTeamRemoval?.teamName}</strong>{t("userDetail.removeTeamDesc3")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingTeamRemoval(null)}
              disabled={removeTeamMemberMutation.isPending}
            >
              {t("userDetail.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingTeamRemoval) {
                  removeTeamMemberMutation.mutate({
                    teamId: pendingTeamRemoval.teamId,
                    memberId: pendingTeamRemoval.memberId,
                  });
                }
              }}
              disabled={removeTeamMemberMutation.isPending}
            >
              {removeTeamMemberMutation.isPending ? t("userDetail.removing") : t("userDetail.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove user confirm — opened by the appbar Trash2 dispatch.
          Mirrors the dialog UserRow uses on /teams?tab=users; on
          success we route back to the Users tab. */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => !open && setConfirmDeleteOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("userDetail.removeUserTitle")}</DialogTitle>
            <DialogDescription>
              {t("userDetail.removeUserDesc1")}{" "}
              <strong>{displayName}</strong> {t("userDetail.removeUserDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={removeMutation.isPending}
            >
              {t("userDetail.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? t("userDetail.removing") : t("userDetail.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
