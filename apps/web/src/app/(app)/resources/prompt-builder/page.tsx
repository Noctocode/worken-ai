"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TemplateIcon = typeof FileText;

interface Template {
  title: string;
  category: string;
  description: string;
  icon: TemplateIcon;
  prompt: string;
}

const TEMPLATES: Template[] = [
  {
    title: "Legal Summary",
    category: "Legal",
    description:
      "Generate concise summaries of legal documents with key clauses highlighted",
    icon: FileText,
    prompt:
      "Summarize the following legal document and list the {{key_clauses}}. Highlight obligations, deadlines, and termination conditions. Format the output as {{output_format}}.",
  },
  {
    title: "Proposal Review",
    category: "Procurement",
    description:
      "Comprehensive review of procurement proposals against requirements",
    icon: ClipboardCheck,
    prompt:
      "Review the attached proposal against {{requirements}}. Score each criterion out of 10 and produce a structured comparison. Format the output as {{output_format}}.",
  },
  {
    title: "Data Extraction",
    category: "Data Analysis",
    description: "Extract structured data from unstructured documents",
    icon: Database,
    prompt:
      "Extract and structure the following data from the document: {{data_fields}}. Format the output as {{output_format}}.",
  },
  {
    title: "Technical Specification",
    category: "Engineering",
    description:
      "Generate technical specifications from high-level requirements",
    icon: Cog,
    prompt:
      "Translate the following high-level requirements into a detailed technical specification for {{audience}}. Include architecture, dependencies, and acceptance criteria. Format the output as {{output_format}}.",
  },
];

const STEPS = [
  { title: "Select Template", caption: "Choose a starting point" },
  { title: "Define Variables", caption: "Add placeholders" },
  { title: "Configure Parameters", caption: "Set AI behavior" },
  { title: "Preview & Test", caption: "Verify output" },
] as const;

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
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-2 bg-bg-white p-4">
      {STEPS.map((step, i) => {
        const isActive = i === active;
        const reachable = i <= active;
        return (
          <div key={step.title} className="flex flex-1 items-center gap-4">
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
                  {step.title}
                </span>
                <span className="text-xs text-text-3">{step.caption}</span>
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
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex cursor-pointer items-start gap-4 rounded-lg border border-border-2 bg-bg-white p-5 text-left transition-colors hover:border-primary-6"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#EBF8FF]">
        <Icon className="h-6 w-6 text-primary-6" strokeWidth={2} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-text-1">{template.title}</h3>
        <span className="inline-flex w-fit items-center rounded bg-bg-1 px-2 py-0.5 text-[11px] font-medium text-text-3">
          {template.category}
        </span>
        <p className="text-xs font-medium text-text-3">{template.description}</p>
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
  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 lg:w-[583px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-text-1">Live Preview</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Copy prompt"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(promptDraft);
                toast.success("Prompt copied to clipboard.");
              } catch {
                toast.error("Couldn't copy to clipboard.");
              }
            }}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Expand"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-text-2">Prompt Draft</span>
        <div className="min-h-[200px] rounded border border-border-2 bg-bg-1 p-3">
          <span
            className={`font-mono text-xs whitespace-pre-wrap ${promptDraft ? "text-text-1" : "text-text-3"}`}
          >
            {promptDraft || "Your prompt will appear here..."}
          </span>
        </div>
      </div>

      {variables.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-text-2">
            Variables ({variables.length})
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
          { label: "Template:", value: "Custom" },
          { label: "Variables:", value: String(variables.length) },
          { label: "Model:", value: model },
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
  const [query, setQuery] = useState("");
  const filtered = TEMPLATES.filter((t) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">Choose a Template</h2>
        <p className="text-sm text-text-3">
          Start with a pre-built template or create from scratch
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates by name, category, or use case..."
          className="h-11 pl-9 pr-3 text-base rounded-md border-border-2 placeholder:text-text-3"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map((t) => (
          <TemplateCard key={t.title} template={t} onSelect={() => onPick(t)} />
        ))}
      </div>

      <button
        type="button"
        onClick={onScratch}
        className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-2 bg-bg-white py-6 text-sm font-medium text-text-3 transition-colors hover:border-primary-6 hover:text-primary-6"
      >
        <Plus className="h-4 w-4" />
        Start from Scratch
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
        <h2 className="text-xl font-bold text-text-1">Define Variables</h2>
        <p className="text-sm text-text-2">
          Add placeholders that will be replaced with actual values
        </p>
      </div>

      {/* Prompt Template */}
      <section className="flex flex-col gap-2 rounded-lg border border-border-2 bg-bg-white p-5">
        <label className="text-[13px] font-semibold text-text-1">
          Prompt Template
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          placeholder="Write your prompt here. Use {{variable_name}} to insert variables..."
          className="font-mono text-[13px] rounded border-border-2"
        />
        <p className="text-xs text-text-2">
          Variables are shown as{" "}
          <span className="rounded bg-border-2 px-1.5 py-0.5 font-mono text-xs text-text-1">
            {"{{variable_name}}"}
          </span>
        </p>
      </section>

      {/* Variables list */}
      <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-text-1">Variables</h3>
          <button
            type="button"
            onClick={addVariable}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-[#EBF8FF] px-3 py-1.5 text-xs font-medium text-text-2 transition-colors hover:bg-primary-6/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Variable
          </button>
        </div>

        {variables.length === 0 ? (
          <p className="rounded border border-dashed border-border-2 bg-bg-1 p-6 text-center text-xs text-text-3">
            No variables yet. Click Add Variable to define a placeholder.
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
                      Variable Name
                    </label>
                    <Input
                      value={v.name}
                      onChange={(e) => updateVariable(v.id, { name: e.target.value })}
                      className="h-10 rounded border-border-2 font-mono text-[13px]"
                      placeholder="variable_name"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-text-2">
                      Default Value
                    </label>
                    <Input
                      value={v.defaultValue}
                      onChange={(e) =>
                        updateVariable(v.id, { defaultValue: e.target.value })
                      }
                      className="h-10 rounded border-border-2 text-[13px]"
                      placeholder="Optional default value"
                    />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs font-medium text-text-2">
                      Description
                    </label>
                    <Input
                      value={v.description}
                      onChange={(e) =>
                        updateVariable(v.id, { description: e.target.value })
                      }
                      className="h-10 rounded border-border-2 text-[13px]"
                      placeholder="What this variable represents..."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariable(v.id)}
                    title="Remove variable"
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
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">Configure Parameters</h2>
        <p className="text-sm text-text-2">
          Fine-tune AI behavior for optimal results
        </p>
      </div>

      <section className="flex flex-col gap-6 rounded-lg border border-border-2 bg-bg-white p-5">
        {/* Model Selection */}
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold text-text-1">
            Model Selection
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
              Temperature
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
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#F2F3F5] accent-primary-7"
          />
          <div className="flex justify-between text-[11px] text-text-2">
            <span>Focused</span>
            <span>Creative</span>
          </div>
        </div>

        {/* Max Tokens */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-text-1">
              Max Tokens
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
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#F2F3F5] accent-primary-7"
          />
          <p className="text-[11px] text-text-2">
            Maximum length of the AI response
          </p>
        </div>

        {/* Top P */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold text-text-1">
              Top P
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
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#F2F3F5] accent-primary-7"
          />
          <p className="text-[11px] text-text-2">
            Controls diversity via nucleus sampling
          </p>
        </div>
      </section>

      <StepNav onBack={onBack} onContinue={onContinue} />
    </div>
  );
}

/* ─── Step 4: Preview & Test ─────────────────────────────────────────── */

function PreviewTestStep({
  prompt,
  params,
  onBack,
  onSave,
}: {
  prompt: string;
  params: Params;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold text-text-1">Preview & Test</h2>
        <p className="text-sm text-text-2">
          Review your prompt and test with sample data
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <h3 className="text-sm font-semibold text-text-1">Final Prompt</h3>
        <pre className="whitespace-pre-wrap rounded border border-border-2 bg-bg-1 p-4 font-mono text-[13px] text-text-1">
          {prompt}
        </pre>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-5">
        <h3 className="text-sm font-semibold text-text-1">Configuration</h3>
        <div className="grid grid-cols-1 gap-3 text-[13px] text-slate-500 sm:grid-cols-2">
          <span>Model: {params.model}</span>
          <span>Temperature: {params.temperature.toFixed(2)}</span>
          <span>Max Tokens: {params.maxTokens}</span>
          <span>Top P: {params.topP.toFixed(2)}</span>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={onBack}
          className="h-10 rounded border-border-2 text-sm text-text-2"
        >
          Back
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => toast.info("Test in Chat is coming soon.")}
            className="h-10 gap-2 rounded border-border-2 text-sm text-text-2"
          >
            <MessageSquare className="h-4 w-4" />
            Test in Chat
          </Button>
          <Button
            onClick={onSave}
            className="h-10 gap-2 rounded bg-primary-7 text-sm text-text-white hover:bg-primary-7/90"
          >
            <Save className="h-4 w-4" />
            Save Prompt
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
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        onClick={onBack}
        className="h-10 rounded border-border-2 text-sm text-text-2"
      >
        Back
      </Button>
      <Button
        onClick={onContinue}
        className="h-10 gap-2 rounded bg-primary-7 text-sm text-text-white hover:bg-primary-7/90"
      >
        Continue
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */

export default function PromptBuilderPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [variables, setVariables] = useState<Variable[]>(DEFAULT_VARIABLES);
  const [params, setParams] = useState<Params>({
    model: "gpt-4",
    temperature: 0.7,
    maxTokens: 2000,
    topP: 1,
  });

  const handleSave = () => {
    toast.success("Prompt saved.");
    router.push("/resources/prompt-library");
  };

  const handlePickTemplate = (template: Template) => {
    setPrompt(template.prompt);
    // Derive variables from {{name}} placeholders in the template.
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
    setStep(1);
  };

  const handleScratch = () => {
    setPrompt("");
    setVariables([]);
    setStep(1);
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <Link
        href="/resources"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Resources
      </Link>

      <Stepper active={step} onSelect={setStep} />

      <div className="flex flex-col gap-[30px] lg:flex-row">
        {step === 0 && (
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
            onBack={() => setStep(0)}
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
            onBack={() => setStep(2)}
            onSave={handleSave}
          />
        )}

        <LivePreview
          promptDraft={step === 0 ? "" : prompt}
          variables={step === 0 ? [] : variables}
          model={params.model}
        />
      </div>
    </div>
  );
}
