"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  UserX,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/components/providers";
import {
  deleteCompanyProfile,
  fetchOnboardingProfile,
  fetchOrgSettings,
  fetchOrgUsers,
  fetchTeams,
  removeOrgUser,
  updateOnboardingProfile,
  updateOrgSettings,
  type OrgUser,
} from "@/lib/api";
import { formatBudgetInput, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import { DisabledReasonTooltip } from "@/components/ui/tooltip";

// Mirror the wizard step-2 dropdowns so the post-onboarding edit flow
// offers the same options. Source of truth: setup-profile/step-2 (BE
// validates against the same enum).
const INDUSTRIES = [
  { value: "technology", label: "Technology" },
  { value: "finance", label: "Finance" },
  { value: "healthcare", label: "Healthcare" },
  { value: "government", label: "Government" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "retail", label: "Retail" },
  { value: "other", label: "Other" },
];

const TEAM_SIZES = [
  { value: "1-10", label: "1 – 10" },
  { value: "11-50", label: "11 – 50" },
  { value: "51-200", label: "51 – 200" },
  { value: "201-1000", label: "201 – 1,000" },
  { value: "1000+", label: "1,000+" },
];

interface CompanyGuardrail {
  id: string;
  name: string;
  types: string[];
  severity: "high" | "medium" | "low";
  triggers: number;
  active: boolean;
}

// Org-level guardrails BE isn't there yet — these stay as static demo
// rows until that work lands. Profile + budget aggregates above are
// fully wired to real data.
const DEMO_GUARDRAILS: CompanyGuardrail[] = [
  { id: "1", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "2", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "3", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
];

const labelFor = (
  options: Array<{ value: string; label: string }>,
  value: string | null,
) => options.find((o) => o.value === value)?.label ?? value;

export function CompanyTab() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";
  const queryClient = useQueryClient();

  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
  } = useQuery({
    queryKey: ["onboarding-profile"],
    queryFn: fetchOnboardingProfile,
  });
  const { data: orgUsers = [] } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });
  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings"],
    queryFn: fetchOrgSettings,
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editTeamSize, setEditTeamSize] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  // Pending org-user removal target. Triggered by the per-row "Remove
  // user" dropdown item; surfaces a Dialog matching the rest of this
  // page rather than the bare browser confirm() it used to lean on.
  const [pendingRemoveUser, setPendingRemoveUser] = useState<OrgUser | null>(
    null,
  );

  const [guardrails, setGuardrails] =
    useState<CompanyGuardrail[]>(DEMO_GUARDRAILS);
  const toggleGuardrail = (id: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === id ? { ...g, active: !g.active } : g)),
    );
  };

  const updateMutation = useMutation({
    mutationFn: updateOnboardingProfile,
  });
  const updateBudgetMutation = useMutation({
    mutationFn: updateOrgSettings,
  });
  const removeUserMutation = useMutation({
    mutationFn: (userId: string) => removeOrgUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      toast.success("User removed.");
      setPendingRemoveUser(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't remove user.");
      setPendingRemoveUser(null);
    },
  });
  const deleteCompanyMutation = useMutation({
    mutationFn: deleteCompanyProfile,
    onSuccess: (result) => {
      toast.success(
        `Company deleted. Removed ${result.deletedTeamCount} team${
          result.deletedTeamCount === 1 ? "" : "s"
        }; ${result.affectedUserCount} user${
          result.affectedUserCount === 1 ? "" : "s"
        } now need to re-onboard.`,
      );
      // Bust every cache that just had its underlying rows wiped or
      // mutated. The onboarding-profile + auth.me invalidations make
      // OnboardingGuard re-evaluate and redirect the current admin to
      // /setup-profile, since their onboardingCompletedAt was cleared
      // on the server.
      queryClient.invalidateQueries({ queryKey: ["onboarding-profile"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      setConfirmDeleteOpen(false);
      setDeleteConfirmText("");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't delete company.");
    },
  });

  const editing = isAdmin && isEditing;
  const isSaving =
    updateMutation.isPending || updateBudgetMutation.isPending;

  const enterEdit = () => {
    if (!profile) return;
    setEditCompanyName(profile.companyName ?? "");
    setEditIndustry(profile.industry ?? "");
    setEditTeamSize(profile.teamSize ?? "");
    // Seed the budget editor from the current org-settings row. 0 is
    // the no-target sentinel — show it as an empty string so the
    // input doesn't read like a deliberate $0/mo target.
    const seedBudgetCents = orgSettings?.monthlyBudgetCents ?? 0;
    setEditBudget(
      seedBudgetCents > 0
        ? (seedBudgetCents / 100).toLocaleString("de-DE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : "",
    );
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditCompanyName("");
    setEditIndustry("");
    setEditTeamSize("");
    setEditBudget("");
  };

  const confirmEdit = async () => {
    if (!profile) return;
    const trimmedName = editCompanyName.trim();
    if (!trimmedName) {
      toast.error("Company name cannot be empty.");
      return;
    }

    // Parse de-DE budget: "1.234,56" → 1234.56. Empty string is the
    // "clear the target" gesture and lands as 0.
    let parsedBudgetCents = orgSettings?.monthlyBudgetCents ?? 0;
    const trimmedBudget = editBudget.trim();
    if (trimmedBudget.length === 0) {
      parsedBudgetCents = 0;
    } else {
      const raw = trimmedBudget.replace(/\./g, "").replace(",", ".");
      const num = parseFloat(raw);
      if (!Number.isFinite(num) || num < 0) {
        toast.error("Budget must be a non-negative number.");
        return;
      }
      parsedBudgetCents = Math.round(num * 100);
    }

    const nameChanged = trimmedName !== (profile.companyName ?? "");
    const industryChanged = editIndustry !== (profile.industry ?? "");
    const teamSizeChanged = editTeamSize !== (profile.teamSize ?? "");
    const budgetChanged =
      parsedBudgetCents !== (orgSettings?.monthlyBudgetCents ?? 0);
    if (
      !nameChanged &&
      !industryChanged &&
      !teamSizeChanged &&
      !budgetChanged
    ) {
      setIsEditing(false);
      return;
    }

    // Profile + budget land on different endpoints. Fire them in
    // parallel via Promise.allSettled and surface a single success
    // toast only when both succeed; partial failures keep edit mode
    // open so the admin can retry from the staged values.
    const tasks: Array<Promise<unknown>> = [];
    if (nameChanged || industryChanged || teamSizeChanged) {
      tasks.push(
        updateMutation
          .mutateAsync({
            ...(nameChanged ? { companyName: trimmedName } : {}),
            ...(industryChanged ? { industry: editIndustry } : {}),
            ...(teamSizeChanged ? { teamSize: editTeamSize } : {}),
          })
          .catch((err: Error) => {
            toast.error(err.message || "Couldn't update company profile.");
            throw err;
          }),
      );
    }
    if (budgetChanged) {
      tasks.push(
        updateBudgetMutation
          .mutateAsync({ monthlyBudgetCents: parsedBudgetCents })
          .catch((err: Error) => {
            toast.error(err.message || "Couldn't update company budget.");
            throw err;
          }),
      );
    }

    const results = await Promise.allSettled(tasks);
    queryClient.invalidateQueries({ queryKey: ["onboarding-profile"] });
    queryClient.invalidateQueries({ queryKey: ["org-settings"] });
    if (results.every((r) => r.status === "fulfilled")) {
      toast.success("Company updated.");
      setIsEditing(false);
    }
  };

  // Same window-event hook future-proofs us if the appbar grows a
  // Pencil/Trash2 slot for this tab. MUST stay above early returns so
  // hook count is stable across loading transitions.
  useEffect(() => {
    const onEdit = () => enterEdit();
    const onDelete = () => setConfirmDeleteOpen(true);
    window.addEventListener("company:edit", onEdit);
    window.addEventListener("company:delete", onDelete);
    return () => {
      window.removeEventListener("company:edit", onEdit);
      window.removeEventListener("company:delete", onDelete);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-3">Failed to load company profile.</p>
      </div>
    );
  }

  // Personal-profile users get a clear empty state instead of an
  // editor that would silently no-op (BE rejects PATCH with 400). The
  // Account tab has the same wording for parity.
  if (profile.profileType !== "company") {
    return (
      <div className="py-12 text-center text-[14px] text-text-3">
        This workspace is registered as a personal profile, so there&rsquo;s
        no company information to show. Visit My Account to update your
        profile type.
      </div>
    );
  }

  // Per-user spentCents covers personal projects + arena; per-team
  // spentCents covers team-routed chats. They partition the org's
  // spend so summing them is safe.
  const allocatedCents =
    teams.reduce((acc, t) => acc + (t.monthlyBudgetCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.monthlyBudgetCents ?? 0), 0);
  const totalSpentCents =
    teams.reduce((acc, t) => acc + (t.spentCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.spentCents ?? 0), 0);
  const totalProjectedCents =
    teams.reduce((acc, t) => acc + (t.projectedCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.projectedCents ?? 0), 0);

  // Company-level monthly target sourced from /org-settings. 0 means
  // "no target set" — the UI hides budget-comparison affordances and
  // falls back to plain spend reporting.
  const targetCents = orgSettings?.monthlyBudgetCents ?? 0;
  const hasTarget = targetCents > 0;

  const target = targetCents / 100;
  const allocated = allocatedCents / 100;
  const spent = totalSpentCents / 100;
  const remaining = target - spent;
  const projected = totalProjectedCents / 100;
  const onTrack = !hasTarget || projected <= target;
  const overBudget = hasTarget && (spent > target || projected > target);
  const pct = hasTarget ? Math.min((spent / target) * 100, 100) : 0;

  const admins = orgUsers.filter((u) => u.role === "admin");
  // Everyone who isn't an admin — basic + advanced both land here.
  // They can view company-wide screens but not mutate org settings.
  const participants = orgUsers.filter((u) => u.role !== "admin");
  const companyDisplay = profile.companyName?.trim() || "Unnamed company";

  return (
    <div className="py-6 space-y-6">
      {/* Over-budget banner. Shows when admin has set a target and
          either current spend or projected spend exceeds it. Sits
          above every other card so it's the first thing the admin
          reads when they enter the tab. Self-dismisses (re-renders
          out) once the situation resolves. */}
      {overBudget && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-3 bg-danger-1/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger-6 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-[14px] font-semibold text-danger-6">
              Over the company budget
            </p>
            <p className="text-[13px] text-text-1">
              {spent > target ? (
                <>
                  Spent <strong>{formatCurrency(spent)}</strong> of the{" "}
                  <strong>{formatCurrency(target)}</strong> monthly target.
                </>
              ) : (
                <>
                  Projected to spend <strong>{formatCurrency(projected)}</strong>{" "}
                  by month-end against a <strong>{formatCurrency(target)}</strong>{" "}
                  target.
                </>
              )}{" "}
              {isAdmin
                ? "Raise the target with the Pencil button, or trim per-team / per-member caps."
                : "Ask an admin to raise the target or trim per-team / per-member caps."}
            </p>
          </div>
        </div>
      )}

      {/* Company card */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-bg-3 text-text-3 text-2xl font-bold">
              {companyDisplay.charAt(0).toUpperCase()}
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              {editing ? (
                <input
                  type="text"
                  value={editCompanyName}
                  onChange={(e) => setEditCompanyName(e.target.value)}
                  placeholder="Company name"
                  disabled={isSaving}
                  className="w-full h-10 rounded border border-border-4 bg-transparent px-3 text-[18px] font-bold text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                  autoFocus
                />
              ) : (
                <p className="text-[18px] font-bold text-text-1">
                  {companyDisplay}
                </p>
              )}
              <p className="text-[16px] text-text-1">{profile.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  className="h-10 gap-2 border-border-2"
                  onClick={cancelEdit}
                  disabled={isSaving}
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  className="h-10 gap-2 bg-success-7 text-white hover:bg-success-7/90"
                  onClick={confirmEdit}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  )}
                  Confirm
                </Button>
              </>
            ) : (
              isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success-7 hover:text-success-7/80"
                    onClick={enterEdit}
                    title="Edit company profile"
                  >
                    <Pencil className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success-7 hover:text-success-7/80"
                    onClick={() => setConfirmDeleteOpen(true)}
                    title="Delete company"
                  >
                    <Trash2 className="h-6 w-6" />
                  </Button>
                </>
              )
            )}
          </div>
        </div>

        {/* Profile fields row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Industry</p>
            {editing ? (
              <Select value={editIndustry || undefined} onValueChange={setEditIndustry}>
                <SelectTrigger className="h-[56px] border-border-4 text-[16px] text-text-1">
                  <SelectValue placeholder="Select industry" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {profile.industry ? (
                  <span>{labelFor(INDUSTRIES, profile.industry)}</span>
                ) : (
                  <span className="text-text-3">Not set</span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Team size</p>
            {editing ? (
              <Select value={editTeamSize || undefined} onValueChange={setEditTeamSize}>
                <SelectTrigger className="h-[56px] border-border-4 text-[16px] text-text-1">
                  <SelectValue placeholder="Select team size" />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_SIZES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {profile.teamSize ? (
                  <span>{labelFor(TEAM_SIZES, profile.teamSize)}</span>
                ) : (
                  <span className="text-text-3">Not set</span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Plan</p>
            <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1 capitalize">
              {profile.plan}
            </div>
          </div>
        </div>

        {/* Budget row.
            - Company Monthly Budget: admin-set target (org_settings).
              Editable in edit mode; 0 = "no target set". Sub-line
              shows the seuvent of per-team + per-member caps so the
              admin can sanity-check that allocation lines up with
              intent.
            - Spent / Remaining: comparison against the target. With
              no target the right-hand value falls back to "—" so the
              card doesn't pretend at math it can't do.
            - Projected: linear extrapolation already on the rollup
              data; pill goes red when target is set and projected
              exceeds it. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">
              Company Monthly Budget
            </p>
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
                  placeholder="No target"
                  disabled={isSaving}
                  className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {hasTarget ? (
                  <span>{formatCurrency(target)}</span>
                ) : (
                  <span className="text-text-3">No target set</span>
                )}
              </div>
            )}
            <p className="text-[12px] text-text-3">
              Allocated across teams + members:{" "}
              <strong className="text-text-2">
                {formatCurrency(allocated)}
              </strong>
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">
                {formatCurrency(spent)} /{" "}
                {hasTarget
                  ? remaining > 0
                    ? formatCurrency(remaining)
                    : formatCurrency(0)
                  : "—"}
              </span>
              {hasTarget && (
                <div className="flex items-center h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
                  <div
                    className={`h-full shrink-0 ${remaining < 0 ? "bg-danger-5" : "bg-success-2"}`}
                    style={{ width: `${pct}%` }}
                  />
                  <div className="h-full flex-1 bg-bg-white" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-text-3" />
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              {hasTarget && (
                <span
                  className={`rounded-lg px-2 py-1 text-[13px] ${
                    onTrack
                      ? "bg-success-1 text-text-1"
                      : "bg-danger-1 text-danger-6"
                  }`}
                >
                  {onTrack ? "On track" : "Over Budget"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Admins */}
      <div className="space-y-3">
        <p className="text-[18px] font-bold text-text-1">Admins</p>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Email</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => {
                  const display = admin.name ?? admin.email;
                  return (
                    <tr key={admin.id} className="h-14">
                      <td className="bg-bg-white px-4 align-middle w-[300px]">
                        <div className="flex items-center gap-2.5">
                          {admin.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={admin.picture}
                              alt={display}
                              referrerPolicy="no-referrer"
                              className="h-6 w-6 rounded-full object-cover border border-border-2"
                            />
                          ) : (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-3 text-[10px] font-semibold text-text-3">
                              {display.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-[16px] text-text-1 whitespace-nowrap">{display}</span>
                        </div>
                      </td>
                      <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                        {admin.email}
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
                              {/* Removing admins from this screen is
                                  intentionally blocked — the action
                                  is destructive and there's no
                                  fall-back path here for transferring
                                  ownership. Demote them to advanced
                                  on the Users tab first, then remove. */}
                              <DropdownMenuItem
                                disabled
                                className="gap-2 text-danger-6 focus:text-danger-6"
                                onSelect={(e) => e.preventDefault()}
                                title="Admins can't be removed from here. Demote them to a non-admin role on the Users tab first."
                              >
                                <UserX className="h-4 w-4" />
                                Remove admin
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {admins.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3"
                    >
                      No admins yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Other participants — non-admin org users. Read-only on
          everything, but visible here so an admin sees the full
          roster of the company without flipping to the Users tab. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Other participants</p>
          {isAdmin ? (
            <InviteUserDialog>
              <Button variant="plusAction" className="rounded-lg">
                <Plus className="h-4 w-4 text-text-white" />
                Invite User
              </Button>
            </InviteUserDialog>
          ) : (
            <DisabledReasonTooltip
              disabled
              reason="Only admins can invite users"
            >
              <Button
                variant="plusAction"
                className="rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />
                Invite User
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Email</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[120px]">Role</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((u) => {
                  const display = u.name ?? u.email;
                  const badgeClass =
                    u.role === "advanced"
                      ? "border-transparent bg-primary-1 text-primary-7 uppercase tracking-wide text-[10px] px-1.5 py-0"
                      : "border-transparent bg-bg-3 text-text-2 uppercase tracking-wide text-[10px] px-1.5 py-0";
                  return (
                    <tr key={u.id} className="h-14">
                      <td className="bg-bg-white px-4 align-middle w-[300px]">
                        <div className="flex items-center gap-2.5">
                          {u.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={u.picture}
                              alt={display}
                              referrerPolicy="no-referrer"
                              className="h-6 w-6 rounded-full object-cover border border-border-2"
                            />
                          ) : (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-3 text-[10px] font-semibold text-text-3">
                              {display.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-[16px] text-text-1 whitespace-nowrap">
                            {display}
                          </span>
                        </div>
                      </td>
                      <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                        {u.email}
                      </td>
                      <td className="bg-bg-white px-4 align-middle w-[120px]">
                        <Badge className={badgeClass}>{u.role}</Badge>
                      </td>
                      <td className="bg-bg-white px-4 align-middle w-[93px]">
                        <div className="flex justify-center">
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
                                disabled={
                                  !isAdmin || removeUserMutation.isPending
                                }
                                onSelect={(e) => {
                                  if (!isAdmin) {
                                    e.preventDefault();
                                    return;
                                  }
                                  setPendingRemoveUser(u);
                                }}
                              >
                                <UserX className="h-4 w-4" />
                                Remove user
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {participants.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3"
                    >
                      No participants yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Primary Guardrails — DEMO data, awaiting org-level guardrails BE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Primary Guardrails</p>
          <Button variant="plusAction" className="rounded-lg w-[155px]">
            <Plus className="h-4 w-4 text-text-white" />
            Add Guardrail
          </Button>
        </div>
        <div className="bg-bg-white rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Type</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Severity</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Triggers</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[167px]">Status</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {guardrails.map((g) => (
                  <tr key={g.id} className="h-14 border-b border-border-2">
                    <td className="px-4 align-middle">
                      <span className="text-[16px] text-text-1 whitespace-nowrap">{g.name}</span>
                    </td>
                    <td className="px-4 align-middle">
                      <div className="flex gap-2.5">
                        {g.types.map((t) => (
                          <span key={t} className="rounded-lg bg-bg-2 px-2 py-1 text-[13px] text-text-3 whitespace-nowrap">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 align-middle">
                      <span className="rounded-lg bg-bg-1 px-2 py-1 text-[13px] text-text-3">
                        {g.severity}
                      </span>
                    </td>
                    <td className="px-4 align-middle text-[16px] text-text-1">
                      {g.triggers.toLocaleString()}
                    </td>
                    <td className="px-4 align-middle w-[167px]">
                      <div className="flex items-center gap-2.5">
                        <Switch checked={g.active} onCheckedChange={() => toggleGuardrail(g.id)} />
                        <span className="text-[16px] text-text-1 whitespace-nowrap">{g.active ? "Active" : "Inactive"}</span>
                      </div>
                    </td>
                    <td className="px-4 align-middle w-[93px]">
                      <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1">
                              <MoreVertical className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2">
                              <Pencil className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem className="gap-2 text-danger-6 focus:text-danger-6">
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Per-user remove confirmation. Same Dialog shell the rest of
          this tab uses (Delete company below, Reset profile would
          have been here too) so the destructive flow looks like one
          family of actions instead of half of them firing the bare
          browser confirm(). Mirrors /users/[id]'s "Remove user"
          dialog. */}
      <Dialog
        open={!!pendingRemoveUser}
        onOpenChange={(open) => !open && setPendingRemoveUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove user</DialogTitle>
            <DialogDescription>
              Remove{" "}
              <strong>
                {pendingRemoveUser?.name ?? pendingRemoveUser?.email}
              </strong>{" "}
              from the organization? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingRemoveUser(null)}
              disabled={removeUserMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemoveUser) {
                  removeUserMutation.mutate(pendingRemoveUser.id);
                }
              }}
              disabled={removeUserMutation.isPending}
            >
              {removeUserMutation.isPending ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete-company confirmation. Tear-down is broad (every team,
          team-scoped integration, and onboarding profile org-wide),
          so the dialog enumerates the impact and gates the destructive
          button behind a type-to-confirm match against the company
          name. User accounts themselves stay alive — see the BE
          OnboardingService.deleteCompany comment for the exact scope. */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteOpen(false);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-danger-6">Delete company</DialogTitle>
            <DialogDescription>
              This permanently tears down the workspace for{" "}
              <strong>{companyDisplay}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-danger-3 bg-danger-1/40 px-4 py-3 space-y-2">
              <p className="text-[13px] font-semibold text-danger-6">
                What will be deleted:
              </p>
              <ul className="list-disc pl-5 text-[13px] text-text-1 space-y-1">
                <li>
                  All <strong>{teams.length}</strong> team
                  {teams.length === 1 ? "" : "s"} (including sub-teams,
                  members, projects, and team-shared API keys)
                </li>
                <li>
                  Company profile (name, industry, team size) on every
                  user — <strong>{orgUsers.length}</strong>{" "}
                  account{orgUsers.length === 1 ? "" : "s"} will be sent
                  back through onboarding on next login
                </li>
              </ul>
              <p className="text-[13px] font-semibold text-danger-6 pt-2">
                What stays:
              </p>
              <ul className="list-disc pl-5 text-[13px] text-text-1 space-y-1">
                <li>
                  All user accounts, roles, plans, and personal API keys
                </li>
                <li>Personal chats, conversations, and projects</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="company-delete-confirm"
                className="text-[13px] text-text-1"
              >
                Type{" "}
                <span className="font-mono font-semibold">
                  {companyDisplay}
                </span>{" "}
                to confirm:
              </label>
              <input
                id="company-delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={companyDisplay}
                disabled={deleteCompanyMutation.isPending}
                className="w-full h-10 rounded border border-border-4 bg-transparent px-3 text-[14px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <p className="text-[12px] text-text-3">
              This action cannot be undone.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setConfirmDeleteOpen(false);
                setDeleteConfirmText("");
              }}
              disabled={deleteCompanyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteCompanyMutation.mutate()}
              disabled={
                deleteCompanyMutation.isPending ||
                deleteConfirmText.trim() !== companyDisplay
              }
            >
              {deleteCompanyMutation.isPending
                ? "Deleting..."
                : "Delete company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
