"use client";

import { useEffect, useState } from "react";
import {
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
  fetchOnboardingProfile,
  fetchOrgUsers,
  fetchTeams,
  updateOnboardingProfile,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

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

  const [isEditing, setIsEditing] = useState(false);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editIndustry, setEditIndustry] = useState("");
  const [editTeamSize, setEditTeamSize] = useState("");
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

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
  const resetMutation = useMutation({
    mutationFn: () =>
      updateOnboardingProfile({
        companyName: profile?.companyName ?? "",
        industry: "",
        teamSize: "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-profile"] });
      toast.success("Company profile reset.");
      setConfirmResetOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Couldn't reset company.");
    },
  });

  const editing = isAdmin && isEditing;
  const isSaving = updateMutation.isPending;

  const enterEdit = () => {
    if (!profile) return;
    setEditCompanyName(profile.companyName ?? "");
    setEditIndustry(profile.industry ?? "");
    setEditTeamSize(profile.teamSize ?? "");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditCompanyName("");
    setEditIndustry("");
    setEditTeamSize("");
  };

  const confirmEdit = async () => {
    if (!profile) return;
    const trimmedName = editCompanyName.trim();
    if (!trimmedName) {
      toast.error("Company name cannot be empty.");
      return;
    }

    const nameChanged = trimmedName !== (profile.companyName ?? "");
    const industryChanged = editIndustry !== (profile.industry ?? "");
    const teamSizeChanged = editTeamSize !== (profile.teamSize ?? "");
    if (!nameChanged && !industryChanged && !teamSizeChanged) {
      setIsEditing(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        ...(nameChanged ? { companyName: trimmedName } : {}),
        ...(industryChanged ? { industry: editIndustry } : {}),
        ...(teamSizeChanged ? { teamSize: editTeamSize } : {}),
      });
      toast.success("Company profile updated.");
      queryClient.invalidateQueries({ queryKey: ["onboarding-profile"] });
      setIsEditing(false);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't update company.");
    }
  };

  // Same window-event hook future-proofs us if the appbar grows a
  // Pencil/Trash2 slot for this tab. MUST stay above early returns so
  // hook count is stable across loading transitions.
  useEffect(() => {
    const onEdit = () => enterEdit();
    const onDelete = () => setConfirmResetOpen(true);
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

  // Org-wide rollups. Per-user spentCents covers personal projects +
  // arena; per-team spentCents covers team-routed chats. They
  // partition the org's spend so summing them is safe.
  const totalBudgetCents =
    teams.reduce((acc, t) => acc + (t.monthlyBudgetCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.monthlyBudgetCents ?? 0), 0);
  const totalSpentCents =
    teams.reduce((acc, t) => acc + (t.spentCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.spentCents ?? 0), 0);
  const totalProjectedCents =
    teams.reduce((acc, t) => acc + (t.projectedCents ?? 0), 0) +
    orgUsers.reduce((acc, u) => acc + (u.projectedCents ?? 0), 0);

  const budget = totalBudgetCents / 100;
  const spent = totalSpentCents / 100;
  const remaining = budget - spent;
  const projected = totalProjectedCents / 100;
  const onTrack = projected <= budget;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  const admins = orgUsers.filter((u) => u.role === "admin");
  const companyDisplay = profile.companyName?.trim() || "Unnamed company";

  return (
    <div className="py-6 space-y-6">
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
                    onClick={() => setConfirmResetOpen(true)}
                    title="Reset industry / team size"
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

        {/* Budget aggregate row — derived from existing teams + users
            data, no separate org-level cap. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Total Budget</p>
            <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
              {budget > 0 ? (
                <span>{formatCurrency(budget)}</span>
              ) : (
                <span className="text-text-3">No budgets configured</span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">
                {formatCurrency(spent)} /{" "}
                {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}
              </span>
              <div className="flex items-center h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
                <div
                  className={`h-full shrink-0 ${remaining < 0 ? "bg-danger-5" : "bg-success-2"}`}
                  style={{ width: `${pct}%` }}
                />
                <div className="h-full flex-1 bg-bg-white" />
              </div>
            </div>
          </div>

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
                              <DropdownMenuItem className="gap-2 text-danger-6 focus:text-danger-6">
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

      {/* Reset confirmation. Trash2 only blanks out industry + team
          size — companyName stays so the workspace doesn't become
          unidentifiable. */}
      <Dialog
        open={confirmResetOpen}
        onOpenChange={(open) => !open && setConfirmResetOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset profile fields</DialogTitle>
            <DialogDescription>
              This clears the industry and team size for{" "}
              <strong>{companyDisplay}</strong>. Admins, teams, and budgets
              are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmResetOpen(false)}
              disabled={resetMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {resetMutation.isPending ? "Resetting..." : "Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
