"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  DollarSign,
  Download,
  Search,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchObservabilityCostByProvider,
  fetchObservabilityEvents,
  fetchObservabilityGuardrailActivity,
  fetchObservabilitySummary,
  fetchObservabilityTokenUsage,
  ForbiddenError,
  type ObservabilityCostByProvider,
  type ObservabilityEvent,
  type ObservabilityEvents,
  type ObservabilityGuardrailActivity,
  type ObservabilityRange,
  type ObservabilitySummary,
  type ObservabilityTokenUsage,
} from "@/lib/api";

const RANGE_OPTIONS: { value: ObservabilityRange; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const EVENT_TYPE_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "arena_call", label: "Model calls" },
  { value: "evaluator_call", label: "Evaluator calls" },
  { value: "arena_attachment_ocr", label: "OCR" },
  { value: "guardrail_trigger", label: "Guardrail triggers" },
];

function formatUsd(n: number): string {
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0";
  return `$${n.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatLatency(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatDelta(current: number, previous: number): {
  text: string;
  trend: "up" | "down" | "flat";
} {
  if (previous === 0 && current === 0) return { text: "no change", trend: "flat" };
  if (previous === 0) return { text: "new", trend: "up" };
  const diff = current - previous;
  const pct = (diff / previous) * 100;
  if (Math.abs(pct) < 0.1) return { text: "no change", trend: "flat" };
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}% vs previous period`,
    trend: pct > 0 ? "up" : "down",
  };
}

function bucketTickFormatter(
  granularity: "hour" | "day" | "week",
): (value: string) => string {
  return (value) => {
    const d = new Date(value);
    if (granularity === "hour") {
      return d.toLocaleTimeString([], { hour: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function eventsToCsv(events: ObservabilityEvent[]): string {
  const header = [
    "createdAt",
    "user",
    "team",
    "eventType",
    "model",
    "provider",
    "tokens",
    "costUsd",
    "latencyMs",
    "success",
    "errorMessage",
    "promptPreview",
  ];
  const rows = events.map((e) =>
    [
      e.createdAt,
      e.userName ?? e.userEmail ?? e.userId,
      e.teamName ?? "",
      e.eventType,
      e.model ?? "",
      e.provider ?? "",
      e.totalTokens ?? "",
      e.costUsd ?? "",
      e.latencyMs ?? "",
      e.success ? "true" : "false",
      e.errorMessage ?? "",
      e.promptPreview ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadCsv(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const PAGE_SIZE = 25;

export default function ObservabilityPage() {
  const [range, setRange] = useState<ObservabilityRange>("7d");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState<string>("all");
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<ObservabilitySummary | null>(null);
  const [tokenUsage, setTokenUsage] = useState<ObservabilityTokenUsage | null>(null);
  const [costByProvider, setCostByProvider] =
    useState<ObservabilityCostByProvider | null>(null);
  const [events, setEvents] = useState<ObservabilityEvents | null>(null);
  const [guardrails, setGuardrails] =
    useState<ObservabilityGuardrailActivity | null>(null);

  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Top-level data: refetch when range changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    Promise.all([
      fetchObservabilitySummary(range),
      fetchObservabilityTokenUsage(range),
      fetchObservabilityCostByProvider(range),
      fetchObservabilityGuardrailActivity(range),
    ])
      .then(([s, t, c, g]) => {
        if (cancelled) return;
        setSummary(s);
        setTokenUsage(t);
        setCostByProvider(c);
        setGuardrails(g);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ForbiddenError) {
          setForbidden(true);
          return;
        }
        const message = err instanceof Error ? err.message : "Couldn't load metrics.";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Events table: reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [range, search, eventType]);

  // Events table: refetch on filter/page changes
  useEffect(() => {
    if (forbidden) return;
    let cancelled = false;
    fetchObservabilityEvents({
      range,
      search: search.trim() || undefined,
      eventType: eventType === "all" ? undefined : eventType,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ForbiddenError) {
          setForbidden(true);
          return;
        }
        const message = err instanceof Error ? err.message : "Couldn't load events.";
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [range, search, eventType, page, forbidden]);

  const handleExport = () => {
    if (!events?.events?.length) {
      toast.error("Nothing to export.");
      return;
    }
    const csv = eventsToCsv(events.events);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    downloadCsv(`observability-${range}-${ts}.csv`, csv);
  };

  const totalPages = useMemo(() => {
    if (!events) return 1;
    return Math.max(1, Math.ceil(events.total / events.pageSize));
  }, [events]);

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border-2 bg-bg-white px-6 py-16 text-center">
        <ShieldAlert className="h-10 w-10 text-text-3" strokeWidth={1.5} />
        <h2 className="text-[18px] font-semibold text-text-1">Admin access required</h2>
        <p className="max-w-[420px] text-[13px] text-text-2">
          The Observability dashboard surfaces org-wide usage data, so it&apos;s
          limited to admin accounts. Ask your admin to grant access if you need
          to monitor model spend or activity.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Header / time range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[13px] text-text-2">
            Real-time audit trail of all AI interactions and spend across the org.
          </p>
        </div>
        <Select
          value={range}
          onValueChange={(v) => setRange(v as ObservabilityRange)}
        >
          <SelectTrigger className="h-10 w-[200px] rounded-md border-border-2 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Total Cost"
          value={summary ? formatUsd(summary.current.totalCost) : "—"}
          delta={summary ? formatDelta(summary.current.totalCost, summary.previous.totalCost) : null}
          loading={loading}
        />
        <KpiCard
          icon={Activity}
          label="Total Token Usage"
          value={summary ? formatTokens(summary.current.totalTokens) : "—"}
          delta={summary ? formatDelta(summary.current.totalTokens, summary.previous.totalTokens) : null}
          loading={loading}
        />
        <KpiCard
          icon={Clock}
          label="Avg Response Time"
          value={summary ? formatLatency(summary.current.avgLatencyMs) : "—"}
          delta={summary ? formatDelta(summary.current.avgLatencyMs, summary.previous.avgLatencyMs) : null}
          loading={loading}
          // Lower latency is better, so flip the trend interpretation visually.
          invertTrend
        />
        <KpiCard
          icon={Users}
          label="Active Users"
          value={summary ? String(summary.current.activeUsers) : "—"}
          delta={summary ? formatDelta(summary.current.activeUsers, summary.previous.activeUsers) : null}
          loading={loading}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Token Usage Trends"
          subtitle="Daily token consumption over time"
        >
          {tokenUsage && tokenUsage.series.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={tokenUsage.series}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-2)" />
                <XAxis
                  dataKey="bucket"
                  tickFormatter={bucketTickFormatter(tokenUsage.granularity)}
                  stroke="var(--text-3)"
                  fontSize={11}
                />
                <YAxis
                  stroke="var(--text-3)"
                  fontSize={11}
                  tickFormatter={(v) => formatTokens(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-white)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    color: "var(--text-1)",
                  }}
                  formatter={(value, key) => {
                    const num = Number(value);
                    if (key === "tokens") return [formatTokens(num), "Tokens"];
                    if (key === "cost") return [formatUsd(num), "Cost"];
                    return [String(value), String(key)];
                  }}
                  labelFormatter={(v) => new Date(v as string).toLocaleString()}
                />
                <Line
                  type="monotone"
                  dataKey="tokens"
                  stroke="var(--primary-6)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart loading={loading} label="No token activity yet" />
          )}
        </ChartCard>

        <ChartCard
          title="Cost by Provider"
          subtitle="Total spend across LLM providers"
        >
          {costByProvider && costByProvider.providers.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={costByProvider.providers}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-2)" />
                <XAxis dataKey="provider" stroke="var(--text-3)" fontSize={11} />
                <YAxis
                  stroke="var(--text-3)"
                  fontSize={11}
                  tickFormatter={(v) => formatUsd(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-white)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    color: "var(--text-1)",
                  }}
                  formatter={(value, key) => {
                    const num = Number(value);
                    if (key === "cost") return [formatUsd(num), "Cost"];
                    if (key === "tokens") return [formatTokens(num), "Tokens"];
                    return [String(value), String(key)];
                  }}
                />
                <Bar dataKey="cost" fill="var(--primary-6)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart loading={loading} label="No spend recorded yet" />
          )}
        </ChartCard>
      </div>

      {/* Detailed Prompt History */}
      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[16px] font-bold text-text-1">Detailed Prompt History</h2>
            <p className="text-[12px] text-text-2">
              Real-time audit trail of every AI call and guardrail trigger.
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={!events?.events?.length}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-2 bg-bg-white px-3 text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts, models, users…"
              className="h-10 pl-9 text-sm"
            />
          </div>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="h-10 w-[180px] rounded-md border-border-2 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="border-b border-border-2">
                <Th>Timestamp</Th>
                <Th>User</Th>
                <Th>Type</Th>
                <Th>Model</Th>
                <Th align="right">Tokens</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Latency</Th>
                <Th align="center">Status</Th>
              </tr>
            </thead>
            <tbody>
              {events?.events?.length ? (
                events.events.map((e) => <EventRow key={e.id} event={e} />)
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[13px] text-text-3">
                    {loading ? "Loading…" : "No events match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {events && events.total > events.pageSize && (
          <div className="flex items-center justify-between border-t border-border-2 pt-3 text-[12px] text-text-2">
            <span>
              {(events.page - 1) * events.pageSize + 1}–
              {Math.min(events.page * events.pageSize, events.total)} of {events.total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 cursor-pointer rounded border border-border-2 px-3 text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 cursor-pointer rounded border border-border-2 px-3 text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Activity Logs (guardrail triggers) */}
      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[16px] font-bold text-text-1">Guardrail Activity</h2>
          <p className="text-[12px] text-text-2">
            Triggered guardrails grouped by rule.
            {guardrails ? ` ${guardrails.totalTriggers} total trigger(s) in this range.` : ""}
          </p>
        </div>
        {guardrails?.triggers?.length ? (
          <ul className="flex flex-col gap-2">
            {guardrails.triggers.map((t, i) => (
              <li
                key={`${t.guardrailId ?? "anon"}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-2 bg-bg-1/50 px-3 py-2 text-[13px]"
              >
                <div className="flex items-center gap-2">
                  <SeverityPill severity={t.severity} />
                  <span className="font-medium text-text-1">
                    {t.guardrailName ?? "Unknown guardrail"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-text-2">
                  <span>{t.count} trigger(s)</span>
                  <span className="text-text-3">
                    last {new Date(t.lastTriggeredAt).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border-2 bg-bg-1/40 px-4 py-6 text-center text-[13px] text-text-3">
            {loading ? "Loading…" : "No guardrail triggers in this range."}
          </div>
        )}
      </section>

      {error && !loading && (
        <div className="flex items-center gap-2 rounded-md border border-danger-5/40 bg-danger-1 px-3 py-2 text-[13px] text-danger-6">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────────────────── */

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  loading,
  invertTrend,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  delta: { text: string; trend: "up" | "down" | "flat" } | null;
  loading: boolean;
  invertTrend?: boolean;
}) {
  const trend = delta?.trend ?? "flat";
  const goodDirection = invertTrend ? "down" : "up";
  const tone =
    trend === "flat"
      ? "text-text-3"
      : trend === goodDirection
        ? "text-success-7"
        : "text-danger-6";
  const Arrow = trend === "down" ? ArrowDownRight : ArrowUpRight;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-2">
          {label}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded bg-primary-1 text-primary-6">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      </div>
      <span className={`text-[26px] font-bold leading-tight text-text-1 ${loading ? "opacity-60" : ""}`}>
        {value}
      </span>
      {delta && (
        <span className={`flex items-center gap-1 text-[12px] ${tone}`}>
          {trend !== "flat" && <Arrow className="h-3.5 w-3.5" />}
          {delta.text}
        </span>
      )}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[15px] font-bold text-text-1">{title}</h2>
        {subtitle && <p className="text-[12px] text-text-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ loading, label }: { loading: boolean; label: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded border border-dashed border-border-2 bg-bg-1/40 text-[13px] text-text-3">
      {loading ? "Loading…" : label}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  // Tailwind purges classes from full strings, so static branches are required.
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-text-2 ${alignClass}`}
    >
      {children}
    </th>
  );
}

function EventRow({ event: e }: { event: ObservabilityEvent }) {
  const userLabel = e.userName ?? e.userEmail ?? e.userId.slice(0, 8);
  return (
    <tr className="border-b border-border-2 last:border-b-0 hover:bg-bg-1/40">
      <td className="px-3 py-2 align-top text-[12px] text-text-2 whitespace-nowrap">
        {new Date(e.createdAt).toLocaleString()}
      </td>
      <td className="px-3 py-2 align-top text-[13px] text-text-1">
        <div className="flex flex-col">
          <span className="font-medium">{userLabel}</span>
          {e.teamName && (
            <span className="text-[11px] text-text-3">{e.teamName}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top text-[12px] text-text-2 whitespace-nowrap">
        {e.eventType.replace(/_/g, " ")}
      </td>
      <td className="px-3 py-2 align-top text-[12px] text-text-1">
        <div className="flex flex-col">
          <span className="font-mono text-[11px]">{e.model ?? "—"}</span>
          {e.provider && (
            <span className="text-[11px] text-text-3">{e.provider}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top text-right text-[12px] text-text-1 whitespace-nowrap">
        {e.totalTokens != null ? formatTokens(e.totalTokens) : "—"}
      </td>
      <td className="px-3 py-2 align-top text-right text-[12px] text-text-1 whitespace-nowrap">
        {e.costUsd != null ? formatUsd(e.costUsd) : "—"}
      </td>
      <td className="px-3 py-2 align-top text-right text-[12px] text-text-1 whitespace-nowrap">
        {e.latencyMs != null ? formatLatency(e.latencyMs) : "—"}
      </td>
      <td className="px-3 py-2 align-top text-center text-[11px]">
        {e.success ? (
          <span className="rounded-full bg-success-1 px-2 py-0.5 font-medium text-success-7">
            ok
          </span>
        ) : (
          <span
            className="rounded-full bg-danger-1 px-2 py-0.5 font-medium text-danger-6"
            title={e.errorMessage ?? undefined}
          >
            failed
          </span>
        )}
      </td>
    </tr>
  );
}

function SeverityPill({ severity }: { severity: string | null }) {
  const sev = (severity ?? "low").toLowerCase();
  const tone =
    sev === "high"
      ? "bg-danger-1 text-danger-6"
      : sev === "medium"
        ? "bg-warning-1 text-warning-6"
        : "bg-bg-3 text-text-2";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase ${tone}`}>
      {sev}
    </span>
  );
}
