"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Check,
  Info,
  RotateCcw,
  Save,
  Lightbulb,
  BarChart3,
  ArrowUp,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ScoreTone = "primary" | "success" | "warning" | "neutral";

interface QualityScore {
  label: string;
  value: number;
  tone: ScoreTone;
}

const SCORE_COLORS: Record<ScoreTone, { bar: string; text: string }> = {
  primary: { bar: "bg-primary-6", text: "text-primary-6" },
  success: { bar: "bg-success-7", text: "text-success-7" },
  warning: { bar: "bg-warning-6", text: "text-warning-6" },
  neutral: { bar: "bg-text-1", text: "text-text-1" },
};

const QUALITY_SCORES: QualityScore[] = [
  { label: "Overall Score", value: 91, tone: "primary" },
  { label: "Clarity", value: 92, tone: "success" },
  { label: "Specificity", value: 88, tone: "warning" },
  { label: "Safety", value: 95, tone: "neutral" },
];

type ImprovementId = "persona" | "format" | "safety" | "examples";

interface Improvement {
  id: ImprovementId;
  title: string;
  description: string;
  category: "Context" | "Structure" | "Safety" | "Clarity";
  applied: boolean;
  segment: string;
}

const PERSONA_SEGMENT = `You are an expert procurement analyst with 15 years of experience in government contracting and RFP evaluation.

Your task is to analyze the provided RFP document and provide a comprehensive bid/no-bid recommendation.

## Analysis Requirements:
1. Review the RFP requirements against our organizational capabilities
2. Assess the competitive landscape and win probability
3. Evaluate resource requirements and timeline feasibility
4. Calculate estimated costs vs. potential revenue
5. Identify compliance requirements and risks`;

const FORMAT_SEGMENT = `## Output Format:
Provide your analysis in the following structured JSON format:

{
  "recommendation": "BID" | "NO_BID" | "CONDITIONAL",
  "confidence_score": 0-100,
  "win_probability": 0-100,
  "key_strengths": ["strength 1", "strength 2", ...],
  "capability_gaps": ["gap 1", "gap 2", ...],
  "resource_requirements": { "team_size": number, "estimated_hours": number },
  "risks": ["risk 1", "risk 2", ...],
  "next_steps": ["action 1", "action 2", ...]
}`;

const SAFETY_SEGMENT = `## Safety Guidelines:
- Base all recommendations on factual information from the RFP
- Clearly distinguish between facts and assumptions
- Flag any missing critical information
- Do not make commitments beyond stated capabilities`;

const EXAMPLES_SEGMENT = `## Examples:
**Example 1 — Strong fit:** Mid-sized IT services RFP aligned with our core capabilities → recommendation: BID, confidence 85.
**Example 2 — Poor fit:** Heavy-construction RFP outside our sector → recommendation: NO_BID, confidence 95.`;

const INITIAL_IMPROVEMENTS: Improvement[] = [
  {
    id: "persona",
    title: "Added Persona Context",
    description:
      "Establishing expertise as a senior procurement analyst improves relevance and authoritative tone.",
    category: "Context",
    applied: true,
    segment: PERSONA_SEGMENT,
  },
  {
    id: "format",
    title: "Defined Output Format",
    description:
      "Structured JSON output ensures predictable, machine-readable results for downstream automation.",
    category: "Structure",
    applied: true,
    segment: FORMAT_SEGMENT,
  },
  {
    id: "safety",
    title: "Added Safety Constraints",
    description:
      "Explicit safety guidelines prevent hallucinations and ensure responsible AI behavior.",
    category: "Safety",
    applied: true,
    segment: SAFETY_SEGMENT,
  },
  {
    id: "examples",
    title: "Include Examples",
    description:
      "Adding 2-3 few-shot examples can significantly improve response consistency and accuracy.",
    category: "Clarity",
    applied: false,
    segment: EXAMPLES_SEGMENT,
  },
];

const SEGMENT_ORDER: ImprovementId[] = ["persona", "format", "safety", "examples"];

const CATEGORY_STYLES: Record<Improvement["category"], string> = {
  Context: "bg-primary-1 text-primary-7",
  Structure: "bg-success-1 text-success-7",
  Safety: "bg-warning-1 text-warning-6",
  Clarity: "bg-bg-1 text-text-2",
};

const BEST_PRACTICES: string[] = [
  "Always specify the AI's role and expertise level",
  "Define clear output format requirements upfront",
  "Include safety and compliance constraints",
  "Provide context about your use case",
  "Add examples for complex tasks",
];

const ORIGINAL_PROMPT = `Analyze this RFP and tell me if we should bid on it.`;

function composeImprovedPrompt(improvements: Improvement[]): string {
  const applied = new Map(
    improvements.filter((i) => i.applied).map((i) => [i.id, i.segment]),
  );
  if (applied.size === 0) return ORIGINAL_PROMPT;

  const parts: string[] = [];
  // Persona supplies its own task framing; otherwise keep the original task.
  parts.push(applied.get("persona") ?? ORIGINAL_PROMPT);
  for (const id of SEGMENT_ORDER) {
    if (id === "persona") continue;
    const segment = applied.get(id);
    if (segment) parts.push(segment);
  }
  return parts.join("\n\n");
}

function ScoreRow({ score }: { score: QualityScore }) {
  const colors = SCORE_COLORS[score.tone];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-1">
          {score.label}
        </span>
        <span className={`text-[14px] font-bold ${colors.text}`}>
          {score.value}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-1">
        <div
          className={`h-full rounded-full transition-[width] ${colors.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, score.value))}%` }}
        />
      </div>
    </div>
  );
}

export default function PromptImproverPage() {
  const [improvements, setImprovements] = useState<Improvement[]>(
    INITIAL_IMPROVEMENTS,
  );

  const improvedPrompt = useMemo(
    () => composeImprovedPrompt(improvements),
    [improvements],
  );
  const appliedCount = useMemo(
    () => improvements.filter((i) => i.applied).length,
    [improvements],
  );

  const toggleImprovement = (id: ImprovementId) => {
    setImprovements((prev) =>
      prev.map((i) => (i.id === id ? { ...i, applied: !i.applied } : i)),
    );
  };

  const applyAll = () => {
    setImprovements((prev) => prev.map((i) => ({ ...i, applied: true })));
    toast.success("All improvements applied");
  };

  const reset = () => {
    setImprovements(INITIAL_IMPROVEMENTS);
    toast.success("Improvements reset to defaults");
  };

  const save = async () => {
    try {
      await navigator.clipboard.writeText(improvedPrompt);
      toast.success("Improved prompt copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const originalChars = ORIGINAL_PROMPT.length;
  const improvedChars = improvedPrompt.length;
  const estimatedTokens = Math.round(improvedChars / 4);
  const improvementPct =
    originalChars > 0
      ? Math.round(((improvedChars - originalChars) / originalChars) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6 py-6">
      <Link
        href="/resources"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[13px] font-medium text-text-2 hover:text-primary-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Resources
      </Link>

      {/* Intro action row */}
      <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-1">
            <Sparkles className="h-5 w-5 text-primary-6" strokeWidth={2} />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-[20px] font-bold leading-[1.5] text-text-1">
              AI-Powered Optimization
            </h2>
            <p className="text-[13px] leading-[1.5] text-text-2">
              Enhance your prompts with enterprise-grade improvements for
              clarity, safety, and effectiveness
            </p>
          </div>
        </div>
        <Button
          onClick={applyAll}
          className="shrink-0 cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
        >
          <Sparkles className="h-4 w-4" />
          Apply Improvements
        </Button>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_382px]">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Quality Assessment */}
          <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6">
            <div className="flex items-center gap-2">
              <BarChart3
                className="h-5 w-5 text-primary-6"
                strokeWidth={2}
              />
              <h3 className="text-[16px] font-bold leading-[1.5] text-text-1">
                Quality Assessment
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {QUALITY_SCORES.map((s) => (
                <ScoreRow key={s.label} score={s} />
              ))}
            </div>
          </section>

          {/* Original Prompt */}
          <section className="overflow-hidden rounded-lg border border-border-2 bg-bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-border-2 bg-bg-1 px-5 py-3">
              <h3 className="text-[14px] font-semibold text-text-1">
                Original Prompt
              </h3>
              <span className="text-[11px] text-text-3">
                {originalChars} characters
              </span>
            </header>
            <div className="p-5">
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-[1.625] text-text-1">
                {ORIGINAL_PROMPT}
              </pre>
            </div>
          </section>

          {/* AI-Improved Version */}
          <section className="overflow-hidden rounded-lg border-2 border-border-4 bg-primary-1">
            <header className="flex items-center justify-between gap-3 border-b border-border-4/40 px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="h-4 w-4 text-primary-6"
                  strokeWidth={2}
                />
                <h3 className="text-[14px] font-semibold text-text-1">
                  AI-Improved Version
                </h3>
              </div>
              <span className="text-[11px] text-text-3">
                {improvedChars} characters
              </span>
            </header>
            <div className="p-5">
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-[1.625] text-text-1">
                {improvedPrompt}
              </pre>
            </div>
          </section>

          {/* Action bar */}
          <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary-8" strokeWidth={2.5} />
              <span className="text-[13px] font-medium text-primary-8">
                {appliedCount} of {improvements.length} improvements applied
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={reset}
                className="cursor-pointer gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              <Button
                onClick={save}
                className="cursor-pointer gap-2 bg-primary-7 hover:bg-primary-7/90"
              >
                <Save className="h-4 w-4" />
                Save Improved Prompt
              </Button>
            </div>
          </section>
        </div>

        {/* Right column */}
        <aside className="flex flex-col gap-6">
          {/* Suggested Improvements */}
          <section className="flex flex-col gap-4 rounded-lg border border-border-2 bg-bg-white p-6">
            <div className="flex items-center gap-2">
              <Lightbulb
                className="h-5 w-5 text-warning-6"
                strokeWidth={2}
              />
              <h3 className="text-[16px] font-bold leading-[1.5] text-text-1">
                Suggested Improvements
              </h3>
            </div>
            <ul className="flex flex-col gap-3">
              {improvements.map((imp) => (
                <li key={imp.id}>
                  <button
                    type="button"
                    onClick={() => toggleImprovement(imp.id)}
                    className={`flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                      imp.applied
                        ? "border-success-7/30 bg-success-1"
                        : "border-border-2 bg-bg-white hover:border-primary-6"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                            imp.applied
                              ? "bg-success-7"
                              : "border border-border-2 bg-bg-white"
                          }`}
                        >
                          {imp.applied && (
                            <Check
                              className="h-3 w-3 text-text-white"
                              strokeWidth={3}
                            />
                          )}
                        </div>
                        <span className="text-[13px] font-semibold text-text-1">
                          {imp.title}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[imp.category]}`}
                      >
                        {imp.category}
                      </span>
                    </div>
                    <p className="pl-6 text-[12px] leading-[1.5] text-text-2">
                      {imp.description}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Enterprise Best Practices */}
          <section className="flex flex-col gap-3 rounded-lg border border-border-4/40 bg-primary-1 p-6">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary-6" strokeWidth={2} />
              <h3 className="text-[14px] font-bold leading-[1.5] text-text-1">
                Enterprise Best Practices
              </h3>
            </div>
            <ul className="flex flex-col gap-2">
              {BEST_PRACTICES.map((p) => (
                <li
                  key={p}
                  className="flex items-start gap-2 text-[12px] leading-[1.5] text-text-1"
                >
                  <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-primary-6" />
                  {p}
                </li>
              ))}
            </ul>
          </section>

          {/* Prompt Statistics */}
          <section className="flex flex-col gap-3 rounded-lg border border-border-2 bg-bg-white p-6">
            <h3 className="text-[14px] font-bold leading-[1.5] text-text-1">
              Prompt Statistics
            </h3>
            <dl className="flex flex-col gap-2.5 text-[12px]">
              <div className="flex items-center justify-between">
                <dt className="text-text-2">Original Length</dt>
                <dd className="font-semibold text-text-1">
                  {originalChars} chars
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-text-2">Improved Length</dt>
                <dd className="font-semibold text-text-1">
                  {improvedChars} chars
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-text-2">Estimated Tokens</dt>
                <dd className="font-semibold text-text-1">
                  ~{estimatedTokens}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-border-2 pt-2.5">
                <dt className="text-text-2">Improvement in Success</dt>
                <dd className="inline-flex items-center gap-1 font-bold text-success-7">
                  <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />+
                  {improvementPct}%
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
