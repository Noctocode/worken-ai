"use client";

import { use, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  MoreVertical,
  UserX,
  Info,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import {
  fetchTeam,
  fetchSubteams,
  fetchGuardrails,
  createTeam,
  updateTeam,
  deleteTeam,
  updateTeamBudget,
  createGuardrail,
  toggleGuardrail as apiToggleGuardrail,
  deleteGuardrail as apiDeleteGuardrail,
  updateMemberRole,
  removeTeamMember,
  type TeamMember,
  type SubteamListItem,
} from "@/lib/api";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { formatCurrency } from "@/lib/utils";

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function UserAvatar({ name, picture, size = 24 }: { name: string; picture: string | null; size?: number }) {
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={picture} alt={name} className="rounded-full object-cover border border-border-2" style={{ width: size, height: size }} />
    );
  }
  return (
    <div className="flex items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-500 border border-border-2" style={{ width: size, height: size }}>
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createTeam({ name: name.trim(), description: description.trim() || undefined, parentTeamId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] }); setOpen(false); setName(""); setDescription(""); },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Subteam</DialogTitle>
          <DialogDescription>Create a new subteam under this team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subteam-name">Name</Label>
            <Input id="subteam-name" placeholder="Subteam name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="subteam-desc">Description</Label>
            <Textarea id="subteam-desc" placeholder="What is this subteam for?" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              {mutation.isPending ? "Creating..." : "Create Subteam"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSubteamDialog({ sub, parentTeamId, children }: { sub: SubteamListItem; parentTeamId: string; children: React.ReactNode }) {
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] }); setOpen(false); },
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
          <DialogTitle>Edit Subteam</DialogTitle>
          <DialogDescription>Update the subteam details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-name">Name</Label>
            <Input id="edit-subteam-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-desc">Description</Label>
            <Textarea id="edit-subteam-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-subteam-budget">Monthly Budget ($)</Label>
            <Input id="edit-subteam-budget" type="number" min="0" step="0.01" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubteamDialog({ subId, subName, parentTeamId, children }: { subId: string; subName: string; parentTeamId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteTeam(subId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subteams", parentTeamId] }); setOpen(false); },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Subteam</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{subName}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddGuardrailDialog({ teamId, children }: { teamId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState<"high" | "medium" | "low">("medium");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createGuardrail(teamId, { name: name.trim(), type: type.trim(), severity }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["guardrails", teamId] }); setOpen(false); setName(""); setType(""); setSeverity("medium"); },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Guardrail</DialogTitle>
          <DialogDescription>Create a new guardrail rule for this team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim() && type.trim()) mutation.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guardrail-name">Name</Label>
            <Input id="guardrail-name" placeholder="e.g. Content Safety Filter" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guardrail-type">Type</Label>
            <Input id="guardrail-type" placeholder="e.g. Content Safety" value={type} onChange={(e) => setType(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as "high" | "medium" | "low")}>
              <SelectTrigger className="border-border-2 text-text-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !name.trim() || !type.trim()}>
              {mutation.isPending ? "Creating..." : "Create Guardrail"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: team, isLoading, error } = useQuery({ queryKey: ["teams", id], queryFn: () => fetchTeam(id) });
  const { data: subteams = [] } = useQuery({ queryKey: ["subteams", id], queryFn: () => fetchSubteams(id) });
  const { data: guardrails = [] } = useQuery({ queryKey: ["guardrails", id], queryFn: () => fetchGuardrails(id) });

  const [budgetInput, setBudgetInput] = useState<string | null>(null);
  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateTeamBudget(id, budgetUsd),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });
  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "basic" | "advanced" }) => updateMemberRole(id, memberId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeTeamMember(id, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ guardrailId, isActive }: { guardrailId: string; isActive: boolean }) => apiToggleGuardrail(id, guardrailId, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardrails", id] }),
  });
  const deleteGuardrailMutation = useMutation({
    mutationFn: (guardrailId: string) => apiDeleteGuardrail(id, guardrailId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["guardrails", id] }),
  });

  if (isLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-text-3" /></div>;
  if (error || !team) return <div className="flex items-center justify-center py-24"><p className="text-text-3">Failed to load team.</p></div>;

  const budget = team.monthlyBudgetCents / 100;
  const spent = team.spentCents / 100;
  const remaining = budget - spent;
  const projected = team.projectedCents / 100;
  const onTrack = projected <= budget;
  const displayBudget = budgetInput ?? budget.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleBudgetBlur = () => {
    if (budgetInput === null) return;
    const raw = budgetInput.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0 && num !== budget) budgetMutation.mutate(num);
    setBudgetInput(null);
  };

  const memberName = (m: TeamMember) => m.userName ?? m.email;

  return (
    <div className="space-y-6">
      {/* ── Description + Budget card ──────────────────────────────── */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <svg viewBox="0 0 80 80" className="h-full w-full">
                <defs><linearGradient id="teamGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#f97316" /><stop offset="50%" stopColor="#ef4444" /><stop offset="100%" stopColor="#22c55e" /></linearGradient></defs>
                <rect width="80" height="80" fill="url(#teamGrad)" rx="8" />
                <circle cx="30" cy="50" r="15" fill="#1e40af" opacity="0.7" /><circle cx="55" cy="35" r="12" fill="#f59e0b" opacity="0.7" />
                <polygon points="20,20 45,15 35,40" fill="#ef4444" opacity="0.6" />
              </svg>
            </div>
            <div className="space-y-3">
              <p className="text-[18px] font-bold text-text-1">{team.name}</p>
              <p className="text-[16px] text-text-1">{team.description ?? "No description"}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-success-7 hover:text-success-7/80"><Pencil className="h-6 w-6" /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-success-7 hover:text-success-7/80"><Trash2 className="h-6 w-6" /></Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">$</span>
              <input type="text" value={displayBudget} onChange={(e) => setBudgetInput(e.target.value)} onBlur={handleBudgetBlur} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-2 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50" />
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-[16px] text-text-2">{formatCurrency(spent)} / {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}</span>
              <SpentBar spent={spent} budget={budget} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-text-3" />
            </div>
            <div className="flex items-center gap-2.5 h-[56px]">
              <span className="text-[16px] text-text-1">{formatCurrency(projected)}</span>
              <span className={`rounded-lg px-2 py-1 text-[13px] ${onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"}`}>{onTrack ? "On track" : "Over Budget"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Subteams ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Subteams</p>
          <AddSubteamDialog parentTeamId={id}>
            <Button variant="plusAction" className="rounded-lg"><Plus className="h-4 w-4 text-text-white" />Add Subteam</Button>
          </AddSubteamDialog>
        </div>
        {subteams.length === 0 ? (
          <div className="bg-bg-white rounded overflow-hidden"><div className="px-4 py-8 text-center text-[16px] text-text-3">No subteams yet.</div></div>
        ) : (
          <div className="overflow-x-auto bg-bg-white rounded">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="h-[33px] border-b border-bg-1">
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Team</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Description</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Monthly Budget</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Spent / Remaining</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Projected</th>
                  <th className="px-4 text-left align-middle text-[13px] font-normal text-text-2">Members</th>
                  <th className="px-4 text-right align-middle text-[13px] font-normal text-text-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subteams.map((sub) => {
                  const subBudget = sub.monthlyBudgetCents / 100;
                  const subSpent = sub.spentCents / 100;
                  const subRemaining = subBudget - subSpent;
                  const subProjected = sub.projectedCents / 100;
                  const subOverBudget = subProjected > subBudget;
                  const subExtraMembers = sub.memberCount > 4 ? sub.memberCount - 4 : 0;
                  return (
                    <tr key={sub.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                      <td className="px-4 align-middle text-base text-black whitespace-nowrap">{sub.name}</td>
                      <td className="px-4 align-middle text-sm text-slate-500 whitespace-nowrap">{sub.description ?? "—"}</td>
                      <td className="px-4 align-middle text-sm text-black whitespace-nowrap">
                        {subBudget > 0 ? formatCurrency(subBudget) : "—"}
                      </td>
                      <td className="w-[1%] px-4 align-middle whitespace-nowrap">
                        {subBudget > 0 ? (
                          <div className="flex items-center gap-3">
                            <span className="text-sm leading-tight text-black">
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
                          <span className="text-sm text-black">—</span>
                        )}
                      </td>
                      <td className="px-4 align-middle whitespace-nowrap">
                        {subBudget > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-black">{formatCurrency(subProjected)}</span>
                            <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${subOverBudget ? "bg-bg-1 text-text-3" : "bg-success-1 text-text-1"}`}>
                              {subOverBudget ? "Over Budget" : "On track"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-black">—</span>
                        )}
                      </td>
                      <td className="px-4 align-middle">
                        {sub.members.length > 0 ? (
                          <div className="flex items-center">
                            <div className="flex -space-x-2">
                              {sub.members.slice(0, 4).map((m, i) =>
                                m.picture ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={i} src={m.picture} alt={m.name ?? ""} className="h-6 w-6 rounded-full border-2 border-white object-cover" />
                                ) : (
                                  <div key={i} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[9px] font-semibold text-slate-500">
                                    {(m.name ?? "?").charAt(0)}
                                  </div>
                                ),
                              )}
                            </div>
                            {subExtraMembers > 0 && (
                              <span className="ml-1.5 text-[12px] text-slate-500">+{subExtraMembers}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-black">—</span>
                        )}
                      </td>
                      <td className="px-4 align-middle text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600"><MoreVertical className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <EditSubteamDialog sub={sub} parentTeamId={id}>
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="gap-2"><Pencil className="h-4 w-4" />Edit</DropdownMenuItem>
                            </EditSubteamDialog>
                            <DeleteSubteamDialog subId={sub.id} subName={sub.name} parentTeamId={id}>
                              <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="gap-2 text-red-600 focus:text-red-600"><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                            </DeleteSubteamDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Users ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Users</p>
          <InviteMemberDialog teamId={id}>
            <Button variant="plusAction" className="rounded-lg"><Plus className="h-4 w-4 text-text-white" />Invite Users</Button>
          </InviteMemberDialog>
        </div>
        <div className="rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[540px]">
              <thead>
                <tr>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[300px]">Name</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Email</th>
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Role</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.id} className="h-14 border-b border-border-2">
                    <td className="bg-bg-white px-4 align-middle w-[300px]">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={memberName(m)} picture={m.userPicture} size={24} />
                        <span className="text-[16px] text-text-1 whitespace-nowrap">
                          {memberName(m)}
                          {m.status === "pending" && <span className="ml-2 rounded-lg bg-bg-2 px-2 py-0.5 text-[13px] text-text-3">Pending</span>}
                        </span>
                      </div>
                    </td>
                    <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">{m.email}</td>
                    <td className="bg-bg-white px-4 align-middle">
                      <Select value={m.role} onValueChange={(value) => roleMutation.mutate({ memberId: m.id, role: value as "basic" | "advanced" })}>
                        <SelectTrigger className="h-8 w-[130px] border-border-2 text-sm text-text-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="advanced">Advanced</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="bg-bg-white px-4 align-middle w-[93px]">
                      <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1"><MoreVertical className="h-5 w-5" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600" onClick={() => removeMutation.mutate(m.id)}><UserX className="h-4 w-4" />Remove user</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {team.members.length === 0 && <tr><td colSpan={4} className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3">No members yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Guardrails ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Guardrails</p>
          <AddGuardrailDialog teamId={id}>
            <Button variant="plusAction" className="rounded-lg w-[155px]"><Plus className="h-4 w-4 text-text-white" />Add Guardrail</Button>
          </AddGuardrailDialog>
        </div>
        {guardrails.length === 0 ? (
          <div className="bg-bg-white rounded overflow-hidden"><div className="px-4 py-8 text-center text-[16px] text-text-3">No guardrails configured yet.</div></div>
        ) : (
          <div className="bg-bg-white rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Name</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Type</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Severity</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Triggers</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[167px]">Status</th>
                    <th className="px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {guardrails.map((g) => (
                    <tr key={g.id} className="h-14 border-b border-bg-1">
                      <td className="px-4 align-middle">
                        <span className="text-[16px] text-text-1 whitespace-nowrap">{g.name}</span>
                      </td>
                      <td className="px-4 align-middle">
                        <div className="flex gap-2.5">
                          {g.type.split(",").map((t) => (
                            <span key={t} className="rounded-lg bg-bg-2 px-2 py-1 text-[13px] text-text-3 whitespace-nowrap">
                              {t.trim()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 align-middle">
                        <span className="rounded-lg bg-bg-1 px-2 py-1 text-[13px] text-text-3">{g.severity}</span>
                      </td>
                      <td className="px-4 align-middle text-[16px] text-text-1">
                        {g.triggers.toLocaleString()}
                      </td>
                      <td className="px-4 align-middle w-[167px]">
                        <div className="flex items-center gap-2.5">
                          <Switch checked={g.isActive} onCheckedChange={(checked) => toggleMutation.mutate({ guardrailId: g.id, isActive: checked })} />
                          <span className="text-[16px] text-text-1 whitespace-nowrap">{g.isActive ? "Active" : "Inactive"}</span>
                        </div>
                      </td>
                      <td className="px-4 align-middle w-[93px]">
                        <div className="flex justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-text-2 hover:text-text-1"><MoreVertical className="h-5 w-5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600" onClick={() => deleteGuardrailMutation.mutate(g.id)}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {guardrails.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-[16px] text-text-3">No guardrails configured yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
