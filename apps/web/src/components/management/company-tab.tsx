"use client";

import { useState } from "react";
import {
  Plus,
  MoreVertical,
  UserX,
  Pencil,
  Trash2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/utils";

interface CompanyAdmin {
  id: string;
  name: string;
  email: string;
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

export function CompanyTab() {
  const [monthlyBudget, setMonthlyBudget] = useState(30000);
  const [budgetInput, setBudgetInput] = useState(
    (30000).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
  const [guardrails, setGuardrails] = useState<CompanyGuardrail[]>(DEMO_GUARDRAILS);

  const spent = 6100;
  const budget = monthlyBudget;
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
      <div className="bg-white rounded-lg px-4 sm:px-6 py-5">
        <div className="flex items-start justify-between gap-2 mb-6 overflow-hidden">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 text-xl font-bold">
              C
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-black truncate">Company Name</p>
              <p className="text-[13px] text-slate-500 truncate">nevaeh.simmons@example.com</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-success-7 hover:text-success-7/80">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-success-7 hover:text-success-7/80">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8 lg:items-end">
          {/* Monthly Budget */}
          <div>
            <p className="text-[13px] font-medium text-black-700 mb-2">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-2">$</span>
              <input
                type="text"
                value={budgetInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\./g, "").replace(",", ".");
                  const num = parseFloat(raw);
                  if (!isNaN(num)) {
                    setMonthlyBudget(num);
                  }
                  setBudgetInput(e.target.value);
                }}
                onBlur={() => {
                  setBudgetInput(
                    monthlyBudget.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  );
                }}
                className="w-full h-[56px] rounded border border-border-4 bg-transparent pl-6 pr-3 text-[16px] text-text-2 outline-none focus:border-ring focus:ring-[1px] focus:ring-ring/50"
              />
            </div>
          </div>

          {/* Spent / Remaining */}
          <div>
            <p className="text-[13px] font-medium text-black-700 mb-2">Spent / Remaining</p>
            <div className="flex items-center gap-3 h-[56px]">
              <span className="text-sm text-black">
                {formatCurrency(spent)} / {remaining > 0 ? formatCurrency(remaining) : formatCurrency(0)}
              </span>
              <div className="h-[7px] w-[44px] shrink-0 rounded-full bg-bg-3 outline outline-1 outline-border-4 overflow-hidden">
                <div
                  className={`h-full rounded-full ${remaining < 0 ? "bg-danger-5" : "bg-success-2"}`}
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
            <div className="flex items-center gap-2 h-[56px]">
              <span className="text-sm text-black">{formatCurrency(projected)}</span>
              <span
                className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${
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
      <div className="bg-white rounded-lg overflow-hidden">
        <div className="py-4 px-4 sm:px-0">
          <p className="text-[15px] font-semibold text-black">Admins</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px]">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-4 sm:px-6 text-left align-middle text-[13px] font-normal text-black-700">Name</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Email</th>
                <th className="px-4 text-left align-middle text-[13px] font-normal text-black-700">Teams</th>
                <th className="px-4 text-right align-middle text-[13px] font-normal text-black-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_ADMINS.map((admin) => (
                <tr key={admin.id} className="h-14 border-b border-bg-1 transition-colors hover:bg-slate-50/50">
                  <td className="px-4 sm:px-6 align-middle">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                        {admin.name.charAt(0)}
                      </div>
                      <span className="text-base font-normal text-black whitespace-nowrap">{admin.name}</span>
                    </div>
                  </td>
                  <td className="px-4 align-middle text-base font-normal text-black whitespace-nowrap">{admin.email}</td>
                  <td className="px-4 align-middle">
                    <div className="flex flex-wrap gap-1">
                      {admin.teams.map((t) => (
                        <span key={t} className="rounded-sm bg-bg-1 px-1.5 py-0.5 text-[12px] text-text-3 whitespace-nowrap">
                          {t}
                        </span>
                      ))}
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
      </div>

      {/* Primary Guardrails */}
      <div className="bg-white rounded-lg overflow-hidden">
        <div className="flex items-center justify-between py-4 px-4 sm:px-0">
          <p className="text-[15px] font-semibold text-black">Primary Guardrails</p>
          <Button variant="plusAction">
            <Plus className="h-4 w-4 text-black-900" />
            Add Guardrail
          </Button>
        </div>
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
                    {g.triggers.toLocaleString()}
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