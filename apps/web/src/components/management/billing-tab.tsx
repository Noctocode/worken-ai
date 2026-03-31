"use client";

import { useState } from "react";
import { Check, AlertTriangle, Lightbulb } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanFeature {
  text: string;
}

interface Plan {
  id: string;
  name: string;
  description: string;
  price?: string;
  features: PlanFeature[];
  icon: React.ReactNode;
}

interface InvoiceEntry {
  id: string;
  invoiceNo: string;
  plan: string;
  date: string;
  amount: number;
  status: "Paid" | "Unpaid" | "Overdue";
}

interface TeamCost {
  name: string;
  amount: number;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function StarIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-6">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 2l2.09 4.26L17 7.27l-3.5 3.41.83 4.82L10 13.4l-4.33 2.1.83-4.82L3 7.27l4.91-1.01L10 2z"
          fill="white"
        />
      </svg>
    </div>
  );
}

function TeamIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F0F5FF]">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M7 10a3 3 0 100-6 3 3 0 000 6zm6 0a3 3 0 100-6 3 3 0 000 6zM3 16c0-2.21 1.79-4 4-4h6c2.21 0 4 1.79 4 4v1H3v-1z"
          fill="#3370FF"
        />
      </svg>
    </div>
  );
}

function TokenIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF7E6]">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="#FF7D00" strokeWidth="2" fill="none" />
        <path d="M10 6v8M7 10h6" stroke="#FF7D00" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function BYOKIcon() {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F0FFF0]">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="4" y="8" width="12" height="8" rx="2" stroke="#009A29" strokeWidth="2" fill="none" />
        <path d="M7 8V5a3 3 0 016 0v3" stroke="#009A29" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const PLANS: Plan[] = [
  {
    id: "star-start",
    name: "Star Start Plan",
    description: "The best starting point for small teams and individuals who need essential AI features.",
    price: "$4,999 / $79/th user",
    features: [
      { text: "All Worken features" },
      { text: "2 models / 500 000 tokens" },
      { text: "Email & file support" },
      { text: "Up to 10 users" },
    ],
    icon: <StarIcon />,
  },
  {
    id: "team-enterprise",
    name: "Team/Enterprise Plan",
    description: "Best for growing teams that need advanced tools, models and dedicated support.",
    price: "Custom pricing",
    features: [
      { text: "Everything in Star Start" },
      { text: "Custom infrastructure setup" },
      { text: "SSO & SAML integration" },
      { text: "Dedicated success manager" },
    ],
    icon: <TeamIcon />,
  },
  {
    id: "per-token",
    name: "Per-Token Plan",
    description: "Pay only for what you use with flexible token-based pricing.",
    features: [
      { text: "Great for basic training" },
      { text: "Pay-per-use model" },
      { text: "Volume-based pricing" },
      { text: "Flexible usage limits" },
    ],
    icon: <TokenIcon />,
  },
  {
    id: "byok",
    name: "BYOK (Bring Your Own Key)",
    description: "Use your own API keys for maximum control and cost management.",
    features: [
      { text: "Percentage on API key" },
      { text: "Full model access" },
      { text: "Use your existing infrastructure" },
      { text: "Granular API configuration" },
    ],
    icon: <BYOKIcon />,
  },
];

const INVOICES: InvoiceEntry[] = [
  { id: "1", invoiceNo: "#00 - 0010101", plan: "Pro", date: "Jun 1, 2025", amount: 14495, status: "Paid" },
  { id: "2", invoiceNo: "#00 - 0010102", plan: "Pro", date: "May 1, 2025", amount: 24935, status: "Paid" },
  { id: "3", invoiceNo: "#00 - 0010103", plan: "Pro", date: "Apr 1, 2025", amount: 6200, status: "Paid" },
  { id: "4", invoiceNo: "#00 - 0010104", plan: "Pro", date: "Mar 1, 2025", amount: 13400, status: "Paid" },
  { id: "5", invoiceNo: "#00 - 0010105", plan: "Pro", date: "Feb 1, 2025", amount: 3000, status: "Paid" },
];

const TEAM_COSTS: TeamCost[] = [
  { name: "Development", amount: 14000 },
  { name: "Design", amount: 6100 },
  { name: "Legal", amount: 3200 },
  { name: "HR", amount: 1400 },
];

// Usage data for the line chart
const USAGE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
const TOKEN_USAGE = [20000, 28000, 32000, 55000, 72000, 95000, 110000, 105000, 118000, 135000, 148000];
const COST_DATA = [8000, 12000, 15000, 25000, 35000, 48000, 55000, 52000, 58000, 65000, 72000];

// ─── Sub-components ───────────────────────────────────────────────────────────

function CurrentPlanCard() {
  return (
    <div className="rounded-lg border border-bg-1 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-text-1">Current Plan</h3>
          <p className="text-[12px] text-text-3">worken/Organization Plan - #Teams</p>
        </div>
        <button className="rounded-md bg-primary-6 px-5 py-1.5 text-[13px] font-medium text-white hover:bg-primary-7 transition-colors">
          Edit
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* Monthly Spend */}
        <div className="rounded-lg bg-bg-1 px-4 py-3">
          <p className="text-[11px] text-text-3 mb-1">Monthly spend</p>
          <p className="text-[20px] font-bold text-text-1">$3,166</p>
          <p className="text-[11px] text-text-3">This month so far</p>
        </div>

        {/* Tokens Used */}
        <div className="rounded-lg bg-bg-1 px-4 py-3">
          <p className="text-[11px] text-text-3 mb-1">Tokens used this month</p>
          <p className="text-[20px] font-bold text-text-1">2.2M</p>
          <p className="text-[11px] text-text-3">out of 5M limit</p>
        </div>

        {/* Billing Cycle */}
        <div className="rounded-lg bg-bg-1 px-4 py-3">
          <p className="text-[11px] text-text-3 mb-1">Billing cycle</p>
          <p className="text-[20px] font-bold text-text-1">Monthly</p>
          <p className="text-[11px] text-text-3">Next: Jul 1, 2025</p>
        </div>

        {/* Budget Status */}
        <div className="rounded-lg bg-bg-1 px-4 py-3">
          <p className="text-[11px] text-text-3 mb-1">Budget status</p>
          <div className="flex items-center gap-2">
            <span className="rounded bg-success-1 px-2 py-0.5 text-[13px] font-semibold text-success-7">
              Under Budget
            </span>
          </div>
          <p className="text-[11px] text-text-3 mt-1">42% of monthly limit</p>
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
      className={`relative flex flex-col rounded-lg border p-5 text-left transition-all ${
        selected
          ? "border-primary-6 bg-white ring-1 ring-primary-6"
          : "border-bg-3 bg-white hover:border-border-3"
      }`}
    >
      {/* Selected check */}
      {selected && (
        <div className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-primary-6">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}

      {/* Icon + Name */}
      <div className="mb-3 flex items-center gap-3">
        {plan.icon}
        <p className="text-[14px] font-semibold text-text-1">{plan.name}</p>
      </div>

      <p className="mb-3 text-[12px] text-text-3 leading-relaxed">{plan.description}</p>

      {plan.price && (
        <p className="mb-3 text-[12px] font-medium text-text-2">{plan.price}</p>
      )}

      {/* Features */}
      <div className="space-y-1.5">
        {plan.features.map((f) => (
          <div key={f.text} className="flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-primary-6 shrink-0" />
            <span className="text-[12px] text-text-2">{f.text}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

function TokenUsageChart() {
  const chartHeight = 200;
  const chartWidth = 700;
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingBottom = 30;
  const paddingTop = 10;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingBottom - paddingTop;

  const yMax = 150000;
  const yLabels = [0, 50000, 100000, 150000];

  const tokenPoints = TOKEN_USAGE.map((val, i) => {
    const x = paddingLeft + (i / (USAGE_MONTHS.length - 1)) * plotWidth;
    const y = paddingTop + plotHeight - (val / yMax) * plotHeight;
    return `${x},${y}`;
  }).join(" ");

  const costPoints = COST_DATA.map((val, i) => {
    const x = paddingLeft + (i / (USAGE_MONTHS.length - 1)) * plotWidth;
    const y = paddingTop + plotHeight - (val / yMax) * plotHeight;
    return `${x},${y}`;
  }).join(" ");

  // Area fill for tokens
  const firstX = paddingLeft;
  const lastX = paddingLeft + plotWidth;
  const baseY = paddingTop + plotHeight;
  const tokenAreaPoints = `${firstX},${baseY} ${tokenPoints} ${lastX},${baseY}`;

  return (
    <div className="rounded-lg border border-bg-1 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-text-1">Token Usage & Cost Trends</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-primary-6" />
            <span className="text-[11px] text-text-3">Tokens</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-success-7" />
            <span className="text-[11px] text-text-3">Cost ($)</span>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((label) => {
          const y = paddingTop + plotHeight - (label / yMax) * plotHeight;
          return (
            <g key={label}>
              <line x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} stroke="#F2F3F5" strokeWidth="1" />
              <text x={paddingLeft - 8} y={y + 4} textAnchor="end" fill="#86909C" fontSize="10">
                {label === 0 ? "0" : `${label / 1000}k`}
              </text>
            </g>
          );
        })}

        {/* X axis labels */}
        {USAGE_MONTHS.map((month, i) => {
          const x = paddingLeft + (i / (USAGE_MONTHS.length - 1)) * plotWidth;
          return (
            <text key={month} x={x} y={chartHeight - 5} textAnchor="middle" fill="#86909C" fontSize="10">
              {month}
            </text>
          );
        })}

        {/* Token area fill */}
        <polygon points={tokenAreaPoints} fill="#EBF8FF" opacity="0.5" />

        {/* Token line */}
        <polyline points={tokenPoints} fill="none" stroke="#178ACA" strokeWidth="2" strokeLinejoin="round" />

        {/* Cost line (dashed) */}
        <polyline points={costPoints} fill="none" stroke="#009A29" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function CostByTeamChart() {
  const maxAmount = Math.max(...TEAM_COSTS.map((t) => t.amount));
  const barMaxHeight = 140;

  return (
    <div className="rounded-lg border border-bg-1 bg-white p-6">
      <h3 className="text-[15px] font-semibold text-text-1 mb-4">Cost by Team</h3>

      <div className="flex items-end gap-6 h-[160px] px-2">
        {TEAM_COSTS.map((team) => {
          const height = (team.amount / maxAmount) * barMaxHeight;
          return (
            <div key={team.name} className="flex flex-1 flex-col items-center gap-1.5">
              <span className="text-[11px] text-text-3">{formatCurrency(team.amount)}</span>
              <div
                className="w-full max-w-[48px] rounded-t bg-primary-6"
                style={{ height: `${height}px` }}
              />
              <span className="text-[11px] text-text-3">{team.name}</span>
            </div>
          );
        })}
      </div>

      {/* Team breakdown table */}
      <div className="mt-5 space-y-2">
        {TEAM_COSTS.map((team) => (
          <div key={team.name} className="flex items-center justify-between text-[12px]">
            <span className="text-text-2">{team.name}</span>
            <span className="font-medium text-text-1">{formatCurrency(team.amount)}</span>
          </div>
        ))}
        <div className="border-t border-bg-1 pt-2 flex items-center justify-between text-[12px]">
          <span className="font-semibold text-text-1">Total</span>
          <span className="font-semibold text-text-1">
            {formatCurrency(TEAM_COSTS.reduce((s, t) => s + t.amount, 0))}
          </span>
        </div>
      </div>
    </div>
  );
}

function BudgetControls() {
  const budgetUsed = 76;

  return (
    <div className="rounded-lg border border-bg-1 bg-white p-6">
      <h3 className="text-[15px] font-semibold text-text-1 mb-4">Budget Controls</h3>

      {/* Budget bar */}
      <div className="mb-5">
        <p className="text-[12px] text-text-3 mb-2">Monthly Budget Cap</p>
        <div className="h-2 w-full rounded-full bg-bg-1 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary-6"
            style={{ width: `${budgetUsed}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-text-3">{budgetUsed}% of budget used</p>
      </div>

      {/* Alerts */}
      <div className="space-y-3">
        {/* Overage Warning */}
        <div className="flex items-start gap-3 rounded-lg border border-[#FFF0E0] bg-[#FFFBF5] p-3">
          <AlertTriangle className="h-4 w-4 text-warning-6 shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-medium text-text-1">Overage Warning</p>
            <p className="text-[11px] text-text-3 leading-relaxed">
              You&apos;re approaching your monthly budget limit. Consider upgrading your plan.
            </p>
          </div>
        </div>

        {/* Optimization Suggestion */}
        <div className="flex items-start gap-3 rounded-lg border border-[#D9F0D9] bg-success-1 p-3">
          <Lightbulb className="h-4 w-4 text-success-7 shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-medium text-text-1">Optimization Suggestion</p>
            <p className="text-[11px] text-text-3 leading-relaxed">
              AI analysis suggests that switching to GPT-4o-mini for batch tasks could reduce costs by 15%.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvoiceHistoryTable({ invoices }: { invoices: InvoiceEntry[] }) {
  return (
    <div className="rounded-lg border border-bg-1 bg-white overflow-hidden">
      <h3 className="text-[15px] font-semibold text-text-1 px-6 pt-5 pb-3">Invoice History</h3>

      <table className="w-full">
        <thead>
          <tr className="h-[36px] border-b border-bg-1 bg-bg-1">
            <th className="px-6 text-left text-[12px] font-medium text-text-3 uppercase tracking-wide">Invoice No.</th>
            <th className="px-6 text-left text-[12px] font-medium text-text-3 uppercase tracking-wide">Plan</th>
            <th className="px-6 text-left text-[12px] font-medium text-text-3 uppercase tracking-wide">Date</th>
            <th className="px-6 text-right text-[12px] font-medium text-text-3 uppercase tracking-wide">Amount</th>
            <th className="px-6 text-right text-[12px] font-medium text-text-3 uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="h-12 border-b border-bg-1 last:border-0 transition-colors hover:bg-slate-50/50">
              <td className="px-6 text-[13px] text-text-2">{inv.invoiceNo}</td>
              <td className="px-6 text-[13px] text-text-2">{inv.plan}</td>
              <td className="px-6 text-[13px] text-text-2">{inv.date}</td>
              <td className="px-6 text-right text-[13px] font-medium text-text-1">
                {formatCurrency(inv.amount)}
              </td>
              <td className="px-6 text-right">
                <span className="inline-block rounded px-2 py-0.5 text-[11px] font-medium bg-success-1 text-success-7">
                  {inv.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BillingTab() {
  const [selectedPlan, setSelectedPlan] = useState("star-start");

  return (
    <div className="py-6 space-y-6">
      {/* ── Current Plan ──────────────────────────────────────────────────────── */}
      <CurrentPlanCard />

      {/* ── Available Plans ───────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-[15px] font-semibold text-text-1 mb-3">Available Plans</h3>
        <div className="grid grid-cols-2 gap-4">
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

      {/* ── Token Usage & Cost Trends ─────────────────────────────────────────── */}
      <TokenUsageChart />

      {/* ── Cost by Team + Budget Controls ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <CostByTeamChart />
        <BudgetControls />
      </div>

      {/* ── Invoice History ───────────────────────────────────────────────────── */}
      <InvoiceHistoryTable invoices={INVOICES} />
    </div>
  );
}