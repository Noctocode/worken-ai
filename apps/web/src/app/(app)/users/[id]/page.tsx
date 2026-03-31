"use client";

import { use, useState } from "react";
import {
  MoreVertical,
  Trash2,
  Info,
  LayoutList,
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
// import { useAuth } from "@/components/providers";
// import { fetchOrgUser } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Demo data ──────────────────────────────────────────────────────────── */

interface DemoUserTeam {
  id: string;
  name: string;
  role: "Editor" | "Admin" | "Viewer";
}

const DEMO_USERS: Record<string, {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  monthlyBudget: number;
  spent: number;
  remaining: number;
  projected: number;
  onTrack: boolean;
  teams: DemoUserTeam[];
}> = {
  "1": {
    id: "1",
    name: "Bessie Cooper",
    email: "willie.jennings@example.com",
    picture: null,
    monthlyBudget: 300,
    spent: 61,
    remaining: 239,
    projected: 300,
    onTrack: true,
    teams: [
      { id: "1", name: "Design Team", role: "Editor" },
      { id: "2", name: "Marketing", role: "Editor" },
    ],
  },
  "2": {
    id: "2",
    name: "Kathryn Murphy",
    email: "kenzi.lawson@example.com",
    picture: null,
    monthlyBudget: 300,
    spent: 61,
    remaining: 239,
    projected: 300,
    onTrack: true,
    teams: [
      { id: "1", name: "Design Team", role: "Editor" },
    ],
  },
  "3": {
    id: "3",
    name: "Robert Fox",
    email: "debra.holt@example.com",
    picture: null,
    monthlyBudget: 300,
    spent: 61,
    remaining: 239,
    projected: 300,
    onTrack: true,
    teams: [
      { id: "2", name: "Marketing", role: "Admin" },
    ],
  },
  "4": {
    id: "4",
    name: "Dianne Russell",
    email: "nevaeh.simmons@example.com",
    picture: null,
    monthlyBudget: 300,
    spent: 61,
    remaining: 239,
    projected: 300,
    onTrack: true,
    teams: [
      { id: "1", name: "Design Team", role: "Editor" },
      { id: "2", name: "Marketing", role: "Editor" },
    ],
  },
  "5": {
    id: "5",
    name: "Jacob Jones",
    email: "jackson.graham@example.com",
    picture: null,
    monthlyBudget: 300,
    spent: 61,
    remaining: 239,
    projected: 300,
    onTrack: true,
    teams: [
      { id: "1", name: "Design Team", role: "Editor" },
    ],
  },
};

/* ─── Helper components ──────────────────────────────────────────────────── */

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function UserAvatar({ name, picture, size = 56 }: { name: string; picture: string | null; size?: number }) {
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
      className="flex items-center justify-center rounded-full bg-slate-100 text-[18px] font-semibold text-slate-500 border border-border-2"
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

/* ─── Main page ──────────────────────────────────────────────────────────── */

export default function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  // TODO: uncomment when backend is ready
  // const { user: currentUser } = useAuth();
  // const { data: userData, isLoading, error } = useQuery({
  //   queryKey: ["users", id],
  //   queryFn: () => fetchOrgUser(id),
  // });

  const user = DEMO_USERS[id] ?? DEMO_USERS["4"];

  const [budgetInput, setBudgetInput] = useState(
    user.monthlyBudget.toLocaleString("de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );

  return (
    <div className="space-y-6">
      {/* ── User info + Budget card ──────────────────────────────── */}
      <div className="rounded-lg bg-white">
        {/* User info row */}
        <div className="flex items-center justify-between px-6 pt-5 pb-8">
          <div className="flex items-center gap-4">
            <UserAvatar name={user.name} picture={user.picture} size={56} />
            <div>
              <p className="text-[18px] font-bold text-text-1">{user.name}</p>
              <p className="text-[14px] text-text-2">{user.email}</p>
            </div>
          </div>
          <Button variant="outline" className="h-10 gap-2 border-border-2 text-[14px] text-text-1">
            <LayoutList className="h-4 w-4" />
            Activity Log
          </Button>
        </div>

        {/* Budget row */}
        <div className="grid grid-cols-3 gap-8 items-end px-6 pb-5">
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
                    user.monthlyBudget.toLocaleString("de-DE", {
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
                {formatCurrency(user.spent)} / {formatCurrency(user.remaining)}
              </span>
              <SpentBar spent={user.spent} budget={user.monthlyBudget} />
            </div>
          </div>

          {/* Projected */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              <p className="text-[18px] font-bold text-text-1">Projected</p>
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-2 h-[56px]">
              <span className="text-sm text-black">{user.projected}</span>
              <span
                className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${
                  user.onTrack ? "bg-success-1 text-text-1" : "bg-bg-1 text-text-3"
                }`}
              >
                {user.onTrack ? "On track" : "Over Budget"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Teams ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[18px] font-bold text-text-1">Teams</p>
      </div>
      <div className="rounded-lg bg-white overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="h-[33px] border-b border-bg-1">
              <th className="px-6 text-left align-middle text-[13px] font-normal text-black-700">Team</th>
              <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Role</th>
              <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {user.teams.map((t) => (
              <tr key={t.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                <td className="px-6 align-middle text-base font-normal text-text-1">{t.name}</td>
                <td className="px-4 align-middle">
                  <Select defaultValue={t.role}>
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
                        <Trash2 className="h-4 w-4" />
                        Remove from team
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
  );
}