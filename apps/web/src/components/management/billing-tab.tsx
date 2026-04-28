"use client";

import { useState } from "react";
import { Check, AlertTriangle, Lightbulb, Calendar } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanFeature {
  text: string;
}

type PlanIconType = "user-seat" | "team-org" | "per-tender" | "byok";

interface Plan {
  id: string;
  name: string;
  description: string;
  innerCard?: { label: string; value: string };
  features: PlanFeature[];
  iconType: PlanIconType;
}

interface InvoiceEntry {
  id: string;
  invoiceId: string;
  date: string;
  amount: string;
  status: "Paid" | "Unpaid" | "Overdue";
}

interface TeamCostEntry {
  name: string;
  users: number;
  amount: string;
}

// ─── Plan Icon ────────────────────────────────────────────────────────────────
// active: bg #0F52BA, icon white
// inactive: bg #F8FAFC, icon #0F52BA, no border

function PlanIcon({ type, active }: { type: PlanIconType; active: boolean }) {
  // Active: white icon on brand bg. Inactive: brand-colored icon on muted bg.
  // Both rely on currentColor so the inactive state retones in dark mode.
  const containerClass = active
    ? "bg-primary-8 text-white"
    : "bg-bg-2 text-primary-8";

  const icons: Record<PlanIconType, React.ReactNode> = {
    "user-seat": (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 10a3 3 0 100-6 3 3 0 000 6zM4 16c0-2.21 2.69-4 6-4s6 1.79 6 4v1H4v-1z" fill="currentColor" />
      </svg>
    ),
    "team-org": (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <circle cx="10" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M5.5 16c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    ),
    "per-tender": (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    byok: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="4" y="8" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M7 8V5a3 3 0 016 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  };

  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-2.5 ${containerClass}`}>
      {icons[type]}
    </div>
  );
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const PLANS: Plan[] = [
  {
    id: "user-seat",
    name: "User Seat Plan",
    description: "Per-user monthly subscription with unlimited tenders",
    innerCard: { label: "Number of Users", value: "25 users × $149/user" },
    features: [
      { text: "Unlimited tender analysis" },
      { text: "Full platform access per user" },
      { text: "Email & chat support" },
      { text: "7-day data retention" },
    ],
    iconType: "user-seat",
  },
  {
    id: "team-org",
    name: "Team/Organization Plan",
    description: "Volume discounts for enterprise teams",
    features: [
      { text: "Everything in User Seat" },
      { text: "Volume discounts (10+ users)" },
      { text: "Priority support & onboarding" },
      { text: "Custom data retention" },
      { text: "Advanced security features" },
      { text: "SSO & SAML integration" },
    ],
    iconType: "team-org",
  },
  {
    id: "per-tender",
    name: "Per-Tender Plan",
    description: "Pay only for tenders you analyze",
    features: [
      { text: "Credit-based pricing" },
      { text: "No monthly commitment" },
      { text: "Rollover unused credits" },
      { text: "Volume pricing available" },
    ],
    iconType: "per-tender",
  },
  {
    id: "byok",
    name: "BYOK (Bring Your Own Key)",
    description: "Use your own LLM API keys",
    features: [
      { text: "You manage LLM costs" },
      { text: "Platform orchestration fee only" },
      { text: "Full data control" },
      { text: "Any supported LLM provider" },
      { text: "Enterprise SLA available" },
    ],
    iconType: "byok",
  },
];

const INVOICES: InvoiceEntry[] = [
  { id: "1", invoiceId: "INV-2024-86", date: "Jun 1, 2024", amount: "$4,400", status: "Paid" },
  { id: "2", invoiceId: "INV-2024-85", date: "May 1, 2024", amount: "$4,800", status: "Paid" },
  { id: "3", invoiceId: "INV-2024-84", date: "Apr 1, 2024", amount: "$4,200", status: "Paid" },
  { id: "4", invoiceId: "INV-2024-83", date: "Mar 1, 2024", amount: "$3,600", status: "Paid" },
  { id: "5", invoiceId: "INV-2024-82", date: "Feb 1, 2024", amount: "$3,000", status: "Paid" },
];

const TEAM_COSTS: TeamCostEntry[] = [
  { name: "Procurement", users: 12, amount: "$1,850" },
  { name: "Legal", users: 8, amount: "$1,240" },
  { name: "Finance", users: 6, amount: "$890" },
  { name: "Operations", users: 4, amount: "$620" },
];

const USAGE_MONTHS = ["Jan", "Feb", "Mar", "Apr"];
const TOKEN_USAGE = [1100000, 1350000, 1550000, 2050000];

// ─── Sub-components ───────────────────────────────────────────────────────────

function CurrentPlanCard() {
  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[16px] font-bold text-text-heading leading-[24px]">Current Plan</h3>
          <p className="text-[12px] text-text-4 leading-[18px]">Team/Organization Plan - 25 users</p>
        </div>
        <span className="w-fit rounded-[4px] bg-success-3 px-3 py-1.5 text-[13px] font-medium text-success-8">
          Active
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-bg-1 bg-bg-2 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1">Monthly Cost</p>
          <p className="text-[22px] font-bold text-text-heading leading-tight">$3,166</p>
          <p className="text-[11px] text-success-8 mt-0.5">15% volume discount</p>
        </div>
        <div className="rounded-lg border border-bg-1 bg-bg-2 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1">Tokens Used (MTD)</p>
          <p className="text-[22px] font-bold text-text-heading leading-tight">2.2M</p>
          <p className="text-[11px] text-text-4 mt-0.5">~$4,400 LLM cost</p>
        </div>
        <div className="rounded-lg border border-bg-1 bg-bg-2 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1">Billing Cycle</p>
          <p className="text-[22px] font-bold text-text-heading leading-tight">Monthly</p>
          <p className="text-[11px] text-text-4 mt-0.5">Renews Jun 15, 2024</p>
        </div>
        <div className="rounded-lg border border-bg-1 bg-bg-2 px-4 py-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-text-4 mb-1">Budget Status</p>
          <p className="text-[16px] font-bold text-success-8 leading-[24px]">Under Budget</p>
          <p className="text-[11px] text-text-4 mt-0.5">44% of cap used</p>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`relative flex flex-col rounded-lg border p-5 text-left transition-all cursor-pointer ${
        selected
          ? "border-primary-8 bg-bg-white ring-1 ring-primary-8"
          : "border-bg-3 bg-bg-white hover:border-border-5"
      }`}
    >
      {selected && (
        <div className="absolute right-4 top-4">
          <Check className="h-5 w-5 text-primary-8" />
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <PlanIcon type={plan.iconType} active={selected} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-text-heading leading-[20px]">{plan.name}</p>
          <p className="text-[12px] text-text-4 leading-[18px]">{plan.description}</p>
        </div>
      </div>

      {plan.innerCard && (
        <div className="mb-4 w-full rounded-lg border border-border-2 bg-bg-2 px-4 pt-4 pb-5">
          <p className="text-[12px] font-semibold text-text-heading leading-[18px]">{plan.innerCard.label}</p>
          <p className="text-[13px] text-text-4 leading-[19.5px] mt-4">{plan.innerCard.value}</p>
        </div>
      )}

      <div className="space-y-1.5">
        {plan.features.map((f) => (
          <div key={f.text} className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-success-8 shrink-0" />
            <span className="text-[12px] text-text-4 leading-[18px]">{f.text}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

function TokenUsageChart() {
  const yMax = 2400000;
  const yLabels = [2400000, 1800000, 1200000, 600000, 0];
  const chartH = 220;

  const points = TOKEN_USAGE.map((val, i) => ({
    x: (i / (USAGE_MONTHS.length - 1)) * 100,
    y: (1 - val / yMax) * 100,
  }));

  const svgPoints = points.map((p) => `${p.x * 10},${p.y * 10}`).join(" ");
  const areaPoints = `0,1000 ${svgPoints} 1000,1000`;

  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white p-4 sm:p-6">
      <h3 className="text-[16px] font-bold text-text-heading leading-[24px] mb-4">Token Usage & Cost Trends</h3>

      <div className="flex">
        <div className="flex flex-col justify-between pr-2 pb-6" style={{ height: chartH }}>
          {yLabels.map((v) => (
            <span key={v} className="text-[10px] sm:text-[11px] text-text-4 leading-none text-right min-w-[40px] sm:min-w-[55px]">{v}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative border-l border-b border-border-5" style={{ height: chartH }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-dashed border-border-6"
                style={{ top: `${(i / 4) * 100}%` }}
              />
            ))}
            {USAGE_MONTHS.map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-dashed border-border-6"
                style={{ left: `${(i / (USAGE_MONTHS.length - 1)) * 100}%` }}
              />
            ))}
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full overflow-visible text-primary-8"
            >
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={areaPoints} fill="url(#areaGrad)" />
              <polyline
                points={svgPoints}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div className="flex justify-between pt-2">
            {USAGE_MONTHS.map((month) => (
              <span key={month} className="text-[11px] text-text-4">{month}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CostByTeamChart() {
  const yMax = 200;
  const yLabels = [200, 150, 100, 50, 0];
  const barValues = [185, 124, 89, 62];

  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white p-4 sm:p-6">
      <h3 className="text-[16px] font-bold text-text-heading leading-[24px] mb-4">Cost by Team</h3>

      <div className="flex">
        <div className="flex flex-col justify-between pr-2 pb-6 h-[180px]">
          {yLabels.map((v) => (
            <span key={v} className="text-[10px] text-text-4 leading-none text-right min-w-[20px]">{v}</span>
          ))}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative h-[180px] border-l border-b border-border-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-dashed border-border-6"
                style={{ top: `${(i / 4) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end justify-around px-2 gap-3">
              {TEAM_COSTS.map((team, i) => {
                const pct = (barValues[i] / yMax) * 100;
                return (
                  <div
                    key={team.name}
                    className="flex-1 max-w-[100px] bg-primary-8 rounded-t-sm"
                    style={{ height: `${pct}%` }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex justify-around px-2 gap-3 pt-1.5">
            {TEAM_COSTS.map((team) => (
              <span key={team.name} className="flex-1 max-w-[100px] text-[10px] text-text-4 text-center leading-tight">
                {team.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {TEAM_COSTS.map((team) => (
          <div key={team.name} className="flex items-center justify-between text-[11px] leading-[16px]">
            <span className="text-text-4">{team.name}</span>
            <div className="flex items-center gap-4">
              <span className="text-text-4">{team.users} users</span>
              <span className="font-semibold text-text-heading">{team.amount}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetControls() {
  const [budgetCap, setBudgetCap] = useState("10000");

  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white p-4 sm:p-6">
      <h3 className="text-[16px] font-bold text-text-heading leading-[24px] mb-4">Budget Controls</h3>

      <p className="text-[13px] font-bold text-text-heading leading-[18px] mb-2">Monthly Budget Cap</p>

      <div className="flex items-center rounded-lg border border-border-6 bg-bg-white px-3 py-2.5 mb-2">
        <span className="text-[13px] text-text-4 mr-2">$</span>
        <input
          type="text"
          value={budgetCap}
          onChange={(e) => setBudgetCap(e.target.value)}
          className="flex-1 bg-transparent text-[13px] text-text-heading outline-none"
        />
      </div>

      <p className="text-[12px] text-text-4 leading-[18px] mb-2">
        Current usage: $4,400 / $10,000
      </p>

      <div className="h-2.5 w-full rounded-full bg-border-6 overflow-hidden mb-5">
        <div className="h-full rounded-full bg-primary-8" style={{ width: "44%" }} />
      </div>

      <div className="space-y-3">
        {/* Per Figma 4648:60824: in dark mode the alert callouts go neutral
            (page bg + gray border) — the icon alone carries the severity.
            In light mode they keep their tinted amber/green backgrounds. */}
        <div className="flex items-start gap-3 rounded-lg border border-warning-2 bg-warning-1 dark:border-border-4 dark:bg-bg-1 p-3">
          <AlertTriangle className="h-4 w-4 text-warning-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-bold text-text-heading leading-[18px]">Overage Warnings</p>
            <p className="text-[12px] text-text-4 leading-[18px]">
              Alert when approaching 80% of budget cap
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-success-4 bg-success-5 dark:border-text-5 dark:bg-success-1 p-3">
          <Lightbulb className="h-4 w-4 text-success-8 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-bold text-success-8 dark:text-text-1 leading-[18px]">Optimization Suggestion</p>
            <p className="text-[12px] text-text-4 leading-[18px]">
              Switching to BYOK could save approximately $2,200/month based on your usage patterns
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceHistoryTable() {
  return (
    <div className="rounded-lg border border-bg-1 bg-bg-white overflow-hidden">
      <h3 className="text-[16px] font-bold text-text-heading leading-[24px] px-4 sm:px-6 pt-5 pb-3">Invoice History</h3>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="h-[40px] border-y border-bg-1">
              <th className="px-4 sm:px-6 text-left text-[12px] font-medium text-text-2 uppercase tracking-wide">Invoice ID</th>
              <th className="px-4 sm:px-6 text-left text-[12px] font-medium text-text-2 uppercase tracking-wide">Date</th>
              <th className="px-4 sm:px-6 text-right text-[12px] font-medium text-text-2 uppercase tracking-wide">Amount</th>
              <th className="px-4 sm:px-6 text-right text-[12px] font-medium text-text-2 uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((inv) => (
              <tr key={inv.id} className="h-14 border-b border-bg-1 last:border-0 transition-colors hover:bg-bg-1/50">
                <td className="px-4 sm:px-6 font-mono text-[13px] font-medium text-text-heading leading-[19.5px]">{inv.invoiceId}</td>
                <td className="px-4 sm:px-6">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-text-5 shrink-0" />
                    <span className="text-[13px] text-text-4">{inv.date}</span>
                  </div>
                </td>
                <td className="px-4 sm:px-6 text-right text-[13px] font-semibold text-text-heading">{inv.amount}</td>
                <td className="px-4 sm:px-6 text-right">
                  <span className="inline-block rounded-full bg-success-3 px-3 py-0.5 text-[12px] font-medium text-success-8">{inv.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BillingTab() {
  const [selectedPlan, setSelectedPlan] = useState("user-seat");

  return (
    <div className="py-6 space-y-6">
      <CurrentPlanCard />

      <div>
        <h3 className="text-[16px] font-bold text-text-heading leading-[24px] mb-3">Available Plans</h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={selectedPlan === plan.id}
              onSelect={() => setSelectedPlan(plan.id)}
            />
          ))}
        </div>
      </div>

      <TokenUsageChart />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostByTeamChart />
        <BudgetControls />
      </div>

      <InvoiceHistoryTable />
    </div>
  );
}