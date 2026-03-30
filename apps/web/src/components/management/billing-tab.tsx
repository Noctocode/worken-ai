"use client";

import { useState } from "react";
import { Plus, CreditCard, MoreVertical, Pencil, Trash2, Info, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillingEntry {
  id: string;
  date: string;
  amount: number;
}

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expiry: string;
  isDefault: boolean;
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const BILLING_HISTORY: BillingEntry[] = [
  { id: "1", date: "June 20, 2025", amount: 30099.99 },
  { id: "2", date: "May 20, 2025", amount: 30099.99 },
  { id: "3", date: "April 20, 2025", amount: 30099.99 },
];

const PLAN_FEATURES = [
  "Unlimited projects",
  "Advanced analytics",
  "10GB storage",
  "50 Team Seats",
  "Access to Pro Models",
  "10% Discount to models charging",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SpentBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
      <div className="h-full rounded-full bg-primary-5" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PaymentCard({ method, onToggle }: { method: PaymentMethod; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-bg-1 bg-white px-4 py-3 min-w-[220px]">
      <CreditCard className="h-8 w-8 text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-black">
          {method.brand} ending in
        </p>
        <p className="text-[15px] font-bold text-black">{method.last4}</p>
        <p className="text-[11px] text-slate-400">Expires: {method.expiry}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={method.isDefault} onCheckedChange={onToggle} />
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
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BillingTab() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([
    { id: "1", brand: "Visa", last4: "4242", expiry: "12/26", isDefault: true },
    { id: "2", brand: "Mastercard", last4: "1234", expiry: "08/27", isDefault: false },
  ]);

  const toggleDefault = (id: string) => {
    setPaymentMethods((prev) =>
      prev.map((m) => ({ ...m, isDefault: m.id === id })),
    );
  };

  const spent = 6100;
  const budget = 23900;
  const projected = 30000;

  return (
    <div className="py-6 space-y-5">

      {/* ── Money spent this month ───────────────────────────────────────────── */}
      <div>
        <p className="text-[15px] font-semibold text-black mb-3">Money spent this month</p>
        <div className="bg-white rounded-lg border border-bg-1 px-6 py-4">
          <div className="flex items-center gap-16">
            {/* Spent / Remaining */}
            <div>
              <p className="text-[12px] text-slate-500 mb-1">Spent / Remaining</p>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-black">
                  {formatCurrency(spent)} / {formatCurrency(budget)}
                </span>
                <SpentBar spent={spent} budget={spent + budget} />
                <button className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100">
                  <ExternalLink className="h-3 w-3" />
                  See Company Budget
                </button>
              </div>
            </div>

            {/* Projected */}
            <div>
              <div className="flex items-center gap-1 mb-1">
                <p className="text-[12px] text-slate-500">Projected</p>
                <Info className="h-3 w-3 text-slate-400" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-black">{formatCurrency(projected)}</span>
                <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                  On track
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Plan Details ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[15px] font-semibold text-black mb-3">Plan Details</p>
        <div className="bg-white rounded-lg border border-bg-1 px-6 py-5">
          <div className="flex items-start justify-between">
            {/* Plan info */}
            <div>
              <p className="text-[15px] font-bold text-black">Pro Plan</p>
              <p className="text-[12px] text-slate-400 mb-4">
                $99.99/month · Next billing: July 20, 2025
              </p>
              <p className="text-[13px] font-semibold text-black mb-2">Features:</p>
              <ul className="space-y-0.5">
                {PLAN_FEATURES.map((f) => (
                  <li key={f} className="text-[13px] text-slate-600">{f}</li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="flex flex-col items-end gap-3">
              <Button variant="plusAction">
                <Plus className="h-4 w-4 text-black-900" />
                Upgrade Plan
              </Button>
              <button className="flex items-center gap-1.5 text-[12px] text-slate-400 hover:text-slate-600">
                <Trash2 className="h-3.5 w-3.5" />
                Cancel Subscription
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Billing History ──────────────────────────────────────────────────── */}
      <div>
        <p className="text-[15px] font-semibold text-black mb-3">Billing History</p>
        <div className="bg-white rounded-lg border border-bg-1 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="h-[33px] border-b border-bg-1">
                <th className="px-6 text-left align-middle text-[13px] font-normal text-black-700">Date</th>
                <th className="px-6 text-right align-middle text-[13px] font-normal text-black-700">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {BILLING_HISTORY.map((entry) => (
                <tr key={entry.id} className="h-14 border-b border-bg-1 last:border-0 transition-colors hover:bg-slate-50/50">
                  <td className="px-6 align-middle text-[13px] text-black">{entry.date}</td>
                  <td className="px-6 align-middle text-right">
                    <div className="flex items-center justify-end gap-3">
                      <span className="text-[13px] text-black">
                        {formatCurrency(entry.amount)}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2">
                            <ExternalLink className="h-4 w-4" />
                            View invoice
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

      {/* ── Payment Methods ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[15px] font-semibold text-black">Payment Methods</p>
          <Button variant="plusAction">
            <Plus className="h-4 w-4 text-black-900" />
            Add New Payment Method
          </Button>
        </div>
        <div className="flex flex-wrap gap-4">
          {paymentMethods.map((m) => (
            <PaymentCard key={m.id} method={m} onToggle={() => toggleDefault(m.id)} />
          ))}
        </div>
      </div>

    </div>
  );
}