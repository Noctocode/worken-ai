"use client";

import { use, useState } from "react";
import {
  Pencil,
  Plus,
  Trash2,
  MoreVertical,
  UserX,
  Info,
} from "lucide-react";
// import { useQuery } from "@tanstack/react-query";
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
// import { useAuth } from "@/components/providers";
// import { fetchTeam } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Demo data ──────────────────────────────────────────────────────────── */

interface DemoUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  role: "Editor" | "Admin" | "Viewer";
}

interface DemoSubteam {
  id: string;
  name: string;
  description: string;
  monthlyBudget: number;
  spent: number;
  remaining: number;
  projected: number;
  members: { picture: string | null; name: string }[];
}

interface DemoGuardrail {
  id: string;
  name: string;
  types: string[];
  severity: "high" | "medium" | "low";
  triggers: number;
  active: boolean;
}

const DEMO_TEAM = {
  id: "1",
  name: "Marketing Team",
  description: "Promotional activities",
  monthlyBudget: 300,
  spent: 61,
  remaining: 239,
  projected: 300,
  onTrack: true,
  image: null as string | null,
};

const DEMO_USERS: DemoUser[] = [
  { id: "1", name: "Bessie Cooper", email: "willie.jennings@example.com", picture: null, role: "Editor" },
  { id: "2", name: "Kathryn Murphy", email: "kenzi.lawson@example.com", picture: null, role: "Editor" },
  { id: "3", name: "Robert Fox", email: "debra.holt@example.com", picture: null, role: "Admin" },
  { id: "4", name: "Dianne Russell", email: "nevaeh.simmons@example.com", picture: null, role: "Editor" },
  { id: "5", name: "Jacob Jones", email: "jackson.graham@example.com", picture: null, role: "Editor" },
];

const DEMO_SUBTEAMS: DemoSubteam[] = [
  {
    id: "1",
    name: "Design Team",
    description: "Design issues",
    monthlyBudget: 300,
    spent: 129,
    remaining: 171,
    projected: 537,
    members: [
      { picture: null, name: "Bessie Cooper" },
      { picture: null, name: "Floyd Miles" },
      { picture: null, name: "Jerome Bell" },
    ],
  },
];

const DEMO_GUARDRAILS: DemoGuardrail[] = [
  { id: "1", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "2", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "3", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
];

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
      className="flex items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500 border border-border-2"
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
    <div className="h-[7px] w-[44px] shrink-0 rounded-full bg-bg-3 outline outline-1 outline-border-4 overflow-hidden">
      <div
        className={`h-full rounded-full ${exceeded ? "bg-danger-5" : "bg-success-2"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function MemberAvatars({ members }: { members: { picture: string | null; name: string }[] }) {
  return (
    <div className="flex -space-x-1.5">
      {members.slice(0, 4).map((m, i) => (
        <UserAvatar key={i} name={m.name} picture={m.picture} size={24} />
      ))}
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  use(params);

  // TODO: uncomment when backend is ready
  // const { user } = useAuth();
  // const { data: team, isLoading, error } = useQuery({
  //   queryKey: ["teams", id],
  //   queryFn: () => fetchTeam(id),
  // });

  const team = DEMO_TEAM;
  const users = DEMO_USERS;
  const subteams = DEMO_SUBTEAMS;

  const [guardrails, setGuardrails] = useState<DemoGuardrail[]>(DEMO_GUARDRAILS);
  const [budgetInput, setBudgetInput] = useState(
    team.monthlyBudget.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );

  const toggleGuardrail = (gId: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === gId ? { ...g, active: !g.active } : g)),
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Description + Budget card ──────────────────────────────── */}
      <div className="rounded-lg bg-white">
        {/* Description row */}
        <div className="flex items-center gap-4 px-4 sm:px-6 pt-5 pb-8">
          <div className="flex h-[80px] w-[80px] shrink-0 items-center justify-center rounded-full overflow-hidden">
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
          <div className="min-w-0">
            <p className="text-[18px] font-bold text-text-1">Description</p>
            <p className="text-[16px] text-text-1">{team.description}</p>
          </div>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8 lg:items-end px-4 sm:px-6 pb-5">
          {/* Monthly Budget */}
          <div>
            <p className="text-[18px] font-bold text-text-1 mb-2">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">$</span>
              <input
                type="text"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onBlur={() => {
                  setBudgetInput(
                    team.monthlyBudget.toLocaleString("de-DE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                  );
                }}
                className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-7 pr-4 text-[16px] text-text-2 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
          </div>

          {/* Spent / Remaining */}
          <div>
            <p className="text-[18px] font-bold text-text-1 mb-2">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-sm text-black">
                {formatCurrency(team.spent)} / {formatCurrency(team.remaining)}
              </span>
              <SpentBar spent={team.spent} budget={team.monthlyBudget} />
            </div>
          </div>

          {/* Projected */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-2 h-[56px]">
              <span className="text-sm text-black">{team.projected}</span>
              <span
                className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${
                  team.onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"
                }`}
              >
                {team.onTrack ? "On track" : "Over Budget"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Subteams ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[18px] font-bold text-text-1">Subteams</p>
        <Button variant="plusAction" className="h-10 px-6 text-[14px]">
          <Plus className="h-4 w-4 text-black-900" />
          Add Subteam
        </Button>
      </div>
      <div className="rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">Team</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Description</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700" />
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Members</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subteams.map((sub) => {
                const subOverBudget = sub.projected > sub.monthlyBudget;
                return (
                  <tr key={sub.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                    <td className="px-4 sm:px-6 align-middle text-base font-normal text-black whitespace-nowrap">{sub.name}</td>
                    <td className="px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">{sub.description}</td>
                    <td className="px-4 align-middle text-sm text-black whitespace-nowrap">
                      {formatCurrency(sub.monthlyBudget)}
                    </td>
                    <td className="px-4 align-middle">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-black whitespace-nowrap">
                          {formatCurrency(sub.spent)} / {formatCurrency(sub.remaining)}
                        </span>
                        <SpentBar spent={sub.spent} budget={sub.monthlyBudget} />
                        <span className="text-sm text-black whitespace-nowrap">{formatCurrency(sub.projected)}</span>
                        <span
                          className={`rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                            subOverBudget ? "bg-bg-1 text-text-3" : "bg-success-1 text-text-1"
                          }`}
                        >
                          {subOverBudget ? "Will Exceed" : "On track"}
                        </span>
                        <MemberAvatars members={sub.members} />
                      </div>
                    </td>
                    <td className="px-4 align-middle text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-success-7 hover:text-success-7/80">
                            <MoreVertical className="h-4 w-4" />
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Users ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[18px] font-bold text-text-1">Users</p>
        <Button variant="plusAction" className="h-10 px-6 text-[14px]">
          <Plus className="h-4 w-4 text-black-900" />
          Invite Users
        </Button>
      </div>
      <div className="rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Email</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Role</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                  <td className="px-4 sm:px-6 align-middle">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} picture={u.picture} size={24} />
                      <span className="text-base font-normal text-text-1 whitespace-nowrap">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 align-middle text-base font-normal text-text-1 whitespace-nowrap">
                    {u.email}
                  </td>
                  <td className="px-4 align-middle">
                    <Select defaultValue={u.role}>
                      <SelectTrigger className="h-8 w-[110px] border-border-2 text-sm text-text-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Editor">Editor</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                        <SelectItem value="Viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 align-middle text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success-7 hover:text-success-7/80">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600">
                          <UserX className="h-4 w-4" />
                          Remove user
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Guardrails ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[18px] font-bold text-text-1">Guardrails</p>
        <Button variant="plusAction" className="h-10 px-6 text-[14px]">
          <Plus className="h-4 w-4 text-black-900" />
          Add Guardrail
        </Button>
      </div>
      <div className="rounded-lg bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Type</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Severity</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Triggers</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Status</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {guardrails.map((g) => (
                <tr key={g.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                  <td className="px-4 sm:px-6 align-middle">
                    <span className="text-base font-normal text-black whitespace-nowrap">{g.name}</span>
                  </td>
                  <td className="px-4 align-middle">
                    <div className="flex gap-1.5">
                      {g.types.map((t) => (
                        <span key={t} className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[12px] text-text-3 whitespace-nowrap">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 align-middle">
                    <span className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[12px] text-text-3">
                      {g.severity}
                    </span>
                  </td>
                  <td className="px-4 align-middle text-base font-normal text-black">
                    {g.triggers.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 align-middle">
                    <div className="flex items-center gap-2">
                      <Switch checked={g.active} onCheckedChange={() => toggleGuardrail(g.id)} />
                      <span className="text-sm text-black-700 whitespace-nowrap">{g.active ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td className="px-4 align-middle text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success-7 hover:text-success-7/80">
                          <MoreVertical className="h-4 w-4" />
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}