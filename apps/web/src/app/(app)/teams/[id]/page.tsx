"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Pencil,
  Plus,
  Trash2,
  MoreVertical,
  UserX,
  Wallet,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DisabledReasonTooltip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/components/providers";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Pagination } from "@/components/ui/pagination";
import Link from "next/link";
import {
  fetchTeam,
  fetchSubteams,
  fetchGuardrails,
  fetchGuardrailItems,
  assignGuardrailToTeam,
  unassignGuardrailFromTeam,
  toggleGuardrailTeamActive,
  createTeam,
  updateTeam,
  deleteTeam,
  updateTeamBudget,
  updateMemberRole,
  removeTeamMember,
  fetchOrgSettings,
  type TeamMember,
  type SubteamListItem,
} from "@/lib/api";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { TeamMemberCapDialog } from "@/components/team-member-cap-dialog";
import { formatBudgetInput, formatCurrency } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n";
import { severityLabel } from "@/lib/guardrails";

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function UserAvatar({ name, picture, size = 24 }: { name: string; picture: string | null; size?: number }) {
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={picture} alt={name} referrerPolicy="no-referrer" className="rounded-full object-cover border border-border-2" style={{ width: size, height: size }} />
    );
  }
  return (
    <div className="flex items-center justify-center rounded-full bg-bg-3 text-[10px] font-semibold text-text-3 border border-border-2" style={{ width: size, height: size }}>
      {getInitials(name)}
    </div>
  );
}

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  return (
    <div className="flex items-center h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
      <div className={`h-full shrink-0 ${spent > budget ? "bg-danger-5" : "bg-success-2"}`} style={{ width: `${pct}%` }} />
      <div className="h-full flex-1 bg-bg-white" />
    </div>
  );
}

/* ─── Dialogs ────────────────────────────────────────────────────────────── */

function AddSubteamDialog({ parentTeamId, children }: { parentTeamId: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createTeam({ name: name.trim(), description: description.trim() || undefined, parentTeamId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["org-users"] });
      setOpen(false); setName(""); setDescription("");
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("teamDetail.addSubteam")}</DialogTitle>
          <DialogDescription>{t("teamDetail.addSubteamDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subteam-name">{t("teamDetail.name")}</Label>
            <Input id="subteam-name" placeholder={t("teamDetail.subteamNamePh")} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subteam-desc">{t("teamDetail.description")}</Label>
            <Textarea id="subteam-desc" placeholder={t("teamDetail.subteamDescPh")} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? t("teamDetail.creating") : t("teamDetail.createSubteam")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSubteamDialog({ sub, parentTeamId, children }: { sub: SubteamListItem; parentTeamId: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const qc = useQueryClient();

  const handleOpen = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      setName(sub.name);
      setDescription(sub.description ?? "");
      setMonthlyBudget(sub.monthlyBudgetCents ? String(sub.monthlyBudgetCents / 100) : "");
    }
  };

  const updateMutation = useMutation({
    mutationFn: () => updateTeam(sub.id, { name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["org-users"] });
      setOpen(false);
    },
  });

  const budgetMut = useMutation({
    mutationFn: (budgetUsd: number) => updateTeamBudget(sub.id, budgetUsd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateMutation.mutate();
    const budgetNum = monthlyBudget ? parseFloat(monthlyBudget) : null;
    if (budgetNum && budgetNum > 0 && budgetNum !== sub.monthlyBudgetCents / 100) {
      budgetMut.mutate(budgetNum);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("teamDetail.editSubteam")}</DialogTitle>
          <DialogDescription>{t("teamDetail.updateDesc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-name">{t("teamDetail.name")}</Label>
            <Input id="edit-subteam-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-desc">{t("teamDetail.description")}</Label>
            <Textarea id="edit-subteam-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-budget">{t("teamDetail.monthlyBudgetLabel")}</Label>
            <Input id="edit-subteam-budget" type="number" min="0" step="0.01" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? t("teamDetail.saving") : t("teamDetail.saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubteamDialog({ subId, subName, parentTeamId, children }: { subId: string; subName: string; parentTeamId: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteTeam(subId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["org-users"] });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("teamDetail.deleteSubteam")}</DialogTitle>
          <DialogDescription>
            {t("teamDetail.deleteSubteamDesc1")} <strong>{subName}</strong>{t("teamDetail.deleteSubteamDesc2")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>{t("teamDetail.cancel")}</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? t("teamDetail.deleting") : t("teamDetail.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddGuardrailDialog({ teamId, children }: { teamId: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const qc = useQueryClient();

  const { data: allGuardrails = [], isLoading } = useQuery({
    queryKey: ["guardrails-section"],
    queryFn: fetchGuardrailItems,
    enabled: open,
  });

  // Show every guardrail that's NOT already linked to this team AND
  // is not Org-wide. The M2M model means a rule can live in many
  // teams at once; Org-wide rules apply everywhere by definition so
  // there's nothing to add at the team level.
  const unassigned = allGuardrails.filter(
    (g) => !g.isOrgWide && !g.teams.some((teamRef) => teamRef.id === teamId),
  );

  const mutation = useMutation({
    mutationFn: () => assignGuardrailToTeam(selectedId, teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardrails", teamId] });
      qc.invalidateQueries({ queryKey: ["guardrails-section"] });
      setOpen(false);
      setSelectedId("");
    },
    onError: () => toast.error(t("teamDetail.failedAssign")),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSelectedId(""); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("teamDetail.addGuardrail")}</DialogTitle>
          <DialogDescription>
            {t("teamDetail.addGuardrailDesc")}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-3" />
          </div>
        ) : unassigned.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-[14px] text-text-3">{t("teamDetail.noGuardrailsAvailable")}</p>
            <Link
              href="/guardrails"
              className="text-[13px] font-medium text-primary-6 hover:text-primary-7"
            >
              {t("teamDetail.createOnGuardrails")}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("teamDetail.guardrail")}</Label>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="border-border-2 text-text-1 cursor-pointer">
                  <SelectValue placeholder={t("teamDetail.selectGuardrail")} />
                </SelectTrigger>
                <SelectContent>
                  {unassigned.map((g) => (
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
                {mutation.isPending ? t("teamDetail.assigning") : t("teamDetail.assignGuardrail")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useLanguage();
  const { user: currentUser } = useAuth();
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: team, isLoading, error } = useQuery({ queryKey: ["teams", id], queryFn: () => fetchTeam(id) });
  // Org default drives the team toggle's default state: with no explicit
  // team choice the switch reads (and reflects) the company-level value.
  const { data: orgSettings } = useQuery({ queryKey: ["org-settings"], queryFn: fetchOrgSettings });
  const { data: subteams = [] } = useQuery({ queryKey: ["subteams", id], queryFn: () => fetchSubteams(id) });
  const { data: rawGuardrails = [] } = useQuery({ queryKey: ["guardrails", id], queryFn: () => fetchGuardrails(id) });
  const guardrails = useMemo(
    () => [...rawGuardrails].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    ),
    [rawGuardrails],
  );

  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateTeamBudget(id, budgetUsd),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });
  const roleMutation = useMutation({
    mutationFn: ({
      memberId,
      role,
    }: {
      memberId: string;
      role: "admin" | "manager" | "editor" | "viewer";
    }) => updateMemberRole(id, memberId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
    onError: (err: Error) =>
      toast.error(err.message || t("teamDetail.couldntUpdateRole")),
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeTeamMember(id, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams", id] });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
      toast.success(t("teamDetail.memberRemoved"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("teamDetail.couldntRemove"));
    },
  });
  const toggleMutation = useMutation({
    mutationFn: (guardrailId: string) =>
      toggleGuardrailTeamActive(guardrailId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardrails", id] }),
    onError: (err: Error) => toast.error(err.message || t("teamDetail.failedToggle")),
  });
  const removeGuardrailMutation = useMutation({
    mutationFn: (guardrailId: string) =>
      unassignGuardrailFromTeam(guardrailId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["guardrails", id] });
      queryClient.invalidateQueries({ queryKey: ["guardrails-section"] });
      toast.success(t("teamDetail.guardrailRemoved"));
    },
    onError: () => toast.error(t("teamDetail.failedRemoveGuardrail")),
  });
  const [removeGuardrailId, setRemoveGuardrailId] = useState<string | null>(null);
  const removeGuardrailName = guardrails.find((g) => g.id === removeGuardrailId)?.name ?? "";
  const [capEditMemberId, setCapEditMemberId] = useState<string | null>(null);

  // Inline edit mode (driven by the appbar Pencil) — same pattern as
  // /users/[id]. Page is read-only by default; clicking the appbar
  // pencil flips into edit mode, which renders inputs for name +
  // description + budget. Confirm/Cancel land in the page header.
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBudget, setEditBudget] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const router = useRouter();

  const updateTeamMutation = useMutation({
    mutationFn: (data: { name?: string; description?: string }) =>
      updateTeam(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });

  // Per-team web-search switch — On/Off only. The default reflects the
  // org-level value; the org master switch being Off still overrides
  // this everywhere (enforced server-side in resolveWebSearchCapability).
  const webSearchMutation = useMutation({
    mutationFn: (val: boolean) =>
      updateTeam(id, { webSearchEnabled: val }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teams", id] });
      toast.success(t("teamDetail.webSearchSaved"));
    },
    onError: (err: Error) =>
      toast.error(err.message || t("teamDetail.webSearchFailed")),
  });

  const deleteTeamMutation = useMutation({
    mutationFn: () => deleteTeam(id),
    onSuccess: () => {
      toast.success(`${t("teamDetail.deletedToast")} "${team?.name ?? "team"}".`);
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      router.push("/teams");
    },
    onError: (err: Error) => {
      toast.error(err.message || t("teamDetail.couldntDeleteTeam"));
    },
  });

  // Wire the appbar Pencil/Trash2 to page state via window events —
  // mirrors /users/[id]. MUST stay above the early-return guards so
  // hook count is stable across the loading → loaded transition.
  useEffect(() => {
    const onEdit = () => {
      if (!team) return;
      setEditName(team.name);
      setEditDescription(team.description ?? "");
      setEditBudget(
        (team.monthlyBudgetCents / 100).toLocaleString("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      );
      setIsEditing(true);
    };
    const onDelete = () => setConfirmDeleteOpen(true);
    window.addEventListener("team-detail:edit", onEdit);
    window.addEventListener("team-detail:delete", onDelete);
    return () => {
      window.removeEventListener("team-detail:edit", onEdit);
      window.removeEventListener("team-detail:delete", onDelete);
    };
  }, [team]);

  // Client-side pagination for the three team-details tables. State
  // lives ABOVE the loading/error early returns so the Rules of Hooks
  // hold across render branches; the slices themselves operate on
  // empty arrays until `team` resolves and are harmless. PAGE_SIZE
  // matches the Figma pagination comp (`Centered page numbers/
  // Desktop`) — 10 rows per page.
  const PAGE_SIZE = 10;
  const [subteamsPage, setSubteamsPage] = useState(1);
  const [membersPage, setMembersPage] = useState(1);
  const [guardrailsPage, setGuardrailsPage] = useState(1);

  const subteamsTotalPages = Math.max(
    1,
    Math.ceil(subteams.length / PAGE_SIZE),
  );
  const pagedSubteams = useMemo(
    () =>
      subteams.slice(
        (subteamsPage - 1) * PAGE_SIZE,
        subteamsPage * PAGE_SIZE,
      ),
    [subteams, subteamsPage],
  );
  useEffect(() => {
    if (subteamsPage > subteamsTotalPages) setSubteamsPage(subteamsTotalPages);
  }, [subteamsPage, subteamsTotalPages]);

  const members = team?.members ?? [];
  const membersTotalPages = Math.max(
    1,
    Math.ceil(members.length / PAGE_SIZE),
  );
  const pagedMembers = useMemo(
    () =>
      members.slice(
        (membersPage - 1) * PAGE_SIZE,
        membersPage * PAGE_SIZE,
      ),
    [members, membersPage],
  );
  useEffect(() => {
    if (membersPage > membersTotalPages) setMembersPage(membersTotalPages);
  }, [membersPage, membersTotalPages]);

  const guardrailsTotalPages = Math.max(
    1,
    Math.ceil(guardrails.length / PAGE_SIZE),
  );
  const pagedGuardrails = useMemo(
    () =>
      guardrails.slice(
        (guardrailsPage - 1) * PAGE_SIZE,
        guardrailsPage * PAGE_SIZE,
      ),
    [guardrails, guardrailsPage],
  );
  useEffect(() => {
    if (guardrailsPage > guardrailsTotalPages) setGuardrailsPage(guardrailsTotalPages);
  }, [guardrailsPage, guardrailsTotalPages]);

  if (isLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-text-3" /></div>;
  if (error || !team) return <div className="flex items-center justify-center py-24"><p className="text-text-3">{t("teamDetail.failedLoad")}</p></div>;

  const budget = team.monthlyBudgetCents / 100;
  const spent = team.spentCents / 100;
  const remaining = budget - spent;
  const projected = team.projectedCents / 100;
  const onTrack = projected <= budget;

  // Sum positive per-member caps. `null` (no cap, shares team budget)
  // and `0` (suspended) don't allocate any team dollars, so they're
  // skipped. When the sum exceeds the team budget, surface a soft
  // warning above the Users table — chat-time gate enforces the
  // budget anyway, but pre-warning admins about over-allocation
  // saves a "why is one member blocked while caps look fine"
  // debugging round-trip.
  const allocatedCapsCents = team.members.reduce((acc, m) => {
    const cap = m.monthlyCapCents;
    return cap != null && cap > 0 ? acc + cap : acc;
  }, 0);
  const overAllocated =
    team.monthlyBudgetCents > 0 &&
    allocatedCapsCents > team.monthlyBudgetCents;

  const myMembership = team.members.find(
    (m) =>
      m.userId &&
      m.userId === currentUser?.id &&
      m.status === "accepted",
  );
  const canManageTeam =
    !!currentUser &&
    (currentUser.id === team.ownerId ||
      myMembership?.role === "owner" ||
      myMembership?.role === "admin" ||
      myMembership?.role === "manager" ||
      myMembership?.role === "editor");
  // Owner-equivalent rights: owner, admin, or manager. Required to
  // promote / demote 'admin' or 'manager' rows and (later) to
  // surface budget / invitation controls scoped to the team.
  const hasOwnerRights =
    !!currentUser &&
    (currentUser.id === team.ownerId ||
      myMembership?.role === "admin" ||
      myMembership?.role === "manager");
  // Back-compat alias used by the role Select.
  const canEditRoles = canManageTeam;

  // Render guard for the inline edit affordances. canManageTeam alone
  // isn't enough — non-managers could still flip isEditing via the
  // window event, so gate the rendered controls too. BE rejects either
  // way; this just keeps the UI honest.
  const editing = isEditing && canManageTeam;
  const isSavingTeam =
    updateTeamMutation.isPending || budgetMutation.isPending;

  const cancelEdit = () => {
    setIsEditing(false);
    setEditName("");
    setEditDescription("");
    setEditBudget("");
  };

  const confirmEdit = async () => {
    const trimmedName = editName.trim();
    if (!trimmedName) {
      toast.error(t("teamDetail.nameEmpty"));
      return;
    }
    const raw = editBudget.replace(/\./g, "").replace(",", ".");
    const parsedBudget = parseFloat(raw);
    if (isNaN(parsedBudget) || parsedBudget < 0) {
      toast.error(t("teamDetail.budgetNonNegative"));
      return;
    }

    const nameChanged = trimmedName !== team.name;
    const descriptionChanged =
      editDescription.trim() !== (team.description ?? "");
    const budgetChanged = parsedBudget !== budget;
    if (!nameChanged && !descriptionChanged && !budgetChanged) {
      setIsEditing(false);
      return;
    }

    // Fire the changed mutations in parallel; surface a per-mutation
    // toast so a partial failure (e.g. name OK but budget rejected)
    // is visible. Mirrors the /users/[id] confirm pattern.
    const tasks: Array<Promise<unknown>> = [];
    if (nameChanged || descriptionChanged) {
      tasks.push(
        updateTeamMutation.mutateAsync({
          ...(nameChanged ? { name: trimmedName } : {}),
          ...(descriptionChanged
            ? { description: editDescription.trim() || undefined }
            : {}),
        }).catch((err: Error) => {
          toast.error(err.message || t("teamDetail.couldntSaveDetails"));
          throw err;
        }),
      );
    }
    if (budgetChanged) {
      tasks.push(
        budgetMutation
          .mutateAsync(parsedBudget)
          .catch((err: Error) => {
            toast.error(err.message || t("teamDetail.couldntSaveBudget"));
            throw err;
          }),
      );
    }

    const results = await Promise.allSettled(tasks);
    if (results.every((r) => r.status === "fulfilled")) {
      toast.success(t("teamDetail.teamUpdated"));
      setIsEditing(false);
    }
  };

  const memberName = (m: TeamMember) => m.userName ?? m.email;

  return (
    <div className="space-y-6">
      {/* ── Web search override ───────────────────────────────────── */}
      {canManageTeam && (
        <div className="bg-bg-white rounded p-4 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-[14px] font-semibold text-text-1">
              {t("teamDetail.webSearchTitle")}
            </h3>
            <p className="text-[12px] text-text-3">
              {t("teamDetail.webSearchDesc")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {/* Org Off is the master switch — when the company has web search
                off, the team can't re-enable it, so the control is disabled. */}
            <DisabledReasonTooltip
              disabled={orgSettings?.webSearchEnabled !== true}
              reason={t("teamDetail.webSearchOrgOff")}
            >
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-border-3">
                {(
                  [
                    { val: true, label: t("teamDetail.webSearchOn") },
                    { val: false, label: t("teamDetail.webSearchOff") },
                  ] as const
                ).map((opt) => {
                  // No explicit team choice (null) defaults to the org value.
                  const effective =
                    team.webSearchEnabled ??
                    orgSettings?.webSearchEnabled ??
                    false;
                  const active = effective === opt.val;
                  // Disabled when the org master switch is off (or org settings
                  // haven't loaded yet) so a click can't fire a no-op save.
                  const orgOn = orgSettings?.webSearchEnabled === true;
                  return (
                    <button
                      key={String(opt.val)}
                      type="button"
                      disabled={webSearchMutation.isPending || !orgOn}
                      // No-op when already effective — avoids persisting an
                      // explicit value over the inherited (null) default.
                      onClick={() => {
                        if (!active) webSearchMutation.mutate(opt.val);
                      }}
                      className={`px-3 py-1.5 text-[13px] cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        active
                          ? "bg-primary-6 text-white"
                          : "bg-bg-white text-text-2 hover:bg-bg-1"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </DisabledReasonTooltip>
          </div>
        </div>
      )}

      {/* ── Description + Budget card ──────────────────────────────── */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <svg viewBox="0 0 80 80" className="h-full w-full">
                <defs><linearGradient id="teamGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f97316" /><stop offset="50%" stopColor="#ef4444" /><stop offset="100%" stopColor="#22c55e" /></linearGradient></defs>
                <rect width="80" height="80" fill="url(#teamGrad)" rx="8" />
                <circle cx="30" cy="50" r="15" fill="#1e40af" opacity="0.7" /><circle cx="55" cy="35" r="12" fill="#f59e0b" opacity="0.7" />
                <polygon points="20,20 45,15 35,40" fill="#ef4444" opacity="0.6" />
              </svg>
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              {editing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={t("teamDetail.teamNamePh")}
                  disabled={isSavingTeam}
                  className="h-10 text-[18px] font-bold"
                />
              ) : (
                <p className="text-[18px] font-bold text-text-1">{team.name}</p>
              )}
              {editing ? (
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t("teamDetail.descPh")}
                  rows={2}
                  disabled={isSavingTeam}
                />
              ) : (
                <p className="text-[16px] text-text-1">{team.description ?? t("teamDetail.noDescription")}</p>
              )}
            </div>
          </div>

          {/* Inline edit-mode controls — Confirm / Cancel land here so
              they're contextual to the form state. The "enter edit
              mode" pencil lives up in the appbar. */}
          {editing && (
            <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:mt-1">
              <Button
                variant="outline"
                className="h-10 gap-2 border-border-2"
                onClick={cancelEdit}
                disabled={isSavingTeam}
              >
                <X className="h-4 w-4" />
                {t("teamDetail.cancel")}
              </Button>
              <Button
                className="h-10 gap-2 bg-success-7 text-white hover:bg-success-7/90"
                onClick={confirmEdit}
                disabled={isSavingTeam}
              >
                {isSavingTeam ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                )}
                {t("teamDetail.confirm")}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("teamDetail.monthlyBudget")}</p>
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
                  disabled={isSavingTeam}
                  autoFocus
                  className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-1 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div className="flex h-[56px] items-center px-1 text-[16px] text-text-1">
                {budget > 0 ? (
                  <span>{formatCurrency(budget)}</span>
                ) : (
                  <span className="text-text-3">{t("teamDetail.notSet")}</span>
                )}
              </div>
            )}
            {!editing && !canManageTeam && (
              <p className="text-[12px] text-text-3">
                {t("teamDetail.onlyOwners")}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">{t("teamDetail.spentRemaining")}</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">{formatCurrency(spent)} / {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}</span>
              <SpentBar spent={spent} budget={budget} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold text-text-1">{t("teamDetail.projected")}</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("teamDetail.projectedAria")}
                    className="flex items-center justify-center text-text-3 hover:text-text-1"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-center">
                  {t("teamDetail.projectedTooltip")}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              <span className={`rounded-lg px-2 py-1 text-[13px] ${onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"}`}>{onTrack ? t("teamDetail.onTrack") : t("teamDetail.overBudget")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Subteams ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[18px] font-bold text-text-1">{t("teamDetail.subteams")}</p>
          {canManageTeam ? (
            <AddSubteamDialog parentTeamId={id}>
              <Button variant="plusAction" className="rounded-lg"><Plus className="h-4 w-4 text-text-white" />{t("teamDetail.addSubteam")}</Button>
            </AddSubteamDialog>
          ) : (
            <DisabledReasonTooltip disabled reason={t("teamDetail.notAvailBasic")}>
              <Button
                variant="plusAction"
                className="rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />{t("teamDetail.addSubteam")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        {subteams.length === 0 ? (
          <div className="bg-bg-white rounded overflow-hidden"><div className="px-4 py-8 text-center text-[16px] text-text-3">{t("teamDetail.noSubteams")}</div></div>
        ) : (
          <div className="overflow-x-auto bg-bg-white rounded">
            <table className="w-full min-w-[480px] md:min-w-[640px] lg:min-w-[800px]">
              <thead>
                <tr className="h-[33px] border-b border-bg-1">
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colTeam")}</th>
                  <th className="hidden px-4 text-left align-middle text-[13px] font-normal text-text-2 md:table-cell">{t("teamDetail.colDesc")}</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colMonthlyBudget")}</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colSpentRemaining")}</th>
                  <th className="hidden px-4 text-left align-middle text-[13px] font-normal text-text-2 lg:table-cell">{t("teamDetail.colProjected")}</th>
                  <th className="hidden px-4 text-left align-middle text-[13px] font-normal text-text-2 sm:table-cell">{t("teamDetail.colMembers")}</th>
                  <th className="px-4 text-right align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedSubteams.map((sub) => {
                  const subBudget = sub.monthlyBudgetCents / 100;
                  const subSpent = sub.spentCents / 100;
                  const subRemaining = subBudget - subSpent;
                  const subProjected = sub.projectedCents / 100;
                  const subOverBudget = subProjected > subBudget;
                  const subExtraMembers = sub.memberCount > 4 ? sub.memberCount - 4 : 0;
                  return (
                    <tr key={sub.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-bg-1/50">
                      <td className="px-4 align-middle text-base text-text-1 whitespace-nowrap">{sub.name}</td>
                      <td className="hidden px-4 align-middle text-sm text-text-2 whitespace-nowrap md:table-cell">{sub.description ?? "—"}</td>
                      <td className="px-4 align-middle text-sm text-text-1 whitespace-nowrap">
                        {subBudget > 0 ? formatCurrency(subBudget) : "—"}
                      </td>
                      <td className="w-[1%] px-4 align-middle whitespace-nowrap">
                        {subBudget > 0 ? (
                          <div className="flex items-center gap-3">
                            <span className="text-sm leading-tight text-text-1">
                              {formatCurrency(subSpent)} /{" "}
                              {subRemaining < 0 ? (
                                <span className="text-danger-5">{formatCurrency(subRemaining)}</span>
                              ) : (
                                formatCurrency(subRemaining)
                              )}
                            </span>
                            <span className="ml-auto">
                              <SpentBar spent={subSpent} budget={subBudget} />
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-text-1">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 align-middle whitespace-nowrap lg:table-cell">
                        {subBudget > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-text-1">{formatCurrency(subProjected)}</span>
                            <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${subOverBudget ? "bg-bg-1 text-text-3" : "bg-success-1 text-text-1"}`}>
                              {subOverBudget ? t("teamDetail.overBudget") : t("teamDetail.onTrack")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-text-1">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 align-middle sm:table-cell">
                        {sub.members.length > 0 ? (
                          <div className="flex items-center">
                            <div className="flex -space-x-2">
                              {sub.members.slice(0, 4).map((m, i) =>
                                m.picture ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={i} src={m.picture} alt={m.name ?? ""} referrerPolicy="no-referrer" className="h-6 w-6 rounded-full border-2 border-bg-white object-cover" />
                                ) : (
                                  <div key={i} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-white bg-bg-3 text-[9px] font-semibold text-text-3">
                                    {(m.name ?? "?").charAt(0)}
                                  </div>
                                ),
                              )}
                            </div>
                            {subExtraMembers > 0 && (
                              <span className="ml-1.5 text-[12px] text-text-2">+{subExtraMembers}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-text-1">—</span>
                        )}
                      </td>
                      <td className="px-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-text-3 hover:text-text-1"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canManageTeam ? (
                              <>
                                <EditSubteamDialog sub={sub} parentTeamId={id}>
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="gap-2"><Pencil className="h-4 w-4" />{t("teamDetail.edit")}</DropdownMenuItem>
                                </EditSubteamDialog>
                                <DeleteSubteamDialog subId={sub.id} subName={sub.name} parentTeamId={id}>
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="gap-2 text-danger-6 focus:text-danger-6"><Trash2 className="h-4 w-4" />{t("teamDetail.subDelete")}</DropdownMenuItem>
                                </DeleteSubteamDialog>
                              </>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  disabled
                                  onSelect={(e) => e.preventDefault()}
                                  className="gap-2"
                                >
                                  <Pencil className="h-4 w-4" />{t("teamDetail.edit")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled
                                  onSelect={(e) => e.preventDefault()}
                                  className="gap-2 text-danger-6 focus:text-danger-6"
                                >
                                  <Trash2 className="h-4 w-4" />{t("teamDetail.subDelete")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={subteamsPage}
              totalPages={subteamsTotalPages}
              onPageChange={setSubteamsPage}
              className="px-4"
            />
          </div>
        )}
      </div>

      {/* ── Users ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Over-allocation soft warning. Soft because chat-time gate
            already enforces the team budget regardless of member-cap
            sum — this just gives the admin a heads-up so they don't
            have to debug "why did Marko hit a cap when his per-member
            cap looks fine". Only shown when the sum strictly exceeds
            the team budget (equality is fine). */}
        {overAllocated && (
          <div className="flex items-start gap-2 rounded-lg border border-warning-3 bg-warning-1/40 px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning-7 mt-0.5" />
            <p className="text-[13px] text-warning-7 leading-snug">
              {t("teamDetail.memberCapsTotal")}{" "}
              <strong>{formatCurrency(allocatedCapsCents / 100)}</strong>,
              {t("teamDetail.overTeamBudget")}{" "}
              <strong>{formatCurrency(budget)}</strong>{t("teamDetail.overTeamBudget2")}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[18px] font-bold text-text-1">{t("teamDetail.users")}</p>
          {canManageTeam ? (
            <InviteMemberDialog teamId={id}>
              <Button variant="plusAction" className="rounded-lg"><Plus className="h-4 w-4 text-text-white" />{t("teamDetail.inviteUsers")}</Button>
            </InviteMemberDialog>
          ) : (
            <DisabledReasonTooltip disabled reason={t("teamDetail.notAvailBasic")}>
              <Button
                variant="plusAction"
                className="rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />{t("teamDetail.inviteUsers")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] md:min-w-[640px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[180px] sm:w-[260px] lg:w-[300px]">{t("teamDetail.colName")}</th>
                  <th className="hidden bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 sm:table-cell">{t("teamDetail.colEmail")}</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colRole")}</th>
                  <th className="hidden bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[180px] lg:table-cell">{t("teamDetail.colMonthlyCap")}</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("teamDetail.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {pagedMembers.map((m) => {
                  const capLabel =
                    m.monthlyCapCents == null
                      ? t("teamDetail.noCap")
                      : m.monthlyCapCents === 0
                        ? t("teamDetail.suspended")
                        : `${formatCurrency(m.monthlyCapCents / 100)}${t("teamDetail.perMonth")}`;
                  const capTone =
                    m.monthlyCapCents === 0
                      ? "text-danger-6"
                      : m.monthlyCapCents != null
                        ? "text-text-1"
                        : "text-text-3";
                  return (
                    <tr key={m.id} className="h-14 border-b border-border-2">
                      <td className="bg-bg-white px-4 align-middle w-[180px] sm:w-[260px] lg:w-[300px]">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={memberName(m)} picture={m.userPicture} size={24} />
                          <span className="flex items-center gap-2 text-[16px] text-text-1 whitespace-nowrap">
                            {memberName(m)}
                            {m.userId && m.userId === team.ownerId && (
                              <Badge className="border-transparent bg-primary-1 text-primary-7 uppercase tracking-wide text-[10px] px-1.5 py-0">
                                {t("teamDetail.teamOwner")}
                              </Badge>
                            )}
                            {m.role === "admin" && (
                              <Badge className="border-transparent bg-warning-1 text-warning-7 uppercase tracking-wide text-[10px] px-1.5 py-0">
                                {t("teamDetail.teamAdmin")}
                              </Badge>
                            )}
                            {m.role === "manager" && (
                              <Badge className="border-transparent bg-success-1 text-success-7 uppercase tracking-wide text-[10px] px-1.5 py-0">
                                {t("teamDetail.teamManager")}
                              </Badge>
                            )}
                            {m.status === "pending" && <span className="rounded-lg bg-bg-2 px-2 py-0.5 text-[13px] text-text-3">{t("teamDetail.pending")}</span>}
                          </span>
                        </div>
                      </td>
                      <td className="hidden bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap sm:table-cell">{m.email}</td>
                      <td className="bg-bg-white px-4 align-middle">
                        {m.role === "owner" ? (
                          <span className="inline-flex h-8 items-center rounded-md border border-border-2 bg-bg-1 px-3 text-sm font-medium text-text-1">
                            {t("teamDetail.teamOwner")}
                          </span>
                        ) : (
                          <Select
                            value={m.role}
                            // Editors can flip editor↔viewer but the
                            // BE rejects them touching anything that
                            // involves 'admin' or 'manager' (promo-
                            // ting to / demoting from). Disable the
                            // whole control when the target is one
                            // of those tiers and the caller isn't
                            // owner-level, so the editor sees a
                            // read-only chip instead of an option
                            // set that would 403 on submit.
                            disabled={
                              !canEditRoles ||
                              ((m.role === "admin" || m.role === "manager") &&
                                !hasOwnerRights)
                            }
                            onValueChange={(value) =>
                              roleMutation.mutate({
                                memberId: m.id,
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
                              {/* Admin / Manager are only offered to
                                  owner-level callers. Stays in the
                                  list when the target is already in
                                  that tier so the Select can display
                                  the current value even for a read-
                                  only editor view. */}
                              {(hasOwnerRights || m.role === "admin") && (
                                <SelectItem value="admin">{t("teamDetail.tmAdmin")}</SelectItem>
                              )}
                              {(hasOwnerRights || m.role === "manager") && (
                                <SelectItem value="manager">{t("teamDetail.tmManager")}</SelectItem>
                              )}
                              <SelectItem value="editor">{t("teamDetail.tmEditor")}</SelectItem>
                              <SelectItem value="viewer">{t("teamDetail.tmViewer")}</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="hidden bg-bg-white px-4 align-middle w-[180px] lg:table-cell">
                        <span
                          className={`text-[14px] ${capTone}`}
                          title={t("teamDetail.capEditTitle")}
                        >
                          {capLabel}
                        </span>
                      </td>
                      <td className="bg-bg-white px-4 align-middle w-[93px]">
                        <div className="flex justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1"><MoreVertical className="h-5 w-5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="gap-2"
                                disabled={
                                  !canManageTeam || m.status === "pending"
                                }
                                onSelect={(e) => {
                                  if (
                                    !canManageTeam ||
                                    m.status === "pending"
                                  ) {
                                    e.preventDefault();
                                    return;
                                  }
                                  setCapEditMemberId(m.id);
                                }}
                              >
                                <Wallet className="h-4 w-4" />
                                {t("teamDetail.changeMonthlyCap")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2 text-danger-6 focus:text-danger-6"
                                disabled={!canManageTeam}
                                onSelect={(e) => {
                                  if (!canManageTeam) {
                                    e.preventDefault();
                                    return;
                                  }
                                  removeMutation.mutate(m.id);
                                }}
                              >
                                <UserX className="h-4 w-4" />{t("teamDetail.removeUser")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {team.members.length === 0 && <tr><td colSpan={5} className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3">{t("teamDetail.noMembers")}</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination
            page={membersPage}
            totalPages={membersTotalPages}
            onPageChange={setMembersPage}
            className="bg-bg-white px-4"
          />
        </div>
      </div>

      {/* AI keys are managed company-wide under Models → API keys & Custom
          LLMs (admin only); a team no longer links its own provider keys. */}

      {/* ── Guardrails ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[18px] font-bold text-text-1">{t("teamDetail.guardrails")}</p>
          {canManageTeam ? (
            <AddGuardrailDialog teamId={id}>
              <Button variant="plusAction" className="rounded-lg w-[155px]"><Plus className="h-4 w-4 text-text-white" />{t("teamDetail.addGuardrail")}</Button>
            </AddGuardrailDialog>
          ) : (
            <DisabledReasonTooltip disabled reason={t("teamDetail.notAvailBasic")}>
              <Button
                variant="plusAction"
                className="rounded-lg w-[155px] disabled:opacity-50 disabled:cursor-not-allowed"
                disabled
              >
                <Plus className="h-4 w-4 text-text-white" />{t("teamDetail.addGuardrail")}
              </Button>
            </DisabledReasonTooltip>
          )}
        </div>
        {guardrails.length === 0 ? (
          <div className="bg-bg-white rounded overflow-hidden"><div className="px-4 py-8 text-center text-[16px] text-text-3">{t("teamDetail.noGuardrails")}</div></div>
        ) : (
          <div className="bg-bg-white rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] md:min-w-[560px] lg:min-w-[700px]">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">{t("teamDetail.colName")}</th>
                    <th className="hidden px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 md:table-cell">{t("teamDetail.colType")}</th>
                    <th className="hidden px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 lg:table-cell">{t("teamDetail.colSeverity")}</th>
                    <th className="hidden px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 lg:table-cell">{t("teamDetail.colTriggers")}</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[167px]">{t("teamDetail.colStatus")}</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[93px]">{t("teamDetail.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedGuardrails.map((g) => (
                    <tr key={g.id} className="h-14 border-b border-bg-1">
                      <td className="px-4 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="text-[16px] text-text-1 whitespace-nowrap">{g.name}</span>
                          {g.isOrgWide && (
                            <span
                              className="rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-6"
                              title={t("teamDetail.orgWideTitle")}
                            >
                              {t("teamDetail.orgWide")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 align-middle md:table-cell">
                        <div className="flex flex-wrap gap-2.5">
                          {g.type.split(",").map((typeName) => (
                            <span key={typeName} className="rounded-lg bg-bg-2 px-2 py-1 text-[13px] text-text-3 whitespace-nowrap">
                              {typeName.trim()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="hidden px-4 align-middle lg:table-cell">
                        <span className="rounded-lg bg-bg-1 px-2 py-1 text-[13px] text-text-3">{severityLabel(g.severity, t)}</span>
                      </td>
                      <td className="hidden px-4 align-middle text-[16px] text-text-1 lg:table-cell">
                        {g.triggers.toLocaleString()}
                      </td>
                      <td className="px-4 align-middle w-[167px]">
                        <div className="flex items-center gap-2.5">
                          <Switch
                            checked={g.isActive && (g.teamIsActive ?? true)}
                            disabled={
                              !canManageTeam || !g.isActive || g.isOrgWide
                            }
                            onCheckedChange={() => {
                              if (g.isOrgWide) {
                                toast.error(t("teamDetail.orgWideErr"));
                                return;
                              }
                              if (!g.isActive) {
                                toast.error(t("teamDetail.globallyDeactivated"));
                                return;
                              }
                              toggleMutation.mutate(g.id);
                            }}
                          />
                          <span className="text-[16px] text-text-1 whitespace-nowrap">
                            {!g.isActive
                              ? t("teamDetail.inactiveGlobal")
                              : g.isOrgWide
                                ? t("teamDetail.activeOrgWide")
                                : (g.teamIsActive ?? true)
                                  ? t("teamDetail.active")
                                  : t("teamDetail.inactive")}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 align-middle w-[93px]">
                        <div className="flex justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1"><MoreVertical className="h-5 w-5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="gap-2 text-danger-6 focus:text-danger-6"
                                disabled={!canManageTeam || g.isOrgWide}
                                onSelect={(e) => {
                                  if (!canManageTeam || g.isOrgWide) {
                                    e.preventDefault();
                                    if (g.isOrgWide) {
                                      toast.error(t("teamDetail.orgRemoveErr"));
                                    }
                                    return;
                                  }
                                  setRemoveGuardrailId(g.id);
                                }}
                              >
                                <UserX className="h-4 w-4" />{t("teamDetail.removeFromTeam")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {guardrails.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[16px] text-text-3">{t("teamDetail.noGuardrails")}</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination
              page={guardrailsPage}
              totalPages={guardrailsTotalPages}
              onPageChange={setGuardrailsPage}
              className="px-4"
            />
          </div>
        )}
      </div>

      {/* Delete team confirmation — driven by the appbar Trash2 via
          the `team-detail:delete` window event. Mirrors the user
          detail page pattern. */}
      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(o) => !o && setConfirmDeleteOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("teamDetail.deleteTeamTitle")}</DialogTitle>
            <DialogDescription>
              {t("teamDetail.deleteTeamDesc1")} <strong>{team.name}</strong>{t("teamDetail.deleteTeamDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleteTeamMutation.isPending}
            >
              {t("teamDetail.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTeamMutation.mutate()}
              disabled={deleteTeamMutation.isPending}
            >
              {deleteTeamMutation.isPending ? t("teamDetail.deleting") : t("teamDetail.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-member cap editor */}
      {capEditMemberId &&
        (() => {
          const m = team.members.find((mm) => mm.id === capEditMemberId);
          if (!m) return null;
          return (
            <TeamMemberCapDialog
              teamId={id}
              member={m}
              open
              onClose={() => setCapEditMemberId(null)}
            />
          );
        })()}

      {/* Remove Guardrail Dialog */}
      <Dialog
        open={removeGuardrailId !== null}
        onOpenChange={(open) => !open && setRemoveGuardrailId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("teamDetail.removeGuardrailTitle")}</DialogTitle>
            <DialogDescription>
              {t("teamDetail.removeGuardrailDesc1")}{" "}
              <strong>{removeGuardrailName}</strong> {t("teamDetail.removeGuardrailDesc2")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRemoveGuardrailId(null)}
              className="cursor-pointer"
            >
              {t("teamDetail.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeGuardrailId) {
                  removeGuardrailMutation.mutate(removeGuardrailId);
                  setRemoveGuardrailId(null);
                }
              }}
              disabled={removeGuardrailMutation.isPending}
              className="cursor-pointer"
            >
              {removeGuardrailMutation.isPending ? t("teamDetail.removing") : t("teamDetail.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
