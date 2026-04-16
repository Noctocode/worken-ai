"use client";

import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Image as ImageIcon,
  Info,
  Library,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendQuestionToCompareModels } from "@/lib/api";
import { MODELS } from "@/lib/models";

// Types for evaluation JSON
type ModelEvaluation = {
  name: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
  summary: string;
  totalTokens?: number;
  totalCost?: number;
  time?: number;
};

interface HistoryEntry {
  id: string;
  question: string;
  ts: string; // human label, e.g. "Today"
}

const MODEL_COLORS: Record<string, string> = {
  // simple deterministic palette per model id; falls back to gray.
  "stepfun/step-3.5-flash:free": "bg-[#10A37F]/10 text-[#10A37F]",
  "arcee-ai/trinity-large-preview:free": "bg-[#C2410C]/10 text-[#C2410C]",
  "liquid/lfm-2.5-1.2b-thinking:free": "bg-[#4338CA]/10 text-[#4338CA]",
};

function getModelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

function getModelTone(id: string): string {
  return MODEL_COLORS[id] ?? "bg-bg-1 text-text-2";
}

function scoreBadgeTone(score: number): string {
  if (score >= 8) return "bg-[#E8F7EE] text-[#009A29]";
  if (score >= 5) return "bg-[#FFF3E6] text-[#FF7D00]";
  return "bg-[#FDEDED] text-[#D92D20]";
}

export default function CompareModelsPage() {
  const [modelA, setModelA] = useState<string>(MODELS[0].id);
  const [modelB, setModelB] = useState<string>(MODELS[1].id);
  const [question, setQuestion] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [responseA, setResponseA] = useState<string | null>(null);
  const [responseB, setResponseB] = useState<string | null>(null);
  const [evaluationA, setEvaluationA] = useState<ModelEvaluation | null>(null);
  const [evaluationB, setEvaluationB] = useState<ModelEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);

  const [railOpen, setRailOpen] = useState(true);
  const [modelsExpanded, setModelsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const hasResults =
    responseA !== null ||
    responseB !== null ||
    evaluationA !== null ||
    evaluationB !== null;

  async function compareModels(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResponseA(null);
    setResponseB(null);
    setEvaluationA(null);
    setEvaluationB(null);
    setSubmittedQuestion(question);

    try {
      const response = await sendQuestionToCompareModels(
        [modelA, modelB],
        question,
        expectedOutput,
      );

      setResponseA(
        response.responses.find((r) => r.model === modelA)?.response.content ??
          null,
      );
      setResponseB(
        response.responses.find((r) => r.model === modelB)?.response.content ??
          null,
      );
      setEvaluationA(
        response.comparison.find((c) => c.name === modelA) ?? null,
      );
      setEvaluationB(
        response.comparison.find((c) => c.name === modelB) ?? null,
      );

      setHistory((prev) =>
        [
          { id: crypto.randomUUID(), question, ts: "Today" },
          ...prev,
        ].slice(0, 10),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't compare models.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function newComparison() {
    setQuestion("");
    setExpectedOutput("");
    setResponseA(null);
    setResponseB(null);
    setEvaluationA(null);
    setEvaluationB(null);
    setSubmittedQuestion(null);
  }

  async function copyText(text: string, label = "response") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 py-6">
      {/* Page header action row */}
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={newComparison}
          className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
        >
          <Plus className="h-4 w-4" />
          New Comparison
        </Button>
      </div>

      {/* Body shell: main column + optional right rail */}
      <div className="flex min-h-0 flex-1 gap-6">
        {/* Main column */}
        <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border border-border-2 bg-bg-white p-6">
          {/* Scrollable content area (prompt + responses) */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {!hasResults && !loading && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
                <Sparkles className="h-8 w-8 text-text-3" strokeWidth={1.5} />
                <h3 className="text-[16px] font-semibold text-text-1">
                  Compare two models side by side
                </h3>
                <p className="max-w-[420px] text-[13px] text-text-2">
                  Pick two models in the right rail, write a prompt and the
                  expected output, then hit Compare.
                </p>
              </div>
            )}

            {submittedQuestion && (
              <PromptBubble
                question={submittedQuestion}
                onEdit={() => setQuestion(submittedQuestion)}
              />
            )}

            {(loading || hasResults) && (
              <div className="flex flex-wrap gap-4">
                <ResponseCard
                  modelId={modelA}
                  response={responseA}
                  evaluation={evaluationA}
                  loading={loading && responseA === null}
                  onCopy={(t) => copyText(t, getModelLabel(modelA))}
                />
                <ResponseCard
                  modelId={modelB}
                  response={responseB}
                  evaluation={evaluationB}
                  loading={loading && responseB === null}
                  onCopy={(t) => copyText(t, getModelLabel(modelB))}
                />
              </div>
            )}
          </div>

          {/* Composer (anchored at bottom) */}
          <Composer
            question={question}
            setQuestion={setQuestion}
            expectedOutput={expectedOutput}
            setExpectedOutput={setExpectedOutput}
            loading={loading}
            onSubmit={compareModels}
          />
        </section>

        {/* Right rail */}
        {railOpen ? (
          <RightRail
            modelA={modelA}
            modelB={modelB}
            setModelA={setModelA}
            setModelB={setModelB}
            modelsExpanded={modelsExpanded}
            setModelsExpanded={setModelsExpanded}
            historyExpanded={historyExpanded}
            setHistoryExpanded={setHistoryExpanded}
            history={history}
            onLoadHistory={(q) => {
              setQuestion(q);
              setSubmittedQuestion(null);
              setResponseA(null);
              setResponseB(null);
              setEvaluationA(null);
              setEvaluationB(null);
            }}
            onClose={() => setRailOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="self-start cursor-pointer rounded-lg border border-border-2 bg-bg-white p-2 text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            title="Open Comparison Details"
            aria-label="Open Comparison Details"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Prompt bubble ──────────────────────────────────────────────────── */

function PromptBubble({
  question,
  onEdit,
}: {
  question: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-bg-1 p-4">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[11px] font-semibold text-white">
        U
      </div>
      <p className="flex-1 text-[14px] italic leading-[1.5] text-text-1">
        “{question}”
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border-2 bg-bg-white text-text-2 transition-colors hover:text-text-1"
        title="Edit prompt"
        aria-label="Edit prompt"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ─── Response + evaluation card ─────────────────────────────────────── */

function ResponseCard({
  modelId,
  response,
  evaluation,
  loading,
  onCopy,
}: {
  modelId: string;
  response: string | null;
  evaluation: ModelEvaluation | null;
  loading: boolean;
  onCopy: (text: string) => void;
}) {
  const label = getModelLabel(modelId);
  const tone = getModelTone(modelId);

  return (
    <article className="flex min-w-0 flex-1 basis-[320px] flex-col gap-3 rounded-lg bg-bg-1 p-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}
          >
            <Bot className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="truncate text-[14px] font-semibold text-text-1">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {evaluation?.time !== undefined && (
            <span className="text-[11px] font-medium text-text-3">
              {(evaluation.time / 1000).toFixed(1)}s
            </span>
          )}
          <button
            type="button"
            onClick={() => response && onCopy(response)}
            disabled={!response}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            title="Copy response"
            aria-label="Copy response"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
            title="Model info"
            aria-label="Model info"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="rounded bg-bg-white p-3 text-[13px] leading-[1.625] text-text-1">
        {loading ? (
          <ResponseSkeleton />
        ) : response ? (
          <AiResponseRender content={response} />
        ) : (
          <span className="text-text-3">No response.</span>
        )}
      </div>

      {/* Evaluation */}
      {evaluation && <EvaluationBlock evaluation={evaluation} />}

      {/* Footer reactions */}
      <footer className="flex items-center gap-1 border-t border-border-2 pt-2">
        <button
          type="button"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
          title="Helpful"
          aria-label="Helpful"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
          title="Not helpful"
          aria-label="Not helpful"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => response && onCopy(response)}
          disabled={!response}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          title="Copy"
          aria-label="Copy"
        >
          <Clipboard className="h-3.5 w-3.5" />
        </button>
      </footer>
    </article>
  );
}

function ResponseSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-3 w-3/4 animate-pulse rounded bg-bg-1" />
      <div className="h-3 w-full animate-pulse rounded bg-bg-1" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-bg-1" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-bg-1" />
    </div>
  );
}

function EvaluationBlock({ evaluation }: { evaluation: ModelEvaluation }) {
  return (
    <div className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-text-2">
          Evaluation
        </span>
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold ${scoreBadgeTone(evaluation.score)}`}
        >
          Score: {evaluation.score}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-2">
        {evaluation.totalTokens !== undefined && (
          <span>
            Tokens:{" "}
            <span className="font-semibold text-text-1">
              {evaluation.totalTokens}
            </span>
          </span>
        )}
        {evaluation.totalCost !== undefined && (
          <span>
            Cost:{" "}
            <span className="font-semibold text-text-1">
              ${Number(evaluation.totalCost).toFixed(5)}
            </span>
          </span>
        )}
        {evaluation.time !== undefined && (
          <span>
            Time:{" "}
            <span className="font-semibold text-text-1">
              {evaluation.time} ms
            </span>
          </span>
        )}
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-2">
          Advantages
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[#009A29]">
          {evaluation.advantages.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-2">
          Disadvantages
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[#D92D20]">
          {evaluation.disadvantages.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </div>

      <p className="text-[12px] italic leading-[1.5] text-text-1">
        {evaluation.summary}
      </p>
    </div>
  );
}

/* ─── Composer ───────────────────────────────────────────────────────── */

function Composer({
  question,
  setQuestion,
  expectedOutput,
  setExpectedOutput,
  loading,
  onSubmit,
}: {
  question: string;
  setQuestion: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-2xl border border-border-2 bg-bg-white p-3 shadow-[0_4px_4px_rgba(0,0,0,0.04)]"
    >
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask me anything…"
        className="min-h-[72px] w-full resize-y rounded-md border-0 bg-bg-white px-2 py-2 text-[14px] text-text-1 placeholder:text-text-3 focus:outline-none"
        disabled={loading}
      />
      <textarea
        value={expectedOutput}
        onChange={(e) => setExpectedOutput(e.target.value)}
        placeholder="Expected output (used to score the responses)"
        className="min-h-[56px] w-full resize-y rounded-md border-t border-border-2 bg-bg-white px-2 py-2 text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
        disabled={loading}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <ComposerChip icon={Paperclip} label="Attach File" disabled />
          <ComposerChip icon={ImageIcon} label="Upload Image" disabled />
          <ComposerChip icon={Library} label="Prompt Library" disabled />
        </div>
        <Button
          type="submit"
          disabled={!question.trim() || !expectedOutput.trim() || loading}
          className="cursor-pointer gap-2 bg-primary-6 hover:bg-primary-7"
        >
          <Sparkles className="h-4 w-4" />
          {loading ? "Comparing…" : "Compare"}
        </Button>
      </div>
    </form>
  );
}

function ComposerChip({
  icon: Icon,
  label,
  disabled,
}: {
  icon: typeof Paperclip;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border-2 bg-bg-white px-3 py-1.5 text-[12px] font-medium text-text-2 transition-colors hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      title={disabled ? "Coming soon" : label}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/* ─── Right rail ─────────────────────────────────────────────────────── */

function RightRail({
  modelA,
  modelB,
  setModelA,
  setModelB,
  modelsExpanded,
  setModelsExpanded,
  historyExpanded,
  setHistoryExpanded,
  history,
  onLoadHistory,
  onClose,
}: {
  modelA: string;
  modelB: string;
  setModelA: (v: string) => void;
  setModelB: (v: string) => void;
  modelsExpanded: boolean;
  setModelsExpanded: (v: boolean) => void;
  historyExpanded: boolean;
  setHistoryExpanded: (v: boolean) => void;
  history: HistoryEntry[];
  onLoadHistory: (q: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border border-border-2 bg-bg-white p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-[14px] font-bold text-text-1">
          Comparison Details
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
          title="Close"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Models section */}
      <RailSection
        title="Models"
        expanded={modelsExpanded}
        onToggle={() => setModelsExpanded(!modelsExpanded)}
      >
        <ModelPill
          slot="A"
          value={modelA}
          onChange={setModelA}
          disabledIds={[modelB]}
        />
        <ModelPill
          slot="B"
          value={modelB}
          onChange={setModelB}
          disabledIds={[modelA]}
        />
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-2 bg-bg-white px-3 py-2 text-[12px] font-medium text-text-3"
          title="Coming soon"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Model
        </button>
      </RailSection>

      {/* History section */}
      <RailSection
        title="History"
        expanded={historyExpanded}
        onToggle={() => setHistoryExpanded(!historyExpanded)}
      >
        {history.length === 0 ? (
          <p className="text-[12px] text-text-3">
            Your recent comparisons will appear here.
          </p>
        ) : (
          <>
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-2">
              Today
            </p>
            <ul className="flex flex-col gap-1">
              {history.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => onLoadHistory(h.question)}
                    className="line-clamp-2 w-full cursor-pointer rounded px-2 py-1.5 text-left text-[12px] text-text-1 transition-colors hover:bg-bg-1"
                    title={h.question}
                  >
                    {h.question}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </RailSection>
    </aside>
  );
}

function RailSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between rounded text-left text-[13px] font-semibold text-text-1 transition-colors hover:text-primary-6"
      >
        {title}
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {expanded && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}

function ModelPill({
  slot,
  value,
  onChange,
  disabledIds,
}: {
  slot: string;
  value: string;
  onChange: (v: string) => void;
  disabledIds: string[];
}) {
  const tone = getModelTone(value);
  return (
    <div className="flex items-center gap-2 rounded-full border border-border-2 bg-bg-white p-1 pr-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        <Bot className="h-4 w-4" />
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-text-3">
        {slot}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-[12px] font-medium shadow-none focus:ring-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODELS.map((m) => (
            <SelectItem
              key={m.id}
              value={m.id}
              disabled={disabledIds.includes(m.id) && m.id !== value}
            >
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ─── Markdown renderer (kept from previous implementation) ──────────── */

function aiResponseToHtml(raw: string): string {
  if (!raw) return "";

  const lines = raw.split(/\r?\n/);

  const htmlLines: string[] = [];
  let i = 0;
  let inCodeBlock = false;

  function processBold(text: string): string {
    return text.replace(
      /\*\*(.+?)\*\*/g,
      (_, inner) => `<strong>${escapeHtml(inner)}</strong>`,
    );
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        htmlLines.push("<pre><code>");
      } else {
        inCodeBlock = false;
        htmlLines.push("</code></pre>");
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      htmlLines.push(
        line.replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#039;",
            })[c]!,
        ),
      );
      i++;
      continue;
    }

    if (
      /^\s*\|(.+\|)+\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])
    ) {
      const header = lines[i]
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => processBold(escapeHtml(cell.trim())));
      i += 2;

      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|(.+\|)+\s*$/.test(lines[i])) {
        const row = lines[i]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => processBold(escapeHtml(cell.trim())));
        rows.push(row);
        i++;
      }

      let tableHtml = '<table class="prose-table w-full my-4 border-collapse">';
      tableHtml += "<thead><tr>";
      for (const h of header) {
        tableHtml += `<th class="border-b px-4 py-2 text-left font-medium">${h}</th>`;
      }
      tableHtml += "</tr></thead>\n<tbody>";
      for (const row of rows) {
        tableHtml += "<tr>";
        for (const cell of row) {
          tableHtml += `<td class="border-b px-4 py-2 align-top">${cell}</td>`;
        }
        tableHtml += "</tr>";
      }
      tableHtml += "</tbody></table>";
      htmlLines.push(tableHtml);
      continue;
    }

    if (/^###\s+/.test(line)) {
      htmlLines.push(
        `<h3 class="mt-4 mb-1 font-bold text-lg">${processBold(
          line.replace(/^###\s+/, ""),
        )}</h3>`,
      );
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      htmlLines.push(
        `<h2 class="mt-4 mb-2 font-bold text-xl">${processBold(
          line.replace(/^##\s+/, ""),
        )}</h2>`,
      );
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      htmlLines.push(
        `<h1 class="mt-5 mb-2 font-bold text-2xl">${processBold(
          line.replace(/^#\s+/, ""),
        )}</h1>`,
      );
      i++;
      continue;
    }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      htmlLines.push("<br />");
      htmlLines.push("<hr />");
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, "")))}</li>`,
        );
        i++;
      }
      htmlLines.push("<ul>" + items.join("") + "</ul>");
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, "")))}</li>`,
        );
        i++;
      }
      htmlLines.push("<ol>" + items.join("") + "</ol>");
      continue;
    }

    if (line.trim() !== "") {
      htmlLines.push("<p>" + processBold(escapeHtml(line)) + "</p>");
    }
    i++;
  }

  return htmlLines.join("\n");
}

function escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function AiResponseRender({ content }: { content: string }) {
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: aiResponseToHtml(content) }}
    />
  );
}
