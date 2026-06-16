"use client";

import { Globe, KeySquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useLanguage } from "@/lib/i18n";
import {
  validateCronExpression,
  type CronDescription,
  type ScheduledPrompt,
  type ScheduledPromptInput,
} from "@/lib/api";
import { useUserModels } from "@/lib/hooks/use-user-models";
import {
  useCreateScheduledPrompt,
  useUpdateScheduledPrompt,
} from "@/lib/hooks/use-scheduled-prompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Frequency = "daily" | "weekly" | "monthly" | "interval" | "advanced";
type IntervalUnit = "minutes" | "hours";

// Interval choices the builder offers; minute values stay clean divisors of 60
// and >= 15 (the non-BYOK guardrail floor — tighter cadences need Advanced +
// a BYOK/Custom model).
const INTERVAL_MINUTES = [15, 30];
const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A small curated timezone list; the user's detected zone is prepended.
const BASE_TIMEZONES = [
  "UTC",
  "Europe/Ljubljana",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
];

// Example prompts (frontend constant — not user-editable).
const PRESETS: { name: string; prompt: string }[] = [
  {
    name: "Daily morning briefing",
    prompt:
      "Summarise today's most important updates into a 5-bullet briefing I can read in under a minute.",
  },
  {
    name: "Weekly competitor scan",
    prompt:
      "Search the web for notable product announcements or news about our competitors this week and summarise the highlights.",
  },
  {
    name: "Client check-in nudge",
    prompt:
      "Draft a short, friendly, non-pushy check-in email for a client we haven't spoken to in a while.",
  },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Normalise a set of cron weekday numbers (0=Sun..6=Sat) into the field. */
function dowsToField(dows: number[]): string {
  const uniq = Array.from(new Set(dows)).sort((a, b) => a - b);
  return uniq.length ? uniq.join(",") : "1";
}

/** Parse a cron day-of-week field (`1-5`, `1,3,5`, `3`, …) into day numbers. */
function parseDows(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (a > b) return null;
      for (let i = a; i <= b; i++) out.add(i % 7); // cron allows 7 = Sunday
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part) % 7);
    } else {
      return null;
    }
  }
  const arr = [...out].filter((d) => d >= 0 && d <= 6);
  return arr.length ? arr : null;
}

/** Turn the builder state into a 5-field cron expression. */
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

/** Best-effort parse of a stored cron back into builder state. */
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

  // Interval — every N minutes (*/N * * * *) or every N hours (0 */N * * *).
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

export function AiCronForm({ initial }: { initial?: ScheduledPrompt }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { effective } = useUserModels();
  const createMut = useCreateScheduledPrompt();
  const updateMut = useUpdateScheduledPrompt();

  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const timezones = useMemo(
    () => Array.from(new Set([detectedTz, ...BASE_TIMEZONES])),
    [detectedTz],
  );

  const parsed = useMemo(
    () => (initial ? parseCron(initial.cronExpression) : null),
    [initial],
  );

  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [modelIdentifier, setModelIdentifier] = useState(
    initial?.modelIdentifier ?? "",
  );
  const [frequency, setFrequency] = useState<Frequency>(parsed?.freq ?? "daily");
  const [time, setTime] = useState(parsed?.time ?? "08:00");
  const [dows, setDows] = useState<number[]>(parsed?.dows ?? [1]);
  const [dom, setDom] = useState(parsed?.dom ?? 1);
  const [intervalValue, setIntervalValue] = useState(
    parsed?.intervalValue ?? 15,
  );
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(
    parsed?.intervalUnit ?? "minutes",
  );
  const [timezone, setTimezone] = useState(initial?.timezone ?? detectedTz);
  const [advancedCron, setAdvancedCron] = useState(
    initial?.cronExpression ?? "0 8 * * *",
  );

  const [useKnowledgeCore, setUseKnowledgeCore] = useState(
    initial?.useKnowledgeCore ?? false,
  );
  const [useWebSearch, setUseWebSearch] = useState(
    initial?.useWebSearch ?? false,
  );

  const [deliverInApp, setDeliverInApp] = useState(
    initial?.deliverInApp ?? true,
  );
  const [deliverEmail, setDeliverEmail] = useState(
    initial?.deliverEmail ?? false,
  );
  const [emailRecipients, setEmailRecipients] = useState<string[]>(
    initial?.emailRecipients ?? [],
  );
  const [emailDraft, setEmailDraft] = useState("");
  const [deliverWebhook, setDeliverWebhook] = useState(
    initial?.deliverWebhook ?? false,
  );
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");

  const effectiveCron =
    frequency === "advanced"
      ? advancedCron
      : frequency === "interval"
        ? intervalUnit === "minutes"
          ? `*/${intervalValue} * * * *`
          : `0 */${intervalValue} * * *`
        : buildCron(frequency, time, dows, dom);

  // Live preview of the schedule (debounced) via the validate-cron endpoint.
  const [preview, setPreview] = useState<CronDescription | null>(null);
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void validateCronExpression(effectiveCron, timezone)
        .then((res) => {
          if (!cancelled) setPreview(res);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [effectiveCron, timezone]);

  const addEmail = () => {
    const v = emailDraft.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      toast.error(`${v}: ✗`);
      return;
    }
    if (!emailRecipients.includes(v)) {
      setEmailRecipients([...emailRecipients, v]);
    }
    setEmailDraft("");
  };

  // Weekday toggles shown for the Weekly frequency. Ordered Mon→Sun for
  // readability; values are cron weekday numbers (0 = Sun).
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

  // One-click common schedules.
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

  const isSaving = createMut.isPending || updateMut.isPending;

  const submit = () => {
    if (!name.trim()) return toast.error(t("aiCron.form.name"));
    if (!prompt.trim()) return toast.error(t("aiCron.form.prompt"));
    if (!modelIdentifier) return toast.error(t("aiCron.model.placeholder"));
    if (preview && !preview.valid) {
      return toast.error(t("aiCron.when.invalidCron"));
    }
    if (!deliverInApp && !deliverEmail && !deliverWebhook) {
      return toast.error(t("aiCron.delivery.atLeastOne"));
    }
    if (deliverWebhook && !webhookUrl.trim()) {
      return toast.error(t("aiCron.delivery.webhookUrl"));
    }

    const payload: ScheduledPromptInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      modelIdentifier,
      cronExpression: effectiveCron,
      timezone,
      useKnowledgeCore,
      useWebSearch,
      deliverInApp,
      deliverEmail,
      emailRecipients,
      deliverWebhook,
      webhookUrl: deliverWebhook ? webhookUrl.trim() : null,
    };

    if (initial) {
      updateMut.mutate(
        { id: initial.id, data: payload },
        {
          onSuccess: () => {
            toast.success(t("aiCron.toast.updated"));
            router.push("/ai-cron");
          },
          onError: (e: Error) =>
            toast.error(e.message || t("aiCron.toast.updateFailed")),
        },
      );
    } else {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success(t("aiCron.toast.created"));
          router.push("/ai-cron");
        },
        onError: (e: Error) =>
          toast.error(e.message || t("aiCron.toast.createFailed")),
      });
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4 lg:py-8">
      <h1 className="text-xl font-semibold text-text-1">
        {initial ? t("aiCron.form.editTitle") : t("aiCron.form.newTitle")}
      </h1>

      {/* WHAT */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-1 p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.what")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.form.name")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("aiCron.form.namePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.form.prompt")}</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("aiCron.form.promptPlaceholder")}
            rows={5}
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-text-3">
              {t("aiCron.form.presets")}:
            </span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="rounded-full border border-border-1 px-2.5 py-1 text-xs text-text-2 hover:bg-bg-2"
                onClick={() => {
                  if (!name.trim()) setName(p.name);
                  setPrompt(p.prompt);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* MODEL */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-1 p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.model")}
        </h2>
        <Select value={modelIdentifier} onValueChange={setModelIdentifier}>
          <SelectTrigger>
            <SelectValue placeholder={t("aiCron.model.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {effective.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex items-center gap-2">
                  {m.name}
                  {m.routing === "byok" && (
                    <span className="inline-flex items-center gap-1 text-xs text-text-3">
                      <KeySquare className="size-3" />
                      {t("aiCron.model.byok")}
                    </span>
                  )}
                  {m.routing === "custom" && (
                    <span className="inline-flex items-center gap-1 text-xs text-text-3">
                      <Globe className="size-3" />
                      {t("aiCron.model.custom")}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      {/* WHEN */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-1 p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.when")}
        </h2>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-3">{t("aiCron.when.presets")}:</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-full border border-border-1 px-2.5 py-1 text-xs text-text-2 hover:bg-bg-2"
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
                <SelectItem value="monthly">
                  {t("aiCron.when.monthly")}
                </SelectItem>
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
                    // Snap to a valid value for the new unit.
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
                        : "border-border-1 text-text-2 hover:bg-bg-2"
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

        {/* Live preview */}
        <div className="rounded-lg bg-bg-2 px-3 py-2 text-xs">
          {preview && !preview.valid && (
            <span className="text-error-7">{t("aiCron.when.invalidCron")}</span>
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
                  <span className="text-warning-7">
                    {t("aiCron.when.everyMinuteWarning")}
                  </span>
                )}
            </div>
          )}
        </div>
      </section>

      {/* CONTEXT */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-1 p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.context")}
        </h2>
        <label className="flex items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-sm text-text-1">
              {t("aiCron.context.knowledgeCore")}
            </span>
            <span className="text-xs text-text-3">
              {t("aiCron.context.knowledgeCoreDesc")}
            </span>
          </span>
          <Switch
            checked={useKnowledgeCore}
            onCheckedChange={setUseKnowledgeCore}
          />
        </label>
        <label className="flex items-start justify-between gap-3">
          <span className="flex flex-col">
            <span className="text-sm text-text-1">
              {t("aiCron.context.webSearch")}
            </span>
            <span className="text-xs text-text-3">
              {t("aiCron.context.webSearchDesc")}
            </span>
          </span>
          <Switch checked={useWebSearch} onCheckedChange={setUseWebSearch} />
        </label>
      </section>

      {/* DELIVERY */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-1 p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.delivery")}
        </h2>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.inApp")}
          </span>
          <Switch checked={deliverInApp} onCheckedChange={setDeliverInApp} />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.email")}
          </span>
          <Switch checked={deliverEmail} onCheckedChange={setDeliverEmail} />
        </label>
        {deliverEmail && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.delivery.emailRecipients")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {emailRecipients.map((addr) => (
                <span
                  key={addr}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-2 px-2.5 py-1 text-xs text-text-1"
                >
                  {addr}
                  <button
                    type="button"
                    onClick={() =>
                      setEmailRecipients(
                        emailRecipients.filter((a) => a !== addr),
                      )
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addEmail();
                }
              }}
              onBlur={addEmail}
              placeholder={t("aiCron.delivery.emailRecipientsPlaceholder")}
            />
          </div>
        )}

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.webhook")}
          </span>
          <Switch checked={deliverWebhook} onCheckedChange={setDeliverWebhook} />
        </label>
        {deliverWebhook && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.delivery.webhookUrl")}</Label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={t("aiCron.delivery.webhookUrlPlaceholder")}
            />
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/ai-cron")}>
          {t("aiCron.form.cancel")}
        </Button>
        <Button onClick={submit} disabled={isSaving}>
          {initial ? t("aiCron.form.save") : t("aiCron.form.create")}
        </Button>
      </div>
    </div>
  );
}
