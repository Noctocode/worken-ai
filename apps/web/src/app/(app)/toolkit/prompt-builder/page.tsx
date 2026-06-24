"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Plus,
  Copy,
  Maximize2,
  FileText,
  ClipboardCheck,
  Database,
  Cog,
  ArrowRight,
  ArrowLeft,
  Trash2,
  MessageSquare,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createPrompt,
  fetchPrompt,
  updatePrompt,
  type PromptInput,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations/en";

type TemplateIcon = typeof FileText;

interface Template {
  titleKey: TranslationKey;
  categoryKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: TemplateIcon;
  prompt: string;
}

const TEMPLATES: Template[] = [
  {
    titleKey: "promptBuilder.tplLegalTitle",
    categoryKey: "promptBuilder.tplLegalCategory",
    descriptionKey: "promptBuilder.tplLegalDesc",
    icon: FileText,
    prompt:
      "Summarize the following legal document and list the {{key_clauses}}. Highlight obligations, deadlines, and termination conditions. Format the output as {{output_format}}.",
  },
  {
    titleKey: "promptBuilder.tplProposalTitle",
    categoryKey: "promptBuilder.tplProposalCategory",
    descriptionKey: "promptBuilder.tplProposalDesc",
    icon: ClipboardCheck,
    prompt:
      "Review the attached proposal against {{requirements}}. Score each criterion out of 10 and produce a structured comparison. Format the output as {{output_format}}.",
  },
  {
    titleKey: "promptBuilder.tplDataTitle",
    categoryKey: "promptBuilder.tplDataCategory",
    descriptionKey: "promptBuilder.tplDataDesc",
    icon: Database,
    prompt:
      "Extract and structure the following data from the document: {{data_fields}}. Format the output as {{output_format}}.",
  },
  {
    titleKey: "promptBuilder.tplTechTitle",
    categoryKey: "promptBuilder.tplTechCategory",
    descriptionKey: "promptBuilder.tplTechDesc",
    icon: Cog,
    prompt:
      "Translate the following high-level requirements into a detailed technical specification for {{audience}}. Include architecture, dependencies, and acceptance criteria. Format the output as {{output_format}}.",
  },
];

const STEPS = [
  { titleKey: "promptBuilder.step1Title", captionKey: "promptBuilder.step1Caption" },
  { titleKey: "promptBuilder.step2Title", captionKey: "promptBuilder.step2Caption" },
  { titleKey: "promptBuilder.step3Title", captionKey: "promptBuilder.step3Caption" },
  { titleKey: "promptBuilder.step4Title", captionKey: "promptBuilder.step4Caption" },
] as const satisfies readonly { titleKey: TranslationKey; captionKey: TranslationKey }[];

interface Variable {
  id: string;
  name: string;
  defaultValue: string;
  description: string;
}

const DEFAULT_VARIABLES: Variable[] = [
  {
    id: "v-data-fields",
    name: "data_fields",
    defaultValue: "",
    description: "",
  },
  {
    id: "v-output-format",
    name: "output_format",
    defaultValue: "",
    description: "",
  },
];

const DEFAULT_PROMPT =
  "Extract and structure the following data from the document: {{data_fields}}. Format the output as {{output_format}}.";

const MODEL_OPTIONS = ["gpt-4", "gpt-4o", "claude-3-opus", "claude-3-sonnet"] as const;

function Stepper({
  active,
  onSelect,
}: {
  active: number;
  onSelect: (step: number) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-2 bg-bg-white p-4">
      {STEPS.map((step, i) => {
        const isActive = i === active;
        const reachable = i <= active;
        return (
          <div key={step.titleKey} className="flex flex-1 items-center gap-4">
            <button
              type="button"
              onClick={() => reachable && onSelect(i)}
              disabled={!reachable}
              className={`flex items-center gap-3 ${reachable ? "cursor-pointer" : "cursor-not-allowed"}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
                  isActive
                    ? "border-primary-7 bg-primary-7 text-text-white"
                    : "border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {i + 1}
              </span>
              <div className="flex flex-col items-start">
                <span
                  className={`text-sm font-semibold ${isActive ? "text-text-2" : "text-text-3"}`}
                >
                  {t(step.titleKey)}
                </span>
                <span className="text-xs text-text-3">{t(step.captionKey)}</span>
              </div>
            </button>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-border-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TemplateCard({
  template,
  onSelect,
}: {
  template: Template;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex cursor-pointer items-start gap-4 rounded-lg border border-border-2 bg-bg-white p-5 text-left transition-colors hover:border-primary-6"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-1">
        <Icon className="h-6 w-6 text-primary-6" strokeWidth={2} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-1">{t(template.titleKey)}</h3>
        <span className="inline-flex w-fit items-center rounded bg-bg-1 px-2 py-0.5 text-[11px] font-medium text-text-3">
          {t(template.categoryKey)}
        </span>
        <p className="text-xs font-medium text-text-3">{t(template.descriptionKey)}</p>
      </div>
    </button>
  );
}

function LivePreview({
  promptDraft,
  variables,
  model,
}: {
  promptDraft: string;
  variables: Variable[];
  model: string;
}) {
  const { t } = useLanguage();
  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 lg:w-[583px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-text-1">{t("promptBuilder.livePreview")}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("promptBuilder.copyPrompt")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(promptDraft);
                toast.success(t("promptBuilder.copiedToast"));
              } catch {
                toast.error(t("promptBuilder.copyFailed"));
              }
            }}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
          >
            <Copy className="h-4 w-4" />
          </button>
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                title={t("promptBuilder.expandPreview")}
                aria-label={t("promptBuilder.expandPreview")}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{t("promptBuilder.promptPreview")}</DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-auto rounded border border-border-2 bg-bg-1 p-4">
                <pre
                  className={`whitespace-pre-wrap font-mono text-[13px] leading-[1.625] ${
                    promptDraft ? "text-text-1" : "text-text-3"
                  }`}
                >
                  {promptDraft || t("promptBuilder.promptWillAppear")}
                </pre>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-text-2">{t("promptBuilder.promptDraft")}</span>
        <div className="min-h-[200px] rounded border border-border-2 bg-bg-1 p-3">
          <span
            className={`font-mono text-xs whitespace-pre-wrap ${promptDraft ? "text-text-1" : "text-text-3"}`}
          >
            {promptDraft || t("promptBuilder.promptWillAppear")}
          </span>
        </div>
      </div>

      {variables.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">
            {t("promptBuilder.variablesCount").replace("{n}", String(variables.length))}
          </span>
          <div className="flex flex-wrap gap-2">
            {variables.map((v) => (
              <span
                key={v.id}
                className="rounded bg-border-2 px-1.5 py-0.5 font-mono text-[11px] text-text-1"
              >
                {v.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border-2 pt-4">
        {[
          { label: t("promptBuilder.template"), value: t("promptBuilder.custom") },
          { label: t("promptBuilder.variablesField"), value: String(variables.length) },
          { label: t("promptBuilder.modelField"), value: model },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="text-[11px] text-text-2">{label}</span>
            <span className="text-[11px] font-medium text-text-1">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Step 1: Select Template ─────────────────────────────────────────── */

function SelectTemplateStep({
  onPick,
  onScratch,
}: {
  onPick: (template: Template) => void;
  onScratch: () => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const filtered = TEMPLATES.filter((tpl) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      t(tpl.titleKey).toLowerCase().includes(q) ||
      t(tpl.categoryKey).toLowerCase().includes(q) ||
      t(tpl.descriptionKey).toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">{t("promptBuilder.chooseTemplate")}</h2>
        <p className="text-sm text-text-3">
          {t("promptBuilder.chooseTemplateDesc")}
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("promptBuilder.searchTemplatesPh")}
          className="h-11 pl-9 pr-3 text-base rounded-md border-border-2 placeholder:text-text-3"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map((tpl) => (
          <TemplateCard key={tpl.titleKey} template={tpl} onSelect={() => onPick(tpl)} />
        ))}
      </div>

      <button
        type="button"
        onClick={onScratch}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-2 bg-bg-white py-6 text-sm font-medium text-text-3 transition-colors hover:border-primary-6 hover:text-primary-6"
      >
        <Plus className="h-4 w-4" />
        {t("promptBuilder.startFromScratch")}
      </button>
    </div>
  );
}

/* ─── Step 2: Define Variables ───────────────────────────────────────── */

function DefineVariablesStep({
  prompt,
  setPrompt,
  variables,
  setVariables,
  onBack,
  onContinue,
}: {
  prompt: string;
  setPrompt: (s: string) => void;
  variables: Variable[];
  setVariables: (v: Variable[]) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();
  const addVariable = () => {
    setVariables([
      ...variables,
      { id: crypto.randomUUID(), name: "", defaultValue: "", description: "" },
    ]);
  };

  const updateVariable = (id: string, patch: Partial<Variable>) => {
    setVariables(variables.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };

  const removeVariable = (id: string) => {
    setVariables(variables.filter((v) => v.id !== id));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">{t("promptBuilder.defineVarsTitle")}</h2>
        <p className="text-sm text-text-2">
          {t("promptBuilder.defineVarsDesc")}
        </p>
      </div>

      {/* Prompt Template */}
      <section className="flex flex-col gap-2 rounded-lg border border-border-2 bg-bg-white p-5">
        <label className="text-[13px] font-semibold text-text-1">
          {t("promptBuilder.promptTemplate")}
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          placeholder={t("promptBuilder.promptPlaceholder")}
          className="font-mono text-[13px] rounded border-border-2"
        />
        <p className="text-xs text-text-2">
          {t("promptBuilder.variablesShownAs")}{" "}
          <span className="rounded bg-border-2 px-1.5 py-0.5 font-mono text-xs text-text-1">
            {"{{variable_name}}"}
          </span>
        </p>
      </section>

      {/* Variables list */}
      <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-text-1">{t("promptBuilder.variables")}</h3>
          <button
            type="button"
            onClick={addVariable}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-primary-1 px-3 py-1.5 text-xs font-medium text-text-2 transition-colors hover:bg-primary-6/20"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("promptBuilder.addVariable")}
          </button>
        </div>

        {variables.length === 0 ? (
          <p className="rounded border border-dashed border-border-2 bg-bg-1 p-6 text-center text-xs text-text-3">
            {t("promptBuilder.noVarsYet")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {variables.map((v) => (
              <div
                key={v.id}
                className="flex flex-col gap-3 rounded-lg border border-border-2 p-4"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-2">
                      {t("promptBuilder.variableName")}
                    </label>
                    <Input
                      value={v.name}
                      onChange={(e) => updateVariable(v.id, { name: e.target.value })}
                      className="h-10 rounded border-border-2 font-mono text-[13px]"
                      placeholder={t("promptBuilder.varNamePh")}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-2">
                      {t("promptBuilder.defaultValue")}
                    </label>
                    <Input
                      value={v.defaultValue}
                      onChange={(e) =>
                        updateVariable(v.id, { defaultValue: e.target.value })
                      }
                      className="h-10 rounded border-border-2 text-[13px]"
                      placeholder={t("promptBuilder.defaultValuePh")}
                    />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-text-2">
                      {t("promptBuilder.description")}
                    </label>
                    <Input
                      value={v.description}
                      onChange={(e) =>
                        updateVariable(v.id, { description: e.target.value })
                      }
                      className="h-10 rounded border-border-2 text-[13px]"
                      placeholder={t("promptBuilder.descriptionPh")}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariable(v.id)}
                    title={t("promptBuilder.removeVariable")}
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded border border-border-2 text-text-3 transition-colors hover:border-danger-5 hover:text-danger-6"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <StepNav onBack={onBack} onContinue={onContinue} />
    </div>
  );
}

/* ─── Step 3: Configure Parameters ────────────────────────────────────── */

interface Params {
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
}

function ConfigureParametersStep({
  params,
  setParams,
  onBack,
  onContinue,
}: {
  params: Params;
  setParams: (p: Params) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">{t("promptBuilder.configureTitle")}</h2>
        <p className="text-sm text-text-2">
          {t("promptBuilder.configureDesc")}
        </p>
      </div>

      <section className="flex flex-col gap-6 rounded-lg border border-border-2 bg-bg-white p-5">
        {/* Model Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-text-1">
            {t("promptBuilder.modelSelection")}
          </label>
          <Select
            value={params.model}
            onValueChange={(value) => setParams({ ...params, model: value })}
          >
            <SelectTrigger className="h-10 rounded border-border-2 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Temperature */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-text-1">
              {t("promptBuilder.temperature")}
            </label>
            <span className="font-mono text-[13px] text-text-2">
              {params.temperature.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={params.temperature}
            onChange={(e) =>
              setParams({ ...params, temperature: parseFloat(e.target.value) })
            }
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-1 accent-primary-7"
          />
          <div className="flex justify-between text-[11px] text-text-2">
            <span>{t("promptBuilder.focused")}</span>
            <span>{t("promptBuilder.creative")}</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-text-1">
              {t("promptBuilder.maxTokens")}
            </label>
            <span className="font-mono text-[13px] text-text-2">
              {params.maxTokens}
            </span>
          </div>
          <input
            type="range"
            min={100}
            max={4000}
            step={50}
            value={params.maxTokens}
            onChange={(e) =>
              setParams({ ...params, maxTokens: parseInt(e.target.value, 10) })
            }
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-1 accent-primary-7"
          />
          <p className="text-[11px] text-text-2">
            {t("promptBuilder.maxTokensDesc")}
          </p>
        </div>

        {/* Top P */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-text-1">
              {t("promptBuilder.topP")}
            </label>
            <span className="font-mono text-[13px] text-text-2">
              {params.topP.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.topP}
            onChange={(e) =>
              setParams({ ...params, topP: parseFloat(e.target.value) })
            }
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-bg-1 accent-primary-7"
          />
          <p className="text-[11px] text-text-2">
            {t("promptBuilder.topPDesc")}
          </p>
        </div>
      </section>

      <StepNav onBack={onBack} onContinue={onContinue} />
    </div>
  );
}

/* ─── Step 4: Preview & Test ─────────────────────────────────────────── */

interface SaveDetails {
  title: string;
  description: string;
  category: string;
  tagsInput: string;
}

function PreviewTestStep({
  prompt,
  params,
  details,
  setDetails,
  saving,
  editing,
  onBack,
  onSave,
}: {
  prompt: string;
  params: Params;
  details: SaveDetails;
  setDetails: (d: SaveDetails) => void;
  saving: boolean;
  editing: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();
  const canSave = details.title.trim().length > 0 && prompt.trim().length > 0 && !saving;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">{t("promptBuilder.previewTestTitle")}</h2>
        <p className="text-sm text-text-2">
          {t("promptBuilder.previewTestDesc")}
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <h3 className="text-sm font-semibold text-text-1">{t("promptBuilder.finalPrompt")}</h3>
        <pre className="whitespace-pre-wrap rounded border border-border-2 bg-bg-1 p-4 font-mono text-[13px] text-text-1">
          {prompt}
        </pre>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <h3 className="text-sm font-semibold text-text-1">{t("promptBuilder.configuration")}</h3>
        <div className="grid grid-cols-1 gap-3 text-[13px] text-text-2 sm:grid-cols-2">
          <span>{t("promptBuilder.cfgModel").replace("{model}", params.model)}</span>
          <span>{t("promptBuilder.cfgTemperature").replace("{value}", params.temperature.toFixed(2))}</span>
          <span>{t("promptBuilder.cfgMaxTokens").replace("{value}", String(params.maxTokens))}</span>
          <span>{t("promptBuilder.cfgTopP").replace("{value}", params.topP.toFixed(2))}</span>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-5">
        <h3 className="text-sm font-semibold text-text-1">{t("promptBuilder.saveDetails")}</h3>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-2">
            {t("promptBuilder.title")} <span className="text-danger-6">*</span>
          </label>
          <Input
            value={details.title}
            onChange={(e) => setDetails({ ...details, title: e.target.value })}
            className="h-10 rounded border-border-2 text-[13px]"
            placeholder={t("promptBuilder.titlePh")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-2">{t("promptBuilder.descriptionField")}</label>
          <Input
            value={details.description}
            onChange={(e) =>
              setDetails({ ...details, description: e.target.value })
            }
            className="h-10 rounded border-border-2 text-[13px]"
            placeholder={t("promptBuilder.descriptionFieldPh")}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">{t("promptBuilder.category")}</label>
            <Input
              value={details.category}
              onChange={(e) =>
                setDetails({ ...details, category: e.target.value })
              }
              className="h-10 rounded border-border-2 text-[13px]"
              placeholder={t("promptBuilder.categoryPh")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-2">
              {t("promptBuilder.tagsLabel")}
            </label>
            <Input
              value={details.tagsInput}
              onChange={(e) =>
                setDetails({ ...details, tagsInput: e.target.value })
              }
              className="h-10 rounded border-border-2 text-[13px]"
              placeholder={t("promptBuilder.tagsPh")}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={saving}
          className="h-10 rounded border-border-2 text-sm text-text-2"
        >
          {t("promptBuilder.back")}
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => toast.info(t("promptBuilder.testInChatToast"))}
            className="h-10 gap-2 rounded border-border-2 text-sm text-text-2"
          >
            <MessageSquare className="h-4 w-4" />
            {t("promptBuilder.testInChat")}
          </Button>
          <Button
            onClick={onSave}
            disabled={!canSave}
            className="h-10 gap-2 rounded bg-primary-7 text-sm text-text-white hover:bg-primary-7/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving
              ? editing
                ? t("promptBuilder.updating")
                : t("promptBuilder.saving")
              : editing
                ? t("promptBuilder.updatePrompt")
                : t("promptBuilder.savePrompt")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared step nav (Back + Continue) ──────────────────────────────── */

function StepNav({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        onClick={onBack}
        className="h-10 rounded border-border-2 text-sm text-text-2"
      >
        {t("promptBuilder.back")}
      </Button>
      <Button
        onClick={onContinue}
        className="h-10 gap-2 rounded bg-primary-7 text-sm text-text-white hover:bg-primary-7/90"
      >
        {t("promptBuilder.continue")}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function PromptBuilderPage() {
  return (
    <Suspense fallback={<PromptBuilderLoading />}>
      <PromptBuilderInner />
    </Suspense>
  );
}

function PromptBuilderLoading() {
  const { t } = useLanguage();
  return <div className="py-6 text-sm text-text-3">{t("promptBuilder.loading")}</div>;
}

function PromptBuilderInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const editId = searchParams.get("id");

  const [step, setStep] = useState(editId ? 1 : 0);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [variables, setVariables] = useState<Variable[]>(DEFAULT_VARIABLES);
  const [params, setParams] = useState<Params>({
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 2000,
    topP: 1,
  });
  const [details, setDetails] = useState<SaveDetails>({
    title: "",
    description: "",
    category: "",
    tagsInput: "",
  });
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setStep(1);
    fetchPrompt(editId)
      .then((p) => {
        if (cancelled) return;
        setPrompt(p.body);
        setVariables(
          (p.variables ?? []).map((v) => ({
            id: crypto.randomUUID(),
            name: v.name,
            defaultValue: v.default ?? "",
            description: v.description ?? "",
          })),
        );
        setParams({
          model: p.model ?? "gpt-4",
          temperature: p.temperature ?? 0.7,
          maxTokens: p.maxTokens ?? 2000,
          topP: p.topP ?? 1,
        });
        setDetails({
          title: p.title,
          description: p.description ?? "",
          category: p.category ?? "",
          tagsInput: p.tags.join(", "),
        });
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : t("promptBuilder.errLoad");
        toast.error(message);
        router.push("/toolkit/prompt-library");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, router, t]);

  const handleSave = async () => {
    const title = details.title.trim();
    const body = prompt.trim();
    if (!title) {
      toast.error(t("promptBuilder.errTitle"));
      return;
    }
    if (!body) {
      toast.error(t("promptBuilder.errBody"));
      return;
    }

    const tags = details.tagsInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    const payload: PromptInput = {
      title,
      description: details.description.trim() || null,
      body: prompt,
      category: details.category.trim() || null,
      tags,
      variables: variables
        .map((v) => ({
          name: v.name.trim(),
          description: v.description.trim() || undefined,
          default: v.defaultValue || undefined,
        }))
        .filter((v) => v.name),
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      topP: params.topP,
    };

    setSaving(true);
    try {
      if (editId) {
        await updatePrompt(editId, payload);
        toast.success(t("promptBuilder.updated"));
      } else {
        await createPrompt(payload);
        toast.success(t("promptBuilder.saved"));
      }
      router.push("/toolkit/prompt-library");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("promptBuilder.errSave");
      toast.error(message);
      setSaving(false);
    }
  };

  const handlePickTemplate = (template: Template) => {
    setPrompt(template.prompt);
    const matches = Array.from(template.prompt.matchAll(/{{\s*(\w+)\s*}}/g));
    const names = Array.from(new Set(matches.map((m) => m[1])));
    setVariables(
      names.map((name) => ({
        id: crypto.randomUUID(),
        name,
        defaultValue: "",
        description: "",
      })),
    );
    setDetails((d) => ({
      ...d,
      title: d.title || t(template.titleKey),
      description: d.description || t(template.descriptionKey),
      category: d.category || t(template.categoryKey),
    }));
    setStep(1);
  };

  const handleScratch = () => {
    setPrompt("");
    setVariables([]);
    setStep(1);
  };

  if (loading) {
    return (
      <div className="py-6 text-sm text-text-3">{t("promptBuilder.loadingPrompt")}</div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <Link
        href="/toolkit/prompt-library"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("promptBuilder.backToLibrary")}
      </Link>

      <Stepper active={step} onSelect={setStep} />

      <div className="flex flex-col gap-[30px] lg:flex-row">
        {step === 0 && !editId && (
          <SelectTemplateStep
            onPick={handlePickTemplate}
            onScratch={handleScratch}
          />
        )}
        {step === 1 && (
          <DefineVariablesStep
            prompt={prompt}
            setPrompt={setPrompt}
            variables={variables}
            setVariables={setVariables}
            onBack={() => (editId ? router.push("/toolkit/prompt-library") : setStep(0))}
            onContinue={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <ConfigureParametersStep
            params={params}
            setParams={setParams}
            onBack={() => setStep(1)}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <PreviewTestStep
            prompt={prompt}
            params={params}
            details={details}
            setDetails={setDetails}
            saving={saving}
            editing={Boolean(editId)}
            onBack={() => setStep(2)}
            onSave={handleSave}
          />
        )}

        <LivePreview
          promptDraft={step === 0 && !editId ? "" : prompt}
          variables={step === 0 && !editId ? [] : variables}
          model={params.model}
        />
      </div>
    </div>
  );
}
