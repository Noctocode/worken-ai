"use client";

import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "@/lib/i18n";
import { validateCronExpression, type CronDescription } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Frequency = "daily" | "weekly" | "monthly" | "interval" | "advanced";
type IntervalUnit = "minutes" | "hours";

const INTERVAL_MINUTES = [15, 30];
const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12];

const BASE_TIMEZONES = [
  "UTC",
  "Europe/Ljubljana",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
];

export interface ScheduleSpec {
  cronExpression: string;
  timezone: string;
  /** Whether the live preview considers the expression valid (optimistic
   *  true until the first preview resolves). */
  valid: boolean;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function dowsToField(dows: number[]): string {
  const uniq = Array.from(new Set(dows)).sort((a, b) => a - b);
  return uniq.length ? uniq.join(",") : "1";
}

function parseDows(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b) return null;
      for (let i = a; i <= b; i++) out.add(i % 7);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part) % 7);
    } else {
      return null;
    }
  }
  const arr = [...out].filter((d) => d >= 0 && d <= 6);
  return arr.length ? arr : null;
}

function buildCron(
  freq: "daily" | "weekly" | "monthly",
  time: string,
  dows: number[],
  dom: number,
): string {
  const [hh, mm] = time.split(":").map((x) => Number(x));
  const h = Number.isFinite(hh) ? hh : 8;
  const m = Number.isFinite(mm) ? mm : 0;
  if (freq === "daily") return `${m} ${h} * * *`;
  if (freq === "weekly") return `${m} ${h} * * ${dowsToField(dows)}`;
  return `${m} ${h} ${dom} * *`;
}

interface ParsedCron {
  freq: Frequency;
  time: string;
  dows: number[];
  dom: number;
  intervalValue: number;
  intervalUnit: IntervalUnit;
}

function parseCron(expr: string): ParsedCron {
  const fallback: ParsedCron = {
    freq: "advanced",
    time: "08:00",
    dows: [1],
    dom: 1,
    intervalValue: 15,
    intervalUnit: "minutes",
  };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [m, h, domF, monF, dowF] = parts;
  const allStar = domF === "*" && monF === "*" && dowF === "*";

  const minMatch = /^\*\/(\d+)$/.exec(m);
  if (allStar && h === "*" && minMatch) {
    return { ...fallback, freq: "interval", intervalUnit: "minutes", intervalValue: Number(minMatch[1]) };
  }
  const hrMatch = /^\*\/(\d+)$/.exec(h);
  if (allStar && m === "0" && hrMatch) {
    return { ...fallback, freq: "interval", intervalUnit: "hours", intervalValue: Number(hrMatch[1]) };
  }

  const mn = Number(m);
  const hn = Number(h);
  if (!Number.isInteger(mn) || !Number.isInteger(hn)) return fallback;
  if (monF !== "*") return fallback;
  const time = `${pad(hn)}:${pad(mn)}`;
  if (domF === "*" && dowF === "*") return { ...fallback, freq: "daily", time };
  if (domF === "*" && dowF !== "*") {
    const dows = parseDows(dowF);
    return dows ? { ...fallback, freq: "weekly", time, dows } : fallback;
  }
  if (dowF === "*" && /^\d+$/.test(domF))
    return { ...fallback, freq: "monthly", time, dom: Number(domF) };
  return fallback;
}

/**
 * The "When to run" builder. Owns all its scheduling state (frequency / time /
 * weekday set / interval / advanced cron / timezone) and reports the resulting
 * `{ cronExpression, timezone, valid }` up via `onChange`, so the parent form
 * only deals with the result — not the builder internals. Shows a live preview
 * (human description + next runs) and the non-BYOK cadence warning.
 */
export function ScheduleWhenSection({
  initialCron,
  initialTimezone,
  onChange,
}: {
  initialCron?: string;
  initialTimezone?: string;
  onChange: (spec: ScheduleSpec) => void;
}) {
  const { t } = useLanguage();

  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const timezones = useMemo(
    () => Array.from(new Set([initialTimezone ?? detectedTz, ...BASE_TIMEZONES])),
    [detectedTz, initialTimezone],
  );

  const parsed = useMemo(
    () => (initialCron ? parseCron(initialCron) : null),
    [initialCron],
  );

  const [frequency, setFrequency] = useState<Frequency>(parsed?.freq ?? "daily");
  const [time, setTime] = useState(parsed?.time ?? "08:00");
  const [dows, setDows] = useState<number[]>(parsed?.dows ?? [1]);
  const [dom, setDom] = useState(parsed?.dom ?? 1);
  const [intervalValue, setIntervalValue] = useState(parsed?.intervalValue ?? 15);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    parsed?.intervalUnit ?? "minutes",
  );
  const [timezone, setTimezone] = useState(initialTimezone ?? detectedTz);
  const [advancedCron, setAdvancedCron] = useState(initialCron ?? "0 8 * * *");
  const [preview, setPreview] = useState<CronDescription | null>(null);

  const effectiveCron =
    frequency === "advanced"
      ? advancedCron
      : frequency === "interval"
        ? intervalUnit === "minutes"
          ? `*/${intervalValue} * * * *`
          : `0 */${intervalValue} * * *`
        : buildCron(frequency, time, dows, dom);

  // Debounced live preview + propagate the spec upward.
  useEffect(() => {
    let cancelled = false;
    // Propagate immediately (optimistically valid) so the parent always has
    // the current expression; the preview result refines `valid` below.
    onChange({ cronExpression: effectiveCron, timezone, valid: true });
    const handle = setTimeout(() => {
      void validateCronExpression(effectiveCron, timezone)
        .then((res) => {
          if (cancelled) return;
          setPreview(res);
          onChange({ cronExpression: effectiveCron, timezone, valid: res.valid });
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [effectiveCron, timezone, onChange]);

  const weekOrder: { v: number; label: string }[] = [
    { v: 1, label: t("aiCron.day.mon") },
    { v: 2, label: t("aiCron.day.tue") },
    { v: 3, label: t("aiCron.day.wed") },
    { v: 4, label: t("aiCron.day.thu") },
    { v: 5, label: t("aiCron.day.fri") },
    { v: 6, label: t("aiCron.day.sat") },
    { v: 0, label: t("aiCron.day.sun") },
  ];
  const toggleDay = (v: number) =>
    setDows((cur) =>
      cur.includes(v) ? cur.filter((d) => d !== v) : [...cur, v],
    );

  const presets: { label: string; apply: () => void }[] = [
    {
      label: t("aiCron.preset.every15"),
      apply: () => {
        setFrequency("interval");
        setIntervalUnit("minutes");
        setIntervalValue(15);
      },
    },
    {
      label: t("aiCron.preset.hourly"),
      apply: () => {
        setFrequency("interval");
        setIntervalUnit("hours");
        setIntervalValue(1);
      },
    },
    {
      label: t("aiCron.preset.daily9"),
      apply: () => {
        setFrequency("daily");
        setTime("09:00");
      },
    },
    {
      label: t("aiCron.preset.weekdays9"),
      apply: () => {
        setFrequency("weekly");
        setTime("09:00");
        setDows([1, 2, 3, 4, 5]);
      },
    },
    {
      label: t("aiCron.preset.mondays9"),
      apply: () => {
        setFrequency("weekly");
        setTime("09:00");
        setDows([1]);
      },
    },
    {
      label: t("aiCron.preset.monthly1"),
      apply: () => {
        setFrequency("monthly");
        setTime("09:00");
        setDom(1);
      },
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
      <h2 className="text-sm font-semibold text-text-1">
        {t("aiCron.form.section.when")}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-3">{t("aiCron.when.presets")}:</span>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="rounded-full border border-border-2 px-2.5 py-1 text-xs text-text-2 hover:bg-bg-2"
            onClick={p.apply}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.when.frequency")}</Label>
          <Select
            value={frequency}
            onValueChange={(v) => setFrequency(v as Frequency)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t("aiCron.when.daily")}</SelectItem>
              <SelectItem value="weekly">{t("aiCron.when.weekly")}</SelectItem>
              <SelectItem value="monthly">{t("aiCron.when.monthly")}</SelectItem>
              <SelectItem value="interval">
                {t("aiCron.when.interval")}
              </SelectItem>
              <SelectItem value="advanced">
                {t("aiCron.when.advanced")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {frequency !== "advanced" && frequency !== "interval" && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.when.time")}</Label>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        )}

        {frequency === "interval" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>{t("aiCron.when.every")}</Label>
              <Select
                value={String(intervalValue)}
                onValueChange={(v) => setIntervalValue(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(intervalUnit === "minutes"
                    ? INTERVAL_MINUTES
                    : INTERVAL_HOURS
                  ).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>&nbsp;</Label>
              <Select
                value={intervalUnit}
                onValueChange={(v) => {
                  const unit = v as IntervalUnit;
                  setIntervalUnit(unit);
                  setIntervalValue(
                    unit === "minutes" ? INTERVAL_MINUTES[0] : INTERVAL_HOURS[0],
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">
                    {t("aiCron.when.unitMinutes")}
                  </SelectItem>
                  <SelectItem value="hours">
                    {t("aiCron.when.unitHours")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {frequency === "monthly" && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.when.dayOfMonth")}</Label>
            <Select value={String(dom)} onValueChange={(v) => setDom(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {frequency === "weekly" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.when.days")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {weekOrder.map((d) => {
              const active = dows.includes(d.v);
              return (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => toggleDay(d.v)}
                  className={`min-w-10 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary-6 bg-primary-6 text-white"
                      : "border-border-2 text-text-2 hover:bg-bg-2"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="text-xs text-primary-6 hover:underline"
              onClick={() => setDows([1, 2, 3, 4, 5])}
            >
              {t("aiCron.when.weekdays")}
            </button>
            <button
              type="button"
              className="text-xs text-primary-6 hover:underline"
              onClick={() => setDows([0, 6])}
            >
              {t("aiCron.when.weekend")}
            </button>
          </div>
        </div>
      )}

      {frequency === "advanced" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.when.cronExpression")}</Label>
          <Input
            value={advancedCron}
            onChange={(e) => setAdvancedCron(e.target.value)}
            placeholder={t("aiCron.when.cronPlaceholder")}
            className="font-mono"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{t("aiCron.when.timezone")}</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timezones.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg bg-bg-2 px-3 py-2 text-xs">
        {preview && !preview.valid && (
          <span className="text-danger-6">{t("aiCron.when.invalidCron")}</span>
        )}
        {preview?.valid && (
          <div className="flex flex-col gap-1">
            {preview.description && (
              <span className="text-text-1">{preview.description}</span>
            )}
            {preview.nextRuns && preview.nextRuns.length > 0 && (
              <span className="text-text-3">
                {t("aiCron.when.preview")}:{" "}
                {preview.nextRuns
                  .slice(0, 3)
                  .map((r) => new Date(r).toLocaleString())
                  .join(" · ")}
              </span>
            )}
            {preview.minIntervalMinutes != null &&
              preview.minIntervalMinutes < 15 && (
                <span className="text-warning-6">
                  {t("aiCron.when.everyMinuteWarning")}
                </span>
              )}
          </div>
        )}
      </div>
    </section>
  );
}
