"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown,
  Loader2,
  Plus,
  Search,
  Trash2,
  TrendingUp,
  AlertTriangle,
  Calendar,
  BarChart3,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteTender, fetchTenders, type TenderSummary } from "@/lib/api";

type TenderStatus = "Active" | "Pending" | "Completed";

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

function formatDeadline(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface StatCard {
  label: string;
  value: string;
  change?: string;
  sub?: string;
  icon: typeof TrendingUp;
  iconBg: string;
}

function computeStats(tenders: TenderSummary[]): StatCard[] {
  const active = tenders.filter((t) => t.status === "Active").length;
  const rates = tenders
    .map((t) => t.matchRate ?? 0)
    .filter((r) => r > 0);
  const avgRate =
    rates.length > 0
      ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
      : 0;
  const criticalGaps = tenders.filter((t) => t.gapCount >= 3).length;
  const now = new Date();
  const in14d = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const upcoming = tenders.filter((t) => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= now && d <= in14d;
  }).length;

  return [
    {
      label: "Active Tenders",
      value: String(active),
      icon: BarChart3,
      iconBg: "bg-[#EBF8FF] text-primary-6",
    },
    {
      label: "Avg Match Rate",
      value: `${avgRate}%`,
      icon: TrendingUp,
      iconBg: "bg-[#E8FFEA] text-[#009A29]",
    },
    {
      label: "Critical Gaps",
      value: String(criticalGaps),
      icon: AlertTriangle,
      iconBg: "bg-[#FFF3E6] text-[#FF7D00]",
    },
    {
      label: "Upcoming Deadlines",
      value: String(upcoming),
      sub: "Next 14d",
      icon: Calendar,
      iconBg: "bg-[#F2F3F5] text-text-2",
    },
  ];
}

export default function TenderAiPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const {
    data: tenders = [],
    isLoading,
  } = useQuery({
    queryKey: ["tenders"],
    queryFn: fetchTenders,
  });

  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: deleteTender,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenders"] });
      toast.success("Tender deleted.");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete tender.");
    },
  });

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This action cannot be undone.`)) return;
    removeMutation.mutate(id);
  };

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    setPage(1);
  }, []);

  const router = useRouter();

  useEffect(() => {
    const onSearch = (e: Event) =>
      handleSearch((e as CustomEvent<string>).detail);
    const onCreate = () => {
      router.push("/tender-ai/create");
    };
    window.addEventListener("tender-ai:search", onSearch);
    window.addEventListener("tender-ai:create", onCreate);
    return () => {
      window.removeEventListener("tender-ai:search", onSearch);
      window.removeEventListener("tender-ai:create", onCreate);
    };
  }, [handleSearch]);

  const stats = useMemo(() => computeStats(tenders), [tenders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenders;
    return tenders.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.ownerName ?? "").toLowerCase().includes(q),
    );
  }, [query, tenders]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-3" />
      </div>
    );
  }

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
        {stats.map((s) => {
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
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border-2 last:border-b-0 cursor-pointer transition-colors hover:bg-bg-1"
                  role="link"
                  tabIndex={0}
                  aria-label={`Open tender ${t.name}`}
                  onClick={() => (router.push(`/tender-ai/${t.id}`))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/tender-ai/${t.id}`);
                    }
                  }}
                >
                  <td className="px-5 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-text-1">{t.name}</span>
                      <span className="text-[11px] text-text-3">{t.code}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">{t.ownerName ?? "—"}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-1">
                        <div
                          className={`h-full rounded-full ${matchRateBg(t.matchRate ?? 0)}`}
                          style={{ width: `${t.matchRate ?? 0}%` }}
                        />
                      </div>
                      <span
                        className={`text-[12px] font-semibold ${matchRateColor(t.matchRate ?? 0)}`}
                      >
                        {t.matchRate ?? 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {t.gapCount === 0 ? (
                      <span className="text-[#009A29]">0 gaps</span>
                    ) : (
                      <span className={t.gapCount >= 3 ? "text-[#F53F3F]" : "text-[#FF7D00]"}>
                        {t.gapCount} gap{t.gapCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-2">{formatDeadline(t.deadline)}</td>
                  <td className="px-5 py-4 font-medium text-text-1">
                    {t.value ?? "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[t.status as TenderStatus] ?? ""}`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(t.id, t.name);
                      }}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-[#FFECE8] hover:text-[#F53F3F]"
                      title="Delete tender"
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[t.status as TenderStatus] ?? ""}`}
                  >
                    {t.status}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(t.id, t.name);
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-[#FFECE8] hover:text-[#F53F3F]"
                    title="Delete tender"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-2">
                  {t.ownerName ?? "—"}
                </span>
                <span className={`text-[13px] font-bold ${matchRateColor(t.matchRate ?? 0)}`}>
                  {t.matchRate ?? 0}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12px]">
                <div className="flex flex-col">
                  <span className="text-text-3">Deadline</span>
                  <span className="font-medium text-text-1">{formatDeadline(t.deadline)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">Value</span>
                  <span className="font-medium text-text-1">{t.value ?? "—"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">Gaps</span>
                  <span
                    className={`font-medium ${t.gapCount >= 3 ? "text-[#F53F3F]" : t.gapCount === 0 ? "text-[#009A29]" : "text-[#FF7D00]"}`}
                  >
                    {t.gapCount} gap{t.gapCount !== 1 ? "s" : ""}
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
