"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { PersonalProfileNotice } from "@/components/personal-profile-notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Pagination } from "@/components/ui/pagination";
import { useAuth } from "@/components/providers";
import {
  deleteCompanyProfile,
  fetchGuardrailItems,
  fetchOnboardingProfile,
  fetchOrgSettings,
  fetchOrgUsers,
  fetchTeams,
  removeOrgUser,
  toggleGuardrailItem,
  toggleGuardrailOrgWide,
  updateOnboardingProfile,
  updateOrgSettings,
  type OrgUser,
} from "@/lib/api";
import { formatBudgetInput, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import {
  DisabledReasonTooltip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLanguage } from "@/lib/i18n";
import { buildIndustries, TEAM_SIZES, labelFor } from "@/lib/profile-options";
import { severityLabel } from "@/lib/guardrails";
import { getPlanDetails } from "@/lib/plan";

// Row view-model for the Primary Guardrails table — a thin projection
// of the real `GuardrailItem` from /guardrails-section so the existing
// markup (name + type chips + severity + triggers + status) renders
// unchanged.
interface CompanyGuardrail {
  id: string;
  name: string;
  types: string[];
  severity: "high" | "medium" | "low";
  triggers: number;
  active: boolean;
}

/**
 * "Add Guardrail" picker for the Company tab — mirrors the team-detail
 * dialog: pick an existing rule from a dropdown and apply it. On a
 * team that means assignGuardrailToTeam; the company equivalent is
 * flipping the rule Org-wide (toggleGuardrailOrgWide), which makes it
 * apply to every chat in the company and surfaces it in this list.
 * Candidates are rules that aren't already org-wide.
 */
function CompanyAddGuardrailDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const qc = useQueryClient();

  const { data: allGuardrails = [], isLoading } = useQuery({
    queryKey: ["guardrails-section"],
    queryFn: fetchGuardrailItems,
    enabled: open,
  });

  const candidates = allGuardrails.filter((g) => !g.isOrgWide);

  const mutation = useMutation({
    mutationFn: () => toggleGuardrailOrgWide(selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardrails-section"] });
      // Team listings show org-wide rules too — keep them in sync.
      qc.invalidateQueries({ queryKey: ["guardrails"] });
      toast.success(t("mgmt.company.guardrailAddedToCompany"));
      setOpen(false);
      setSelectedId("");
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.company.guardrailAddFailed")),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSelectedId("");
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("mgmt.company.addGuardrail")}</DialogTitle>
          <DialogDescription>
            {t("mgmt.company.addGuardrailDesc")}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-[14px] text-text-3">
              {t("mgmt.company.noGuardrailsAvailable")}
            </p>
            <Link
              href="/teams?tab=guardrails"
              className="text-[13px] font-medium text-primary-6 hover:text-primary-7"
            >
              {t("mgmt.company.createOnGuardrails")}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("mgmt.company.guardrail")}</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="border-border-2 text-text-1 cursor-pointer">
                  <SelectValue
                    placeholder={t("mgmt.company.selectGuardrail")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name} — {g.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                onClick={() => mutation.mutate()}
                disabled={!selectedId || mutation.isPending}
                className="cursor-pointer bg-primary-6 hover:bg-primary-7"
              >
                {mutation.isPending
                  ? t("mgmt.company.assigning")
                  : t("mgmt.company.assignGuardrail")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CompanyTab() {
  const { t } = useLanguage();
  const INDUSTRIES = buildIndustries(t);
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

  // Primary Guardrails = the company-wide (org-wide) rules from the
  // real /guardrails-section API. Adding a guardrail here flips an
  // existing rule Org-wide; removing it flips Org-wide back off — the
  // same select-to-attach / detach model the team-detail page uses,
  // just scoped to the whole company instead of one team.
  const { data: guardrailItems = [] } = useQuery({
    queryKey: ["guardrails-section"],
    queryFn: fetchGuardrailItems,
  });
  const guardrails = useMemo<CompanyGuardrail[]>(
    () =>
      guardrailItems
        .filter((g) => g.isOrgWide)
        .map((g) => ({
          id: g.id,
          name: g.name,
          // `type` is the rule category; `target` (input/output) is
          // shown as a second chip when present, mirroring the old
          // two-chip demo layout.
          types: g.target ? [g.type, g.target] : [g.type],
          severity: g.severity,
          triggers: g.triggers,
          active: g.isActive,
        })),
    [guardrailItems],
  );

  const toggleGuardrailMutation = useMutation({
    mutationFn: toggleGuardrailItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardrails-section"] });
      // isActive is global — refresh team-detail listings too so their
      // status badge doesn't go stale (same as the remove mutation).
      queryClient.invalidateQueries({ queryKey: ["guardrails"] });
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.company.guardrailToggleFailed")),
  });
  // "Remove from company" = flip the rule's Org-wide flag off. The
  // guardrail itself is kept (matching the team page's "remove from
  // team", which detaches rather than deletes); full deletion lives
  // on /guardrails.
  const removeFromCompanyMutation = useMutation({
    mutationFn: toggleGuardrailOrgWide,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardrails-section"] });
      queryClient.invalidateQueries({ queryKey: ["guardrails"] });
      toast.success(t("mgmt.company.guardrailRemovedFromCompany"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.company.guardrailRemoveFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: updateOnboardingProfile,
  });
  const updateBudgetMutation = useMutation({
    mutationFn: updateOrgSettings,
  });
  const webSearchMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      updateOrgSettings({ webSearchEnabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      toast.success(t("mgmt.company.webSearchSaved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.company.webSearchFailed")),
  });
  const arsoMutation = useMutation({
    mutationFn: (enabled: boolean) => updateOrgSettings({ arsoEnabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      toast.success(t("mgmt.company.arsoSaved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("mgmt.company.arsoFailed")),
  });
  const removeUserMutation = useMutation({
    mutationFn: (userId: string) => removeOrgUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      toast.success(t("mgmt.company.userRemoved"));
      setPendingRemoveUser(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || t("mgmt.company.couldntRemoveUser"));
      setPendingRemoveUser(null);
    },
  });
  const deleteCompanyMutation = useMutation({
    mutationFn: deleteCompanyProfile,
    onSuccess: (result) => {
      const teamWord = result.deletedTeamCount === 1
        ? t("mgmt.company.deletedToastTeam")
        : t("mgmt.company.deletedToastTeams");
      const userWord = result.affectedUserCount === 1
        ? t("mgmt.company.deletedToastUser")
        : t("mgmt.company.deletedToastUsers");
      toast.success(
        `${t("mgmt.company.deletedToastPrefix")} ${result.deletedTeamCount} ${teamWord}; ${result.affectedUserCount} ${userWord} ${t("mgmt.company.deletedToastSuffix")}`,
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
      toast.error(err.message || t("mgmt.company.couldntDelete"));
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
    // Seed the budget editor from the current org-settings row.
    //   - null → empty input (= "no target")
    //   - 0    → "0,00" (= explicit suspend; admin sees their kill
    //     switch and can clear it back)
    //   - >0   → formatted currency value
    const seedBudgetCents = orgSettings?.monthlyBudgetCents ?? null;
    setEditBudget(
      seedBudgetCents === null
        ? ""
        : (seedBudgetCents / 100).toLocaleString("de-DE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
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
      toast.error(t("mgmt.company.companyNameEmpty"));
      return;
    }

    // Parse de-DE budget: "1.234,56" → 1234.56.
    //   empty input → null  (clear the target, no enforcement)
    //   "0"         → 0     (explicit org-wide suspend)
    //   "$X"        → cents (enforced)
    let parsedBudgetCents: number | null;
    const trimmedBudget = editBudget.trim();
    if (trimmedBudget.length === 0) {
      parsedBudgetCents = null;
    } else {
      const raw = trimmedBudget.replace(/\./g, "").replace(",", ".");
      const num = parseFloat(raw);
      if (!Number.isFinite(num) || num < 0) {
        toast.error(t("mgmt.company.budgetNonNegative"));
        return;
      }
      parsedBudgetCents = Math.round(num * 100);
    }

    const nameChanged = trimmedName !== (profile.companyName ?? "");
    const industryChanged = editIndustry !== (profile.industry ?? "");
    const teamSizeChanged = editTeamSize !== (profile.teamSize ?? "");
    const budgetChanged =
      parsedBudgetCents !== (orgSettings?.monthlyBudgetCents ?? null);
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
            toast.error(err.message || t("mgmt.company.couldntUpdateProfile"));
            throw err;
          }),
      );
    }
    if (budgetChanged) {
      tasks.push(
        updateBudgetMutation
          .mutateAsync({ monthlyBudgetCents: parsedBudgetCents })
          .catch((err: Error) => {
            toast.error(err.message || t("mgmt.company.couldntUpdateBudget"));
            throw err;
          }),
      );
    }

    const results = await Promise.allSettled(tasks);
    queryClient.invalidateQueries({ queryKey: ["onboarding-profile"] });
    queryClient.invalidateQueries({ queryKey: ["org-settings"] });
    if (results.every((r) => r.status === "fulfilled")) {
      toast.success(t("mgmt.company.updated"));
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

  // Page the participants table — admins is usually small enough to
  // skip. State must live above the loading / error / non-company
  // early returns to satisfy the Rules of Hooks; the slice operates
  // on an empty array until orgUsers resolves and is harmless.
  const PARTICIPANTS_PAGE_SIZE = 10;
  const [participantsPage, setParticipantsPage] = useState(1);
  const participantsCount = orgUsers.filter((u) => u.role !== "admin").length;
  const participantsTotalPages = Math.max(
    1,
    Math.ceil(participantsCount / PARTICIPANTS_PAGE_SIZE),
  );
  useEffect(() => {
    if (participantsPage > participantsTotalPages) {
      setParticipantsPage(participantsTotalPages);
    }
  }, [participantsPage, participantsTotalPages]);

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
        <p className="text-text-3">{t("mgmt.company.failedLoad")}</p>
      </div>
    );
  }

  // Personal-profile users get a clear empty state instead of an
  // editor that would silently no-op (BE rejects PATCH with 400). The
  // Account tab has the same wording for parity.
  if (profile.profileType !== "company") {
    return <PersonalProfileNotice message={t("mgmt.company.personalOnly")} />;
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

  // Company-level monthly target sourced from /org-settings. Tri-state:
  //   - null → no target (UI hides budget-comparison affordances and
  //     falls back to plain spend reporting; chat-transport gate is
  //     a silent pass).
  //   - 0    → org-wide chat suspended (the kill switch matches team
  //     and per-member 0-semantics).
  //   - >0   → enforced.
  const targetCents = orgSettings?.monthlyBudgetCents ?? null;
  const isSuspended = targetCents === 0;
  const hasTarget = targetCents !== null && targetCents > 0;

  const target = (targetCents ?? 0) / 100;
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
  const pagedParticipants = participants.slice(
    (participantsPage - 1) * PARTICIPANTS_PAGE_SIZE,
    participantsPage * PARTICIPANTS_PAGE_SIZE,
  );
  const companyDisplay = profile.companyName?.trim() || t("mgmt.company.unnamedCompany");

  // Tri-state company target → `null` means an admin has never set a
  // cap; chat passes silently, every spend/projected affordance on
  // this tab is hidden, and the admin gets no implicit prompt that
  // this exists. Surface it with a warning banner (same palette as
  // the users-tab "awaiting budget approval" prompt) so the action
  // is one click away from where they'd hand-roll it via the Pencil.
  // Admin-only — non-admins can't mutate org settings and seeing
  // this would just be noise.
  const companyBudgetUnset = targetCents === null && isAdmin;

  return (
    <div className="py-6 space-y-6">
      {/* Org-wide web search capability. Admin-only. When on, teams can
          override per-team and projects can flip the per-project switch.
          When off, the project toggle is hidden. */}
      {isAdmin && (
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white p-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[14px] font-semibold text-text-1">
              {t("mgmt.company.webSearchTitle")}
            </h3>
            <p className="text-[12px] text-text-3">
              {t("mgmt.company.webSearchDesc")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!orgSettings?.webSearchEnabled}
            disabled={webSearchMutation.isPending}
            onClick={() =>
              webSearchMutation.mutate(!orgSettings?.webSearchEnabled)
            }
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              orgSettings?.webSearchEnabled ? "bg-primary-6" : "bg-border-3"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                orgSettings?.webSearchEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </section>
      )}

      {/* Org-wide ARSO environmental-data tools. Admin-only, keyless,
          company-wide (no team/project override). When on, the chat AI can
          call ARSO weather / air-quality / water-level tools. */}
      {isAdmin && (
        <section className="flex items-center justify-between gap-4 rounded-lg border border-border-2 bg-bg-white p-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[14px] font-semibold text-text-1">
              {t("mgmt.company.arsoTitle")}
            </h3>
            <p className="text-[12px] text-text-3">
              {t("mgmt.company.arsoDesc")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!orgSettings?.arsoEnabled}
            disabled={arsoMutation.isPending}
            onClick={() => arsoMutation.mutate(!orgSettings?.arsoEnabled)}
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              orgSettings?.arsoEnabled ? "bg-primary-6" : "bg-border-3"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                orgSettings?.arsoEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </section>
      )}

      {/* "No company budget set" prompt. Warning palette
          (border-warning-7/30 bg-warning-1) matches the per-user
          equivalent on /teams?tab=users so the two prompts read as
          a pair. Action button drops the admin into the same edit
          mode the Pencil button does. Distinct from the danger-red
          Suspended ($0) banner below: $0 is a deliberate kill switch
          the admin chose; `null` means they never set anything. */}
      {companyBudgetUnset && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-warning-7/30 bg-warning-1 px-4 py-3">
          <p className="text-[13px] text-text-1">
            <strong className="font-semibold">
              {t("mgmt.company.noBudgetBanner")}
            </strong>{" "}
            {t("mgmt.company.noBudgetBannerDesc")}
          </p>
          <Button
            type="button"
            onClick={enterEdit}
            disabled={isEditing}
            className="shrink-0 h-8 bg-warning-7 text-white hover:bg-warning-7/90"
          >
            {t("mgmt.company.setBudget")}
          </Button>
        </div>
      )}

      {/* Suspended banner — separate from over-budget because the
          fix is different (admin set a $0 kill switch on purpose;
          they need to clear it, not raise other caps). Shown when
          the explicit suspend value is in play. */}
      {isSuspended && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-3 bg-danger-1/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger-6 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-[14px] font-semibold text-danger-6">
              {t("mgmt.company.chatPaused")}
            </p>
            <p className="text-[13px] text-text-1">
              {t("mgmt.company.suspendedPrefix")}{" "}
              <strong>$0</strong>
              {t("mgmt.company.suspendedMiddle")}{" "}
              {isAdmin
                ? t("mgmt.company.suspendedAdmin")
                : t("mgmt.company.suspendedUser")}
            </p>
          </div>
        </div>
      )}

      {/* Over-budget banner. Shows when admin has set a positive
          target and either current spend or projected spend exceeds
          it. Sits above every other card so it's the first thing the
          admin reads when they enter the tab. */}
      {overBudget && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-3 bg-danger-1/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger-6 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-[14px] font-semibold text-danger-6">
              {t("mgmt.company.overBudgetTitle")}
            </p>
            <p className="text-[13px] text-text-1">
              {spent > target ? (
                <>
                  {t("mgmt.company.spentOf")} <strong>{formatCurrency(spent)}</strong> {t("mgmt.company.of")}{" "}
                  <strong>{formatCurrency(target)}</strong> {t("mgmt.company.monthlyTarget")}
                </>
              ) : (
                <>
                  {t("mgmt.company.projectedPrefix")} <strong>{formatCurrency(projected)}</strong>{" "}
                  {t("mgmt.company.byMonthEnd")} <strong>{formatCurrency(target)}</strong>
                  {t("mgmt.company.targetSuffix")}
                </>
              )}{" "}
              {isAdmin
                ? t("mgmt.company.overAdmin")
                : t("mgmt.company.overUser")}
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
                  placeholder={t("mgmt.company.companyNamePlaceholder")}
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
                  {t("mgmt.company.cancel")}
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
                  {t("mgmt.company.confirm")}
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
                    title={t("mgmt.company.editTitle")}
                  >
                    <Pencil className="h-6 w-6" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-success-7 hover:text-success-7/80"
                    onClick={() => setConfirmDeleteOpen(true)}
                    title={t("mgmt.company.deleteTitle")}
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
            <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.industry")}</p>
            {editing ? (
              <Select value={editIndustry || undefined} onValueChange={setEditIndustry}>
                <SelectTrigger className="h-[56px] border-border-4 text-[16px] text-text-1">
                  <SelectValue placeholder={t("mgmt.company.selectIndustry")} />
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
                  <span className="text-text-3">{t("mgmt.company.notSet")}</span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.teamSize")}</p>
            {editing ? (
              <Select value={editTeamSize || undefined} onValueChange={setEditTeamSize}>
                <SelectTrigger className="h-[56px] border-border-4 text-[16px] text-text-1">
                  <SelectValue placeholder={t("mgmt.company.selectTeamSize")} />
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
                  <span className="text-text-3">{t("mgmt.company.notSet")}</span>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.plan")}</p>
            <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
              {getPlanDetails(profile.plan, t).label}
            </div>
          </div>
        </div>

        {/* Budget row.
            - Company Monthly Budget: admin-set target (org_settings).
              Tri-state: null = "no target set", 0 = org-wide
              suspend (kill switch), >0 = enforced. Sub-line shows
              the sum of per-team + per-member caps so the admin can
              sanity-check that allocation lines up with intent.
            - Spent / Remaining: comparison against the target. With
              no target the right-hand value falls back to "—" so the
              card doesn't pretend at math it can't do.
            - Projected: linear extrapolation already on the rollup
              data; pill goes red when target is set and projected
              exceeds it. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">
              {t("mgmt.company.companyMonthlyBudget")}
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
                  placeholder={t("mgmt.company.noTarget")}
                  disabled={isSaving}
                  className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {isSuspended ? (
                  <span className="text-danger-6">{t("mgmt.company.suspended$0")}</span>
                ) : hasTarget ? (
                  <span>{formatCurrency(target)}</span>
                ) : (
                  <span className="text-text-3">{t("mgmt.company.noTargetSet")}</span>
                )}
              </div>
            )}
            <p className="text-[12px] text-text-3">
              {t("mgmt.company.allocatedAcross")}{" "}
              <strong className="text-text-2">
                {formatCurrency(allocated)}
              </strong>
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.spentRemaining")}</p>
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
              <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.projected")}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("mgmt.company.projectedTooltipAria")}
                    className="flex items-center justify-center text-text-3 hover:text-text-1"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                  {t("mgmt.company.projectedTooltipDesc")}
                </TooltipContent>
              </Tooltip>
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
                  {onTrack ? t("mgmt.company.onTrack") : t("mgmt.company.overBudget")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Admins */}
      <div className="space-y-3">
        <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.admins")}</p>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">{t("mgmt.company.colName")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colEmail")}</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("mgmt.company.colActions")}</th>
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
                                title={t("mgmt.company.removeAdminBlocked")}
                              >
                                <UserX className="h-4 w-4" />
                                {t("mgmt.company.removeAdmin")}
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
                      {t("mgmt.company.noAdmins")}
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
          <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.otherParticipants")}</p>
          {isAdmin ? (
            <InviteUserDialog>
              <Button variant="plusAction" className="rounded-lg">
                <Plus className="h-4 w-4 text-text-white" />
                {t("mgmt.company.inviteUser")}
              </Button>
            </InviteUserDialog>
          ) : (
            <DisabledReasonTooltip
              disabled
              reason={t("mgmt.company.inviteAdminOnly")}
            >
              <Button
                variant="plusAction"
                className="rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />
                {t("mgmt.company.inviteUser")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">{t("mgmt.company.colName")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colEmail")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[120px]">{t("mgmt.company.colRole")}</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("mgmt.company.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedParticipants.map((u) => {
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
                                {t("mgmt.company.removeUser")}
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
                      {t("mgmt.company.noParticipants")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={participantsPage}
            totalPages={participantsTotalPages}
            onPageChange={setParticipantsPage}
            className="px-4"
          />
        </div>
      </div>

      {/* Primary Guardrails — company-wide (org-wide) rules from
          /guardrails-section. Add picks an existing rule and flips it
          Org-wide; the row toggle flips global active; the row menu
          removes it from the company (Org-wide off). Same select-to-
          attach model as the team-detail page. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">{t("mgmt.company.primaryGuardrails")}</p>
          {isAdmin ? (
            <CompanyAddGuardrailDialog>
              <Button variant="plusAction" className="rounded-lg w-[155px]">
                <Plus className="h-4 w-4 text-text-white" />
                {t("mgmt.company.addGuardrail")}
              </Button>
            </CompanyAddGuardrailDialog>
          ) : (
            // Basic / advanced users see the button disabled with a
            // tooltip — matches the Invite User pattern above and the
            // team-detail Add Guardrail gate, so the affordance stays
            // visible (signals the feature exists) without letting
            // non-admins fire a no-op that the BE would reject anyway.
            <DisabledReasonTooltip
              disabled
              reason={t("mgmt.company.addGuardrailAdminOnly")}
            >
              <Button
                variant="plusAction"
                className="rounded-lg w-[155px] disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />
                {t("mgmt.company.addGuardrail")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        <div className="bg-bg-white rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colName")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colType")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colSeverity")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("mgmt.company.colTriggers")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[167px]">{t("mgmt.company.colStatus")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("mgmt.company.colActions")}</th>
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
                        {severityLabel(g.severity, t)}
                      </span>
                    </td>
                    <td className="px-4 align-middle text-[16px] text-text-1">
                      {g.triggers.toLocaleString()}
                    </td>
                    <td className="px-4 align-middle w-[167px]">
                      <div className="flex items-center gap-2.5">
                        {/* Same admin gate as Add Guardrail: non-admins
                            see the toggle but can't flip it, and the
                            tooltip explains why. Keeps the row's
                            status legible for everyone. */}
                        {isAdmin ? (
                          <Switch
                            checked={g.active}
                            disabled={toggleGuardrailMutation.isPending}
                            onCheckedChange={() =>
                              toggleGuardrailMutation.mutate(g.id)
                            }
                          />
                        ) : (
                          <DisabledReasonTooltip
                            disabled
                            reason={t("mgmt.company.toggleAdminOnly")}
                          >
                            <Switch
                              checked={g.active}
                              disabled
                              className="opacity-50 cursor-not-allowed"
                            />
                          </DisabledReasonTooltip>
                        )}
                        <span className="text-[16px] text-text-1 whitespace-nowrap">{g.active ? t("mgmt.company.active") : t("mgmt.company.inactive")}</span>
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
                            {/* Disabled item rather than hiding the
                                kebab — keeps the affordance discoverable
                                for non-admins, tooltip explains the gate.
                                "Remove from company" detaches (Org-wide
                                off); the rule itself stays in /guardrails. */}
                            <DropdownMenuItem
                              className="gap-2 text-danger-6 focus:text-danger-6"
                              disabled={
                                !isAdmin || removeFromCompanyMutation.isPending
                              }
                              title={
                                isAdmin ? undefined : t("mgmt.company.deleteAdminOnly")
                              }
                              onSelect={(e) => {
                                if (!isAdmin) {
                                  e.preventDefault();
                                  return;
                                }
                                removeFromCompanyMutation.mutate(g.id);
                              }}
                            >
                              <UserX className="h-4 w-4" />
                              {t("mgmt.company.removeFromCompany")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {guardrails.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-[16px] text-text-3"
                    >
                      {t("mgmt.company.noGuardrails")}
                    </td>
                  </tr>
                )}
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
            <DialogTitle>{t("mgmt.company.removeUser")}</DialogTitle>
            <DialogDescription>
              {t("mgmt.company.removeUserDesc1")}{" "}
              <strong>
                {pendingRemoveUser?.name ?? pendingRemoveUser?.email}
              </strong>{" "}
              {t("mgmt.company.removeUserDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingRemoveUser(null)}
              disabled={removeUserMutation.isPending}
            >
              {t("mgmt.company.cancel")}
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
              {removeUserMutation.isPending ? t("mgmt.company.removing") : t("mgmt.company.remove")}
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
            <DialogTitle className="text-danger-6">{t("mgmt.company.deleteCompany")}</DialogTitle>
            <DialogDescription>
              {t("mgmt.company.deleteCompanyDesc")}{" "}
              <strong>{companyDisplay}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-danger-3 bg-danger-1/40 px-4 py-3 space-y-2">
              <p className="text-[13px] font-semibold text-danger-6">
                {t("mgmt.company.whatDeleted")}
              </p>
              <ul className="list-disc pl-5 text-[13px] text-text-1 space-y-1">
                <li>
                  {t("mgmt.company.deletedItem1Prefix")} <strong>{teams.length}</strong>{" "}
                  {teams.length === 1 ? t("mgmt.company.deletedItem1Team") : t("mgmt.company.deletedItem1Teams")}{" "}
                  {t("mgmt.company.deletedItem1Suffix")}
                </li>
                <li>
                  {t("mgmt.company.deletedItem2Prefix")} <strong>{orgUsers.length}</strong>{" "}
                  {orgUsers.length === 1 ? t("mgmt.company.deletedItem2Account") : t("mgmt.company.deletedItem2Accounts")}{" "}
                  {t("mgmt.company.deletedItem2Suffix")}
                </li>
              </ul>
              <p className="text-[13px] font-semibold text-danger-6 pt-2">
                {t("mgmt.company.whatStays")}
              </p>
              <ul className="list-disc pl-5 text-[13px] text-text-1 space-y-1">
                <li>{t("mgmt.company.stays1")}</li>
                <li>{t("mgmt.company.stays2")}</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="company-delete-confirm"
                className="text-[13px] text-text-1"
              >
                {t("mgmt.company.typeToConfirm")}{" "}
                <span className="font-mono font-semibold">
                  {companyDisplay}
                </span>{" "}
                {t("mgmt.company.toConfirm")}
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
              {t("mgmt.company.actionCannotUndo")}
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
              {t("mgmt.company.cancel")}
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
                ? t("mgmt.company.deleting")
                : t("mgmt.company.deleteCompany")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
