"use client";

import { useState } from "react";
import {
  Search,
  Plus,
  Copy,
  Maximize2,
  FileText,
  ClipboardCheck,
  Database,
  Cog,
} from "lucide-react";
import { Input } from "@/components/ui/input";

type TemplateIcon = typeof FileText;

interface Template {
  title: string;
  category: string;
  description: string;
  icon: TemplateIcon;
}

const TEMPLATES: Template[] = [
  {
    title: "Legal Summary",
    category: "Legal",
    description:
      "Generate concise summaries of legal documents with key clauses highlighted",
    icon: FileText,
  },
  {
    title: "Proposal Review",
    category: "Procurement",
    description:
      "Comprehensive review of procurement proposals against requirements",
    icon: ClipboardCheck,
  },
  {
    title: "Data Extraction",
    category: "Data Analysis",
    description: "Extract structured data from unstructured documents",
    icon: Database,
  },
  {
    title: "Technical Specification",
    category: "Engineering",
    description:
      "Generate technical specifications from high-level requirements",
    icon: Cog,
  },
];

interface Step {
  title: string;
  caption: string;
}

const STEPS: Step[] = [
  { title: "Select Template", caption: "Choose a starting point" },
  { title: "Define Variables", caption: "Add placeholders" },
  { title: "Configure Parameters", caption: "Set AI behavior" },
  { title: "Preview & Test", caption: "Verify output" },
];

function Stepper({ active }: { active: number }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border-2 bg-bg-white p-4">
      {STEPS.map((step, i) => {
        const isActive = i === active;
        return (
          <div key={step.title} className="flex flex-1 items-center gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
                  isActive
                    ? "border-primary-7 bg-primary-7 text-text-white"
                    : "border-border-2 bg-bg-white text-text-3"
                }`}
              >
                {i + 1}
              </span>
              <div className="flex flex-col">
                <span
                  className={`text-sm font-semibold ${isActive ? "text-text-2" : "text-text-3"}`}
                >
                  {step.title}
                </span>
                <span className="text-xs text-text-3">{step.caption}</span>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <span className="h-px flex-1 bg-border-2" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const Icon = template.icon;
  return (
    <button
      type="button"
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

function LivePreview() {
  return (
    <section className="flex w-full flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 lg:w-[583px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-text-1">Live Preview</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Copy prompt"
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
        <span className="text-xs font-medium text-text-3">Prompt Draft</span>
        <div className="h-[200px] rounded border border-border-2 bg-bg-1 p-3">
          <span className="font-mono text-xs text-text-3">
            Your prompt will appear here...
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-border-2 pt-4">
        {[
          { label: "Template:", value: "Custom" },
          { label: "Variables:", value: "0" },
          { label: "Model:", value: "gpt-4" },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between">
            <span className="text-[11px] text-text-3">{label}</span>
            <span className="text-[11px] font-medium text-text-1">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function PromptBuilderPage() {
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
    <div className="flex flex-col gap-6 py-6">
      <Stepper active={0} />

      <div className="flex flex-col gap-[30px] lg:flex-row">
        {/* Left column — Template picker */}
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
              <TemplateCard key={t.title} template={t} />
            ))}
          </div>

          <button
            type="button"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-2 bg-bg-white py-6 text-sm font-medium text-text-3 transition-colors hover:border-primary-6 hover:text-primary-6"
          >
            <Plus className="h-4 w-4" />
            Start from Scratch
          </button>
        </div>

        {/* Right column — Live Preview */}
        <LivePreview />
      </div>
    </div>
  );
}
