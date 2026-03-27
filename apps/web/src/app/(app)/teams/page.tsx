"use client";

import Link from "next/link";
import {
  Plus,
  Users,
  Loader2,
  MoreVertical,
  Eye,
  Crown,
  UserX,
  Bot,
  Pencil,
  Trash2,
  ShieldCheck,
  Info,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  PageTabsContent,
} from "@/components/ui/page-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { InviteUserDialog } from "@/components/invite-user-dialog";
import { AddModelDialog } from "@/components/add-model-dialog";
import { useAuth } from "@/components/providers";
import { fetchTeams, fetchOrgUsers, removeOrgUser, type Team, type OrgUser } from "@/lib/api";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { MODELS } from "@/lib/models";

// ─── Teams ────────────────────────────────────────────────────────────────────

function TeamRow({ team, isOwner }: { team: Team; isOwner: boolean }) {
  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {team.name}
          {isOwner && (
            <Badge
              variant="secondary"
              className="gap-1 text-[11px] border-amber-200 bg-amber-50 text-amber-700"
            >
              <Crown className="h-3 w-3" />
              Owner
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-base font-normal text-black">—</td>
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/teams/${team.id}`} className="gap-2">
                <Eye className="h-4 w-4" />
                View team
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Users ────────────────────────────────────────────────────────────────────

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const exceeded = spent > budget;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${exceeded ? "bg-red-500" : "bg-primary-5"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function UserRow({ user }: { user: OrgUser }) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => removeOrgUser(user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-users"] });
    },
  });

  const budget = user.monthlyBudget ?? 0;
  const spent = user.spent ?? 0;
  const remaining = budget - spent;
  const projected = user.projected ?? 0;
  const willExceed = projected > budget;

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      {/* Name */}
      <td className="px-4 align-middle text-base font-normal text-black">
        <div className="flex items-center gap-2">
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt={user.name ?? user.email}
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
              {(user.name ?? user.email).charAt(0).toUpperCase()}
            </div>
          )}
          <span>{user.name ?? "—"}</span>
        </div>
      </td>
      {/* Email */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {user.email}
      </td>
      {/* Teams */}
      <td className="px-4 align-middle">
        <div className="flex flex-wrap gap-1">
          {user.teams && user.teams.length > 0 ? (
            user.teams.map((t) => (
              <span
                key={t}
                className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600"
              >
                {t}
              </span>
            ))
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
      </td>
      {/* Personal Monthly Budget */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {budget > 0 ? `$${budget}` : "—"}
      </td>
      {/* Spent / Remaining */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-2">
          <span className="text-sm text-black">
            ${spent} / ${remaining < 0 ? 0 : remaining}
          </span>
          <SpentBar spent={spent} budget={budget} />
        </div>
      </td>
      {/* Projected */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-2">
          <span className="text-sm text-black">${projected}</span>
          {willExceed && (
            <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-500">
              Will Exceed
            </span>
          )}
        </div>
      </td>
      {/* Actions */}
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="gap-2 text-red-600 focus:text-red-600"
              disabled={removeMutation.isPending}
              onClick={() => removeMutation.mutate()}
            >
              <UserX className="h-4 w-4" />
              Remove user
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Models ───────────────────────────────────────────────────────────────────

function ModelRow({ model }: { model: (typeof MODELS)[number] }) {
  const [active, setActive] = useState(true);

  // For demo purposes fallbacks are the other models
  const fallbacks = MODELS.filter((m) => m.id !== model.id);

  return (
    <tr className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
      {/* Custom Name */}
      <td className="px-4 align-middle text-base font-normal text-black">
        {model.label}
      </td>
      {/* Status */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-2">
          <Switch checked={active} onCheckedChange={setActive} />
          <span className="text-sm text-black-700">{active ? "Active" : "Inactive"}</span>
        </div>
      </td>
      {/* Model */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-slate-400" />
          <span className="text-base font-normal text-black">{model.label}</span>
        </div>
      </td>
      {/* Fallback models */}
      <td className="px-4 align-middle">
        <div className="flex items-center gap-1.5 flex-wrap">
          {fallbacks.map((fb) => (
            <span
              key={fb.id}
              className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] text-slate-700"
            >
              <Bot className="h-3 w-3 text-slate-400" />
              {fb.label}
            </span>
          ))}
        </div>
      </td>
      {/* Actions */}
      <td className="px-4 align-middle text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-slate-600"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="gap-2">
              <Eye className="h-4 w-4" />
              Edit model
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ─── Company ──────────────────────────────────────────────────────────────────

interface CompanyAdmin {
  id: string;
  name: string;
  email: string;
  picture?: string;
  teams: string[];
}

interface CompanyGuardrail {
  id: string;
  name: string;
  types: string[];
  severity: "high" | "medium" | "low";
  triggers: number;
  active: boolean;
}

const DEMO_ADMINS: CompanyAdmin[] = [
  { id: "1", name: "Bessie Cooper", email: "willie.jennings@example.com", teams: ["Marketing", "Design", "Sales"] },
  { id: "2", name: "Kathryn Murphy", email: "kanzi.lawson@example.com", teams: ["Marketing", "Design"] },
  { id: "3", name: "Robert Fox", email: "debra.holt@example.com", teams: ["Marketing", "Design"] },
];

const DEMO_GUARDRAILS: CompanyGuardrail[] = [
  { id: "1", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "2", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
  { id: "3", name: "Content Safety Filter", types: ["Content Safety", "Input"], severity: "high", triggers: 1247, active: true },
];

const SEVERITY_COLORS: Record<string, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-emerald-600",
};

function CompanyTab() {
  const [monthlyBudget, setMonthlyBudget] = useState("30000.00");
  const [guardrails, setGuardrails] = useState<CompanyGuardrail[]>(DEMO_GUARDRAILS);

  const spent = 6100;
  const budget = parseFloat(monthlyBudget) || 0;
  const remaining = budget - spent;
  const projected = 30000;
  const onTrack = projected <= budget;
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  const toggleGuardrail = (id: string) => {
    setGuardrails((prev) =>
      prev.map((g) => (g.id === id ? { ...g, active: !g.active } : g)),
    );
  };

  return (
    <div className="py-6 space-y-6">
      {/* Company card */}
      <div className="bg-white rounded-lg px-6 py-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-slate-500 text-xl font-bold">
              C
            </div>
            <div>
              <p className="text-[16px] font-semibold text-black">Company Name</p>
              <p className="text-[13px] text-slate-500">nevaeh.simmons@example.com</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-600">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Budget stats */}
        <div className="grid grid-cols-3 gap-8">
          {/* Monthly Budget */}
          <div>
            <p className="text-[13px] font-medium text-black-700 mb-2">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
              <input
                type="number"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
                className="w-full rounded-md border border-black-600 bg-transparent pl-6 pr-3 py-2 text-sm text-black outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
          </div>

          {/* Spent / Remaining */}
          <div>
            <p className="text-[13px] font-medium text-black-700 mb-2">Spent / Remaining</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-black">
                ${spent.toLocaleString()} / ${remaining > 0 ? remaining.toLocaleString() : 0}
              </span>
              <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${remaining < 0 ? "bg-red-500" : "bg-primary-5"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Projected */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              <p className="text-[13px] font-medium text-black-700">Projected</p>
              <Info className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-black">{projected.toLocaleString()}</span>
              <span
                className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${
                  onTrack
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-red-50 text-red-500"
                }`}
              >
                {onTrack ? "On track" : "Will Exceed"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Admins section */}
      <div className="bg-white rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-bg-1">
          <p className="text-[15px] font-semibold text-black">Admins</p>
        </div>
        <table className="w-full">
          <thead>
            <tr className="h-[33px] border-b border-bg-1">
              <th className="px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
              <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Email</th>
              <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Teams</th>
              <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_ADMINS.map((admin) => (
              <tr key={admin.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                <td className="px-6 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                      {admin.name.charAt(0)}
                    </div>
                    <span className="text-base font-normal text-black">{admin.name}</span>
                  </div>
                </td>
                <td className="px-4 align-middle text-base font-normal text-black">{admin.email}</td>
                <td className="px-4 align-middle">
                  <div className="flex flex-wrap gap-1">
                    {admin.teams.map((t) => (
                      <span key={t} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 align-middle text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600">
                        <UserX className="h-4 w-4" />
                        Remove admin
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Primary Guardrails section */}
      <div className="bg-white rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-bg-1">
          <p className="text-[15px] font-semibold text-black">Primary Guardrails</p>
          <Button variant="plusAction">
            <Plus className="h-4 w-4 text-black-900" />
            Add Guardrail
          </Button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="h-[33px] border-b border-bg-1">
              <th className="px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
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
                <td className="px-6 align-middle">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-slate-400" />
                    <span className="text-base font-normal text-black">{g.name}</span>
                  </div>
                </td>
                <td className="px-4 align-middle">
                  <div className="flex gap-1.5">
                    {g.types.map((t) => (
                      <span key={t} className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 align-middle">
                  <span className={`text-sm font-medium ${SEVERITY_COLORS[g.severity]}`}>
                    {g.severity}
                  </span>
                </td>
                <td className="px-4 align-middle text-base font-normal text-black">
                  {g.triggers.toLocaleString()}
                </td>
                <td className="px-4 align-middle">
                  <div className="flex items-center gap-2">
                    <Switch checked={g.active} onCheckedChange={() => toggleGuardrail(g.id)} />
                    <span className="text-sm text-black-700">{g.active ? "Active" : "Inactive"}</span>
                  </div>
                </td>
                <td className="px-4 align-middle text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
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
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsPage() {
  const { user } = useAuth();
  const [teamSearch, setTeamSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [modelSearch, setModelSearch] = useState("");

  const {
    data: teams,
    isLoading: teamsLoading,
    error: teamsError,
  } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
  });

  const {
    data: orgUsers,
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });

  const filteredTeams = teams?.filter((t) =>
    t.name.toLowerCase().includes(teamSearch.toLowerCase()),
  );

  const filteredUsers = orgUsers?.filter(
    (u) =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(userSearch.toLowerCase()),
  );

  const filteredModels = MODELS.filter(
    (m) =>
      m.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase()),
  );

  return (
    <PageTabs defaultValue="teams">
      <PageTabsList>
        <PageTabsTrigger value="teams">Teams</PageTabsTrigger>
        <PageTabsTrigger value="users">Users</PageTabsTrigger>
        <PageTabsTrigger value="models">Models</PageTabsTrigger>
        <PageTabsTrigger value="my-account">My Account</PageTabsTrigger>
        <PageTabsTrigger value="company">Company</PageTabsTrigger>
        <PageTabsTrigger value="api">API</PageTabsTrigger>
        <PageTabsTrigger value="billing">Billing</PageTabsTrigger>
        <PageTabsTrigger value="integration">Integration</PageTabsTrigger>
      </PageTabsList>

      {/* ── Teams tab ────────────────────────────────────────────────────────── */}
      <PageTabsContent value="teams">
        <div className="flex items-center gap-6 py-5">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Teams
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={teamSearch}
            onChange={(e) => setTeamSearch(e.target.value)}
          />
          {user?.isPaid && (
            <CreateTeamDialog>
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Create Team
              </Button>
            </CreateTeamDialog>
          )}
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Team</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Description</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Monthly Budget</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Spent / Remaining</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Projected</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Members</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teamsLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}
              {teamsError && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle text-sm text-red-500">
                    Failed to load teams. Is the API running?
                  </td>
                </tr>
              )}
              {filteredTeams?.map((team) => (
                <TeamRow
                  key={team.id}
                  team={team}
                  isOwner={user?.id === team.ownerId}
                />
              ))}
              {!teamsLoading && !teamsError && filteredTeams?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      {teamSearch
                        ? "No teams match your search."
                        : user?.isPaid
                          ? "No teams yet. Create your first team to get started."
                          : "You are not a member of any team yet."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Users tab ────────────────────────────────────────────────────────── */}
      <PageTabsContent value="users">
        <div className="flex items-center gap-6 py-5">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Users
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
          {user?.isPaid && (
            <InviteUserDialog>
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Invite User
              </Button>
            </InviteUserDialog>
          )}
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Email</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Teams</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Personal Monthly Budget</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Spent/Remaining</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Projected</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersLoading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                  </td>
                </tr>
              )}
              {usersError && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle text-sm text-red-500">
                    Failed to load users. Is the API running?
                  </td>
                </tr>
              )}
              {filteredUsers?.map((u) => (
                <UserRow key={u.id} user={u} />
              ))}
              {!usersLoading && !usersError && filteredUsers?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center align-middle">
                    <Users className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      {userSearch
                        ? "No users match your search."
                        : "No users yet. Invite someone to get started."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Models tab ───────────────────────────────────────────────────────── */}
      <PageTabsContent value="models">
        <div className="flex items-center gap-6 py-5">
          <span className="text-[18px] font-bold text-black-900 whitespace-nowrap">
            Models
          </span>
          <SearchInput
            className="flex-1"
            placeholder="Search"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
          />
          <AddModelDialog>
            <Button variant="plusAction">
              <Plus className="h-4 w-4 text-black-900" />
              Add New Model
            </Button>
          </AddModelDialog>
        </div>

        <div className="overflow-x-auto bg-white rounded-lg">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Custom Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Status</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Model</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Fallback models</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredModels.map((model) => (
                <ModelRow key={model.id} model={model} />
              ))}
              {filteredModels.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center align-middle">
                    <Bot className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-3 text-sm text-slate-500">
                      No models match your search.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PageTabsContent>

      {/* ── Remaining tabs ───────────────────────────────────────────────────── */}
      <PageTabsContent value="my-account">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="company">
        <CompanyTab />
      </PageTabsContent>
      <PageTabsContent value="api">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="billing">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
      <PageTabsContent value="integration">
        <div className="py-16 text-center text-sm text-slate-400">Coming soon.</div>
      </PageTabsContent>
    </PageTabs>
  );
}