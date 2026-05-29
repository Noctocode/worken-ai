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
import { useLanguage } from "@/lib/i18n";

type TenderStatus = "Active" | "Pending" | "Completed";

const PAGE_SIZE = 7;

const STATUS_STYLES: Record<TenderStatus, string> = {
  Active: "bg-primary-1 text-primary-7",
  Pending: "bg-bg-1 text-text-1",
  Completed: "bg-success-1 text-success-7",
};

function matchRateColor(rate: number): string {
  if (rate >= 80) return "text-success-7";
  if (rate >= 60) return "text-warning-6";
  return "text-danger-6";
}

function matchRateBg(rate: number): string {
  if (rate >= 80) return "bg-success-7";
  if (rate >= 60) return "bg-warning-6";
  return "bg-danger-6";
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

export default function TenderAiPage() {
  const { t } = useLanguage();
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
      toast.success(t("tenderMain.toastDeleted"));
    },
    onError: (err: Error) => {
      toast.error(err.message || t("tenderMain.toastDeleteFailed"));
    },
  });

  const handleDelete = (id: string, name: string) => {
    if (!confirm(t("tenderMain.confirmDelete").replace("{name}", name))) return;
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
  }, [handleSearch, router]);

  const stats = useMemo<StatCard[]>(() => {
    const active = tenders.filter((x) => x.status === "Active").length;
    const rates = tenders.map((x) => x.matchRate ?? 0).filter((r) => r > 0);
    const avgRate =
      rates.length > 0
        ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
        : 0;
    const criticalGaps = tenders.filter((x) => x.gapCount >= 3).length;
    const now = new Date();
    const in14d = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const upcoming = tenders.filter((x) => {
      if (!x.deadline) return false;
      const d = new Date(x.deadline);
      return d >= now && d <= in14d;
    }).length;

    return [
      {
        label: t("tender.activeTenders"),
        value: String(active),
        icon: BarChart3,
        iconBg: "bg-primary-1 text-primary-6",
      },
      {
        label: t("tender.avgMatchRate"),
        value: `${avgRate}%`,
        icon: TrendingUp,
        iconBg: "bg-success-1 text-success-7",
      },
      {
        label: t("tender.criticalGaps"),
        value: String(criticalGaps),
        icon: AlertTriangle,
        iconBg: "bg-warning-1 text-warning-6",
      },
      {
        label: t("tender.upcomingDeadlines"),
        value: String(upcoming),
        sub: t("tender.next14d"),
        icon: Calendar,
        iconBg: "bg-bg-1 text-text-2",
      },
    ];
  }, [tenders, t]);

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
            placeholder={t("tender.search")}
            className="h-10 pl-9 placeholder:text-text-3"
          />
        </div>
        <Button
          asChild
          className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
        >
          <Link href="/tender-ai/create">
            <Plus className="h-4 w-4" />
            {t("tender.create")}
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
                  <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-success-7">
                    <ArrowUpRight className="h-3 w-3" />
                    {s.change}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-[22px] sm:text-[28px] font-bold leading-tight text-text-1">
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
            {t("tender.activeProjects")}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="cursor-pointer gap-2 text-[13px]"
            >
              <Filter className="h-3.5 w-3.5" />
              {t("tender.filter")}
            </Button>
            <Button
              variant="outline"
              className="cursor-pointer gap-2 text-[13px]"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {t("tender.sort")}
            </Button>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                <th className="px-5 py-3">{t("tender.projectName")}</th>
                <th className="px-5 py-3">{t("tender.leadManager")}</th>
                <th className="px-5 py-3">{t("tender.matchRate")}</th>
                <th className="px-5 py-3">{t("tender.gapPreview")}</th>
                <th className="px-5 py-3">{t("tender.deadline")}</th>
                <th className="px-5 py-3">{t("tender.value")}</th>
                <th className="px-5 py-3">{t("common.status")}</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((tender) => (
                <tr
                  key={tender.id}
                  className="border-b border-border-2 last:border-b-0 cursor-pointer transition-colors hover:bg-bg-1"
                  role="link"
                  tabIndex={0}
                  aria-label={`Open tender ${tender.name}`}
                  onClick={() => (router.push(`/tender-ai/${tender.id}`))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/tender-ai/${tender.id}`);
                    }
                  }}
                >
                  <td className="px-5 py-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-text-1">{tender.name}</span>
                      <span className="text-[11px] text-text-3">{tender.code}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">{tender.ownerName ?? "—"}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-1">
                        <div
                          className={`h-full rounded-full ${matchRateBg(tender.matchRate ?? 0)}`}
                          style={{ width: `${tender.matchRate ?? 0}%` }}
                        />
                      </div>
                      <span
                        className={`text-[12px] font-semibold ${matchRateColor(tender.matchRate ?? 0)}`}
                      >
                        {tender.matchRate ?? 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-2">
                    {tender.gapCount === 0 ? (
                      <span className="text-success-7">0 {t("tender.gapPlural")}</span>
                    ) : (
                      <span className={tender.gapCount >= 3 ? "text-danger-6" : "text-warning-6"}>
                        {tender.gapCount} {tender.gapCount !== 1 ? t("tender.gapPlural") : t("tender.gapSingular")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-2">{formatDeadline(tender.deadline)}</td>
                  <td className="px-5 py-4 font-medium text-text-1">
                    {tender.value ?? "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[tender.status as TenderStatus] ?? ""}`}
                    >
                      {tender.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(tender.id, tender.name);
                      }}
                      className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-danger-1 hover:text-danger-6"
                      title={t("tenderMain.titleDelete")}
                      aria-label={`Delete ${tender.name}`}
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
                    {t("tender.noMatch")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="flex flex-col md:hidden">
          {paginated.map((tender, idx) => (
            <Link
              key={tender.id}
              href={`/tender-ai/${tender.id}`}
              className={`flex flex-col gap-3 bg-bg-white px-4 py-4 transition-colors hover:bg-bg-1 ${
                idx > 0 ? "border-t border-border-2" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[14px] font-medium text-text-1">
                    {tender.name}
                  </span>
                  <span className="text-[11px] text-text-3">{tender.code}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLES[tender.status as TenderStatus] ?? ""}`}
                  >
                    {tender.status}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(tender.id, tender.name);
                    }}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-danger-1 hover:text-danger-6"
                    title={t("tenderMain.titleDelete")}
                    aria-label={`Delete ${tender.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-2">
                  {tender.ownerName ?? "—"}
                </span>
                <span className={`text-[13px] font-bold ${matchRateColor(tender.matchRate ?? 0)}`}>
                  {tender.matchRate ?? 0}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12px]">
                <div className="flex flex-col">
                  <span className="text-text-3">{t("tender.deadline")}</span>
                  <span className="font-medium text-text-1">{formatDeadline(tender.deadline)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">{t("tender.value")}</span>
                  <span className="font-medium text-text-1">{tender.value ?? "—"}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-text-3">{t("tender.gapPlural")}</span>
                  <span
                    className={`font-medium ${tender.gapCount >= 3 ? "text-danger-6" : tender.gapCount === 0 ? "text-success-7" : "text-warning-6"}`}
                  >
                    {tender.gapCount} {tender.gapCount !== 1 ? t("tender.gapPlural") : t("tender.gapSingular")}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {paginated.length === 0 && (
            <p className="py-8 text-center text-[13px] text-text-3">
              {t("tender.noMatch")}
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
              {t("tender.previous")}
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
              {t("tender.next")}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
