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
  { id: "2", name: "Kathryn Murphy", email: "kenzi.lawson@example.com", teams: ["Marketing", "Design"] },
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
      <div className="bg-bg-white rounded p-4 space-y-[30px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500 text-2xl font-bold">
              C
            </div>
            <div className="space-y-3">
              <p className="text-[18px] font-bold text-text-1">Company Name</p>
              <p className="text-[16px] text-text-1">nevaeh.simmons@example.com</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="h-6 w-6 text-text-2 hover:text-text-1">
              <Pencil className="h-6 w-6" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-text-2 hover:text-text-1">
              <Trash2 className="h-6 w-6" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Monthly Budget */}
          <div className="space-y-3">
            <p className="text-[18px] font-bold text-text-1">Monthly Budget</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[16px] text-text-2">$</span>
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
              <div className="h-[7px] w-[68px] shrink-0 rounded-full border border-border-4 overflow-hidden">
                <div
                  className={`h-full rounded-full ${remaining < 0 ? "bg-danger-5" : "bg-success-2"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
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
                  <th className="bg-bg-white px-4 py-2 text-left align-middle text-[13px] font-normal text-text-2">Teams</th>
                  <th className="bg-bg-white px-4 py-2 text-center align-middle text-[13px] font-normal text-text-2 w-[93px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_ADMINS.map((admin) => (
                  <tr key={admin.id} className="h-14">
                    <td className="bg-bg-white px-4 align-middle w-[300px]">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-500">
                          {admin.name.charAt(0)}
                        </div>
                        <span className="text-[16px] text-text-1 whitespace-nowrap">{admin.name}</span>
                      </div>
                    </td>
                    <td className="bg-bg-white px-4 align-middle text-[16px] text-text-1 whitespace-nowrap">{admin.email}</td>
                    <td className="bg-bg-white px-4 align-middle">
                      <div className="flex gap-2.5">
                        {admin.teams.map((t) => (
                          <span key={t} className="text-[16px] text-text-1 whitespace-nowrap">
                            {t}
                          </span>
                        ))}
                      </div>
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
                            <DropdownMenuItem className="gap-2 text-red-600 focus:text-red-600">
                              <UserX className="h-4 w-4" />
                              Remove admin
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

      {/* Primary Guardrails */}
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
      </div>
    </div>
  );
}