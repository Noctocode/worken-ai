"use client";

import { Globe, KeySquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/lib/i18n";
import { useAuth } from "@/components/providers";
import {
  fetchOrgUsers,
  uploadScheduleFiles,
  type ScheduledPrompt,
  type ScheduledPromptInput,
} from "@/lib/api";
import { ScheduleFilesSection } from "./schedule-files-section";
import {
  ScheduleWhenSection,
  type ScheduleSpec,
} from "./schedule-when-section";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Example prompts (frontend constant — not user-editable).
const PROMPT_PRESETS: { name: string; prompt: string }[] = [
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

type FieldErrors = Partial<
  Record<
    "name" | "prompt" | "model" | "schedule" | "delivery" | "email" | "webhook",
    string
  >
>;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <span className="text-xs text-danger-6">{msg}</span>;
}

export function AiCronForm({ initial }: { initial?: ScheduledPrompt }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { effective } = useUserModels();
  const createMut = useCreateScheduledPrompt();
  const updateMut = useUpdateScheduledPrompt();

  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [context, setContext] = useState(initial?.context ?? "");
  // New-form only: files chosen before the schedule exists, uploaded after
  // create (approach A). On edit, the files section uploads immediately.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [modelIdentifier, setModelIdentifier] = useState(
    initial?.modelIdentifier ?? "",
  );

  // Schedule spec is owned by ScheduleWhenSection and reported up here.
  const [schedule, setSchedule] = useState<ScheduleSpec>({
    cronExpression: initial?.cronExpression ?? "0 8 * * *",
    timezone: initial?.timezone ?? "UTC",
    valid: true,
  });
  const handleSchedule = useCallback((spec: ScheduleSpec) => {
    setSchedule(spec);
  }, []);

  const [useKnowledgeCore, setUseKnowledgeCore] = useState(
    initial?.useKnowledgeCore ?? false,
  );
  const [useWebSearch, setUseWebSearch] = useState(
    initial?.useWebSearch ?? false,
  );

  // Web search only works for models routed through OpenRouter (it's an
  // OpenRouter-only plugin). BYOK / Custom LLM / Azure models (routing
  // 'byok' | 'custom') can't do it, so the toggle is disabled — and forced
  // off — the moment such a model is selected, and can't be turned back on
  // until an OpenRouter-routed model is picked.
  const webSearchSupported = useMemo(() => {
    // Enabled only once a model that actually supports web search is picked.
    // No model selected (or an unknown one) → disabled, can't be turned on.
    if (!modelIdentifier) return false;
    const m = effective.find((x) => x.id === modelIdentifier);
    return !!m && m.routing === "workenai";
  }, [effective, modelIdentifier]);
  useEffect(() => {
    if (!webSearchSupported && useWebSearch) setUseWebSearch(false);
  }, [webSearchSupported, useWebSearch]);

  const [deliverInApp, setDeliverInApp] = useState(
    initial?.deliverInApp ?? true,
  );
  // Extra in-app notification recipients (company members besides the
  // owner). Default empty — only the schedule creator is notified.
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(
    initial?.notifyUserIds ?? [],
  );
  const { user } = useAuth();
  const { data: orgUsers } = useQuery({
    queryKey: ["org-users"],
    queryFn: fetchOrgUsers,
  });
  // Colleagues = company members other than the current user (the owner is
  // always notified, so they're not listed as a selectable extra).
  const colleagues = useMemo(
    () => (orgUsers ?? []).filter((u) => u.id !== user?.id),
    [orgUsers, user?.id],
  );
  const toggleNotify = (id: string) =>
    setNotifyUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
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

  const [errors, setErrors] = useState<FieldErrors>({});
  const clearErr = (key: keyof FieldErrors) =>
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  const addEmail = () => {
    const v = emailDraft.trim().toLowerCase();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      toast.error(`${v}: ✗`);
      return;
    }
    if (!emailRecipients.includes(v)) {
      setEmailRecipients([...emailRecipients, v]);
      clearErr("email");
    }
    setEmailDraft("");
  };

  const isSaving = createMut.isPending || updateMut.isPending;

  const validate = (): FieldErrors => {
    const e: FieldErrors = {};
    if (!name.trim()) e.name = t("aiCron.validation.nameRequired");
    if (!prompt.trim()) e.prompt = t("aiCron.validation.promptRequired");
    if (!modelIdentifier) e.model = t("aiCron.validation.modelRequired");
    if (!schedule.valid) e.schedule = t("aiCron.when.invalidCron");
    if (!deliverInApp && !deliverEmail && !deliverWebhook) {
      e.delivery = t("aiCron.delivery.atLeastOne");
    }
    if (deliverEmail && emailRecipients.length === 0) {
      e.email = t("aiCron.validation.emailRequired");
    }
    if (deliverWebhook) {
      const url = webhookUrl.trim();
      if (!url) e.webhook = t("aiCron.validation.webhookRequired");
      else if (!/^https:\/\//i.test(url))
        e.webhook = t("aiCron.validation.webhookHttps");
      else {
        try {
          new URL(url);
        } catch {
          e.webhook = t("aiCron.validation.webhookInvalid");
        }
      }
    }
    return e;
  };

  const submit = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error(t("aiCron.validation.fix"));
      return;
    }

    const payload: ScheduledPromptInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      context: context.trim() || null,
      modelIdentifier,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      useKnowledgeCore,
      useWebSearch,
      deliverInApp,
      notifyUserIds,
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
          onError: (err: Error) =>
            toast.error(err.message || t("aiCron.toast.updateFailed")),
        },
      );
    } else {
      createMut.mutate(payload, {
        // Approach A: the schedule must exist before files can attach, so
        // upload the queued files to the new id, then navigate.
        onSuccess: async (created) => {
          if (pendingFiles.length > 0) {
            try {
              await uploadScheduleFiles(created.id, pendingFiles);
            } catch {
              toast.error(t("aiCron.files.uploadFailed"));
            }
          }
          toast.success(t("aiCron.toast.created"));
          router.push("/ai-cron");
        },
        onError: (err: Error) =>
          toast.error(err.message || t("aiCron.toast.createFailed")),
      });
    }
  };

  return (
    <div className="flex w-full flex-col gap-6 py-4 lg:py-8">
      {/* Mobile title — the desktop appbar (aiCronForm variant) owns the
          title + back arrow at md+. */}
      <h1 className="text-[20px] font-bold text-text-1 md:hidden">
        {initial ? t("aiCron.form.editTitle") : t("aiCron.form.newTitle")}
      </h1>

      {/* WHAT */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.what")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.form.name")}</Label>
          <Input
            value={name}
            aria-invalid={!!errors.name}
            onChange={(e) => {
              setName(e.target.value);
              clearErr("name");
            }}
            placeholder={t("aiCron.form.namePlaceholder")}
          />
          <FieldError msg={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{t("aiCron.form.prompt")}</Label>
          <Textarea
            value={prompt}
            aria-invalid={!!errors.prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              clearErr("prompt");
            }}
            placeholder={t("aiCron.form.promptPlaceholder")}
            rows={5}
          />
          <FieldError msg={errors.prompt} />
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-text-3">
              {t("aiCron.form.presets")}:
            </span>
            {PROMPT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="rounded-full border border-border-2 px-2.5 py-1 text-xs text-text-2 hover:bg-bg-2"
                onClick={() => {
                  if (!name.trim()) setName(p.name);
                  setPrompt(p.prompt);
                  clearErr("prompt");
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* SCHEDULE CONTEXT */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.scheduleContext.title")}
        </h2>
        <Textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={t("aiCron.scheduleContext.placeholder")}
          rows={3}
        />
      </section>

      {/* FILES IN THIS CONTEXT */}
      <ScheduleFilesSection
        scheduleId={initial?.id}
        pendingFiles={pendingFiles}
        setPendingFiles={setPendingFiles}
      />

      {/* MODEL */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.model")}
        </h2>
        <Select
          value={modelIdentifier}
          onValueChange={(v) => {
            setModelIdentifier(v);
            clearErr("model");
          }}
        >
          <SelectTrigger aria-invalid={!!errors.model}>
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
        <FieldError msg={errors.model} />
      </section>

      {/* WHEN */}
      <div className="flex flex-col gap-1.5">
        <ScheduleWhenSection
          initialCron={initial?.cronExpression}
          initialTimezone={initial?.timezone}
          onChange={handleSchedule}
        />
        <FieldError msg={errors.schedule} />
      </div>

      {/* CONTEXT */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
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
              {webSearchSupported
                ? t("aiCron.context.webSearchDesc")
                : t("aiCron.context.webSearchUnsupported")}
            </span>
          </span>
          <Switch
            checked={useWebSearch && webSearchSupported}
            onCheckedChange={setUseWebSearch}
            disabled={!webSearchSupported}
          />
        </label>
      </section>

      {/* DELIVERY */}
      <section className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-white p-4">
        <h2 className="text-sm font-semibold text-text-1">
          {t("aiCron.form.section.delivery")}
        </h2>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.inApp")}
          </span>
          <Switch
            checked={deliverInApp}
            onCheckedChange={(v) => {
              setDeliverInApp(v);
              clearErr("delivery");
            }}
          />
        </label>

        {/* Extra company members who also get the in-app notification.
            Owner is always notified, so they're not listed. */}
        {deliverInApp && colleagues.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.delivery.notifyMembers")}</Label>
            <p className="text-xs text-text-3">
              {t("aiCron.delivery.notifyMembersHint")}
            </p>
            <div className="flex max-h-48 flex-col gap-0.5 overflow-auto rounded-lg border border-border-2 p-1.5">
              {colleagues.map((u) => {
                const checked = notifyUserIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNotify(u.id)}
                      className="size-4 accent-primary-6"
                    />
                    <span className="text-sm text-text-1">
                      {u.name ?? u.email}
                    </span>
                    {u.name && (
                      <span className="text-xs text-text-3">{u.email}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.email")}
          </span>
          <Switch
            checked={deliverEmail}
            onCheckedChange={(v) => {
              setDeliverEmail(v);
              clearErr("delivery");
              clearErr("email");
            }}
          />
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
              aria-invalid={!!errors.email}
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
            <FieldError msg={errors.email} />
          </div>
        )}

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm text-text-1">
            {t("aiCron.delivery.webhook")}
          </span>
          <Switch
            checked={deliverWebhook}
            onCheckedChange={(v) => {
              setDeliverWebhook(v);
              clearErr("delivery");
              clearErr("webhook");
            }}
          />
        </label>
        {deliverWebhook && (
          <div className="flex flex-col gap-1.5">
            <Label>{t("aiCron.delivery.webhookUrl")}</Label>
            <Input
              value={webhookUrl}
              aria-invalid={!!errors.webhook}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                clearErr("webhook");
              }}
              placeholder={t("aiCron.delivery.webhookUrlPlaceholder")}
            />
            <FieldError msg={errors.webhook} />
          </div>
        )}
        <FieldError msg={errors.delivery} />
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
