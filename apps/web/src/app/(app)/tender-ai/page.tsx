"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown,
  Plus,
  Search,
  TrendingUp,
  AlertTriangle,
  Calendar,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TenderStatus = "Active" | "Pending" | "Completed";

interface Tender {
  id: string;
  code: string;
  name: string;
  leadManager: string;
  matchRate: number;
  gaps: number;
  deadline: string;
  value: string;
  status: TenderStatus;
}

const TENDERS: Tender[] = [
  {
    id: "1",
    code: "TND-2026-001",
    name: "Enterprise Cloud Migration Services",
    leadManager: "Sarah Mitchell",
    matchRate: 99,
    gaps: 1,
    deadline: "Mar 25, 2026",
    value: "$2.4M",
    status: "Active",
  },
  {
    id: "2",
    code: "TND-2027-015",
    name: "AI-Powered Supply Chain Optimization",
    leadManager: "Elena Ramirez",
    matchRate: 98,
    gaps: 1,
    deadline: "Jan 12, 2027",
    value: "$1.8M",
    status: "Active",
  },
  {
    id: "3",
    code: "TND-2026-008",
    name: "AI-Driven Predictive Maintenance Platform",
    leadManager: "Kenji Tanaka",
    matchRate: 65,
    gaps: 3,
    deadline: "Dec 01, 2026",
    value: "$3.1M",
    status: "Pending",
  },
  {
    id: "4",
    code: "TND-2027-022",
    name: "Next-Gen Cybersecurity Threat Detection",
    leadManager: "Priya Sharma",
    matchRate: 100,
    gaps: 0,
    deadline: "Apr 18, 2027",
    value: "$4.2M",
    status: "Active",
  },
  {
    id: "5",
    code: "TND-2026-011",
    name: "Smart City Infrastructure Management",
    leadManager: "Javier Rodriguez",
    matchRate: 67,
    gaps: 3,
    deadline: "Feb 14, 2027",
    value: "$2.9M",
    status: "Active",
  },
  {
    id: "6",
    code: "TND-2027-005",
    name: "Renewable Energy Grid Optimization",
    leadManager: "Mei Chen",
    matchRate: 45,
    gaps: 5,
    deadline: "May 03, 2027",
    value: "$3.5M",
    status: "Active",
  },
  {
    id: "7",
    code: "TND-2026-019",
    name: "AI-Enhanced Personalized Education Platform",
    leadManager: "Raj Patel",
    matchRate: 89,
    gaps: 2,
    deadline: "Nov 22, 2026",
    value: "$2.1M",
    status: "Completed",
  },
];

const PAGE_SIZE = 7;

const STATUS_STYLES: Record<TenderStatus, string> = {
  Active: "bg-[#EBF8FF] text-[#0369A1]",
  Pending: "bg-[#F7F8FA] text-text-1",
  Completed: "bg-[#E8FFEA] text-[#009A29]",
};

function matchRateColor(rate: number): string {
  if (rate >= 80) return "text-[#009A29]";
  if (rate >= 60) return "text-[#FF7D00]";
  return "text-[#F53F3F]";
}

function matchRateBg(rate: number): string {
  if (rate >= 80) return "bg-[#009A29]";
  if (rate >= 60) return "bg-[#FF7D00]";
  return "bg-[#F53F3F]";
}

interface StatCard {
  label: string;
  value: string;
  change?: string;
  sub?: string;
  icon: typeof TrendingUp;
  iconBg: string;
}

const STATS: StatCard[] = [
  {
    label: "Active Tenders",
    value: "4",
    change: "+12%",
    icon: BarChart3,
    iconBg: "bg-[#EBF8FF] text-primary-6",
  },
  {
    label: "Avg Match Rate",
    value: "86%",
    change: "+5%",
    icon: TrendingUp,
    iconBg: "bg-[#E8FFEA] text-[#009A29]",
  },
  {
    label: "Critical Gaps",
    value: "1",
    icon: AlertTriangle,
    iconBg: "bg-[#FFF3E6] text-[#FF7D00]",
  },
  {
    label: "Upcoming Deadlines",
    value: "3",
    sub: "Next 14d",
    icon: Calendar,
    iconBg: "bg-[#F2F3F5] text-text-2",
  },
];

export default function TenderAiPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);

  useEffect(() => {
    const onSearch = (e: Event) =>
      handleSearch((e as CustomEvent<string>).detail);
    const onCreate = () => {
      window.location.href = "/tender-ai/create";
    };
    window.addEventListener("tender-ai:search", onSearch);
    window.addEventListener("tender-ai:create", onCreate);
    return () => {
      window.removeEventListener("tender-ai:search", onSearch);
      window.removeEventListener("tender-ai:create", onCreate);
    };
  }, [handleSearch]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TENDERS;
    return TENDERS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        t.leadManager.toLowerCase().includes(q),
    );
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Mobile-only header row (desktop search + button live in appbar) */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search tenders..."
            className="h-10 pl-9 placeholder:text-text-3"
          />
        </div>
        <Button
          asChild
          className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
        >
          <Link href="/tender-ai/create">
            <Plus className="h-4 w-4" />
            Create Tender
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.iconBg}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                {s.change && (
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-[#009A29]">
                    <ArrowUpRight className="h-3 w-3" />
                    {s.change}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-[28px] font-bold leading-tight text-text-1">
                  {s.value}
                </span>
                <span className="text-[13px] text-text-2">
                  {s.label}
                  {s.sub && (
                    <span className="ml-2 text-text-3">{s.sub}</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table section */}
      <div className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white">
        {/* Table header */}
        <div className="flex flex-col gap-3 border-b border-border-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[18px] font-bold text-text-1">
            Active Tender Projects
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="cursor-pointer gap-2 text-[13px]"
            >
              <Filter className="h-3.5 w-3.5" />
              Filter
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer gap-2 text-[13px]"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort
            </Button>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                <th className="px-5 py-3">Project Name</th>
                <th className="px-5 py-3">Lead Manager</th>
                <th className="px-5 py-3">Match Rate</th>
                <th className="px-5 py-3">Gap Preview</th>
                <th className="px-5 py-3">Deadline</th>
                <th className="px-5 py-3">Value</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border-2 last:border-b-0 cursor-pointer transition-colors hover:bg-bg-1"
                  onClick={() => (window.location.href = `/tender-ai/${t.id}`)}
                >
                  <td className="px-5 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-text-1">{t.name}</span>
                      <span className="text-[11px] text-text-3">{t.code}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">{t.leadManager}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-1">
                        <div
                          className={`h-full rounded-full ${matchRateBg(t.matchRate)}`}
                          style={{ width: `${t.matchRate}%` }}
                        />
                      </div>
                      <span
                        className={`text-[12px] font-semibold ${matchRateColor(t.matchRate)}`}
                      >
                        {t.matchRate}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {t.gaps === 0 ? (
                      <span className="text-[#009A29]">0 gaps</span>
                    ) : (
                      <span className={t.gaps >= 3 ? "text-[#F53F3F]" : "text-[#FF7D00]"}>
                        {t.gaps} gap{t.gaps !== 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-2">{t.deadline}</td>
                  <td className="px-5 py-4 font-medium text-text-1">
                    {t.value}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[t.status]}`}
                    >
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-[13px] text-text-3"
                  >
                    No tenders match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col md:hidden">
          {paginated.map((t, idx) => (
            <Link
              key={t.id}
              href={`/tender-ai/${t.id}`}
              className={`flex flex-col gap-3 bg-bg-white px-4 py-4 transition-colors hover:bg-bg-1 ${
                idx > 0 ? "border-t border-border-2" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-medium text-text-1">
                    {t.name}
                  </span>
                  <span className="text-[11px] text-text-3">{t.code}</span>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[t.status]}`}
                >
                  {t.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-2">
                  {t.leadManager}
                </span>
                <span className={`text-[13px] font-bold ${matchRateColor(t.matchRate)}`}>
                  {t.matchRate}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12px]">
                <div className="flex flex-col">
                  <span className="text-text-3">Deadline</span>
                  <span className="font-medium text-text-1">{t.deadline}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">Value</span>
                  <span className="font-medium text-text-1">{t.value}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">Gaps</span>
                  <span
                    className={`font-medium ${t.gaps >= 3 ? "text-[#F53F3F]" : t.gaps === 0 ? "text-[#009A29]" : "text-[#FF7D00]"}`}
                  >
                    {t.gaps} gap{t.gaps !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {paginated.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              No tenders match your search.
            </p>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border-2 px-5 py-3">
            <Button
              variant="outline"
              className="cursor-pointer gap-1.5 text-[13px]"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded text-[13px] transition-colors ${
                      p === page
                        ? "bg-primary-6 font-semibold text-white"
                        : "text-text-2 hover:bg-bg-1"
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
            </div>
            <Button
              variant="outline"
              className="cursor-pointer gap-1.5 text-[13px]"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
