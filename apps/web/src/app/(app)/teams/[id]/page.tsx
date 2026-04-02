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
  updateTeamBudget,
  updateMemberRole,
  removeTeamMember,
  type TeamMember,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Helper components ──────────────────────────────────────────────────── */

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function UserAvatar({ name, picture, size = 24 }: { name: string; picture: string | null; size?: number }) {
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
      className="flex items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-500 border border-border-2"
      style={{ width: size, height: size }}
    >
      {getInitials(name)}
    </div>
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

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const { data: team, isLoading, error } = useQuery({
    queryKey: ["teams", id],
    queryFn: () => fetchTeam(id),
  });

  // Budget editing
  const [budgetInput, setBudgetInput] = useState<string | null>(null);
  const budgetMutation = useMutation({
    mutationFn: (budgetUsd: number) => updateTeamBudget(id, budgetUsd),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });

  // Member role update
  const roleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: "basic" | "advanced" }) =>
      updateMemberRole(id, memberId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });

  // Remove member
  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeTeamMember(id, memberId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["teams", id] }),
  });

  // Guardrails local state (no BE yet)
  const [guardrails, setGuardrails] = useState<
    { id: string; name: string; types: string[]; severity: "high" | "medium" | "low"; triggers: number; active: boolean }[]
  >([]);
  const toggleGuardrail = (gId: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === gId ? { ...g, active: !g.active } : g)),
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-text-3" />
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-text-3">Failed to load team.</p>
      </div>
    );
  }

  const budget = team.monthlyBudgetCents / 100;
  const spent = team.spentCents / 100;
  const remaining = budget - spent;
  const projected = team.projectedCents / 100;
  const onTrack = projected <= budget;

  const displayBudget = budgetInput ?? budget.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleBudgetBlur = () => {
    if (budgetInput === null) return;
    const raw = budgetInput.replace(/\./g, "").replace(",", ".");
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0 && num !== budget) {
      budgetMutation.mutate(num);
    }
    setBudgetInput(null);
  };

  const memberDisplayName = (m: TeamMember) =>
    m.userName ?? m.email;

  return (
    <div className="space-y-6">
      {/* ── Description + Budget card ──────────────────────────────── */}
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        {/* Description row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full overflow-hidden">
              <svg viewBox="0 0 80 80" className="h-full w-full">
                <defs>
                  <linearGradient id="teamGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#f97316" />
                    <stop offset="50%" stopColor="#ef4444" />
                    <stop offset="100%" stopColor="#22c55e" />
                  </linearGradient>
                </defs>
                <rect width="80" height="80" fill="url(#teamGrad)" rx="8" />
                <circle cx="30" cy="50" r="15" fill="#1e40af" opacity="0.7" />
                <circle cx="55" cy="35" r="12" fill="#f59e0b" opacity="0.7" />
                <polygon points="20,20 45,15 35,40" fill="#ef4444" opacity="0.6" />
              </svg>
            </div>
            <div className="space-y-3">
              <p className="text-[18px] font-bold text-text-1">{team.name}</p>
              <p className="text-[16px] text-text-1">{team.description ?? "No description"}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-success-7 hover:text-success-7/80">
              <Pencil className="h-6 w-6" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-success-7 hover:text-success-7/80">
              <Trash2 className="h-6 w-6" />
            </Button>
          </div>
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
                className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-2 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
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

      {/* ── Subteams ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Subteams</p>
          <Button variant="plusAction" className="rounded-lg">
            <Plus className="h-4 w-4 text-text-white" />
            Add Subteam
          </Button>
        </div>
        <div className="bg-bg-white rounded overflow-hidden">
          <div className="px-4 py-8 text-center text-[16px] text-text-3">
            No subteams yet.
          </div>
        </div>
      </div>

      {/* ── Users ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Users</p>
          <Button variant="plusAction" className="rounded-lg">
            <Plus className="h-4 w-4 text-text-white" />
            Invite Users
          </Button>
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
                        <UserAvatar name={memberDisplayName(m)} picture={m.userPicture} size={24} />
                        <span className="text-[16px] text-text-1 whitespace-nowrap">
                          {memberDisplayName(m)}
                          {m.status === "pending" && (
                            <span className="ml-2 rounded-lg bg-bg-2 px-2 py-0.5 text-[13px] text-text-3">Pending</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">
                      {m.email}
                    </td>
                    <td className="bg-bg-white px-4 align-middle">
                      <Select
                        value={m.role}
                        onValueChange={(value) =>
                          roleMutation.mutate({ memberId: m.id, role: value as "basic" | "advanced" })
                        }
                      >
                        <SelectTrigger className="h-8 w-[130px] border-border-2 text-sm text-text-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="advanced">Advanced</SelectItem>
                        </SelectContent>
                      </Select>
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
                            <DropdownMenuItem
                              className="gap-2 text-red-600 focus:text-red-600"
                              onClick={() => removeMutation.mutate(m.id)}
                            >
                              <UserX className="h-4 w-4" />
                              Remove user
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {team.members.length === 0 && (
                  <tr>
                    <td colSpan={4} className="bg-bg-white px-4 py-8 text-center text-[16px] text-text-3">
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Guardrails ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[18px] font-bold text-text-1">Guardrails</p>
          <Button variant="plusAction" className="rounded-lg">
            <Plus className="h-4 w-4 text-text-white" />
            Add Guardrail
          </Button>
        </div>
        {guardrails.length === 0 ? (
          <div className="bg-bg-white rounded overflow-hidden">
            <div className="px-4 py-8 text-center text-[16px] text-text-3">
              No guardrails configured yet.
            </div>
          </div>
        ) : (
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
                              <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600">
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
        )}
      </div>
    </div>
  );
}
