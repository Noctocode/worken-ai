"use client";

import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  LayoutGrid,
  Image as ImageIcon,
  Info,
  Library,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Mic,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  deleteArenaRun,
  fetchArenaRun,
  fetchArenaRuns,
  fetchPrompts,
  fetchShortcuts,
  parseArenaAttachment,
  sendQuestionToCompareModels,
  type ArenaRunSummary,
  type PromptSummary,
  type Shortcut,
} from "@/lib/api";
import { humanizeArenaError } from "@/lib/arena-errors";
import { MODELS } from "@/lib/models";

function getModelProvider(id: string): string {
  const slug = id.split("/")[0] ?? "Unknown";
  return slug
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

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
  createdAt: string;
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);
  if (d >= startOfToday) return "Today";
  if (d >= startOfYesterday) return "Yesterday";
  return d.toLocaleDateString();
}

function groupHistoryByDate(entries: HistoryEntry[]): { label: string; items: HistoryEntry[] }[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const label = formatHistoryDate(entry.createdAt);
    const existing = groups.get(label) ?? [];
    existing.push(entry);
    groups.set(label, existing);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function toHistoryEntry(run: ArenaRunSummary): HistoryEntry {
  return { id: run.id, question: run.question, createdAt: run.createdAt };
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

const MIN_MODELS = 2;

function slotLabel(index: number): string {
  // A, B, C, ... AA after Z. Plenty for our purposes.
  if (index < 26) return String.fromCharCode(65 + index);
  return `M${index + 1}`;
}

export default function CompareModelsPage() {
  const [selectedModels, setSelectedModels] = useState<string[]>([
    MODELS[0].id,
    MODELS[1].id,
  ]);
  const [question, setQuestion] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [responses, setResponses] = useState<Record<string, string | null>>({});
  const [evaluations, setEvaluations] = useState<
    Record<string, ModelEvaluation | null>
  >({});
  const [loading, setLoading] = useState(false);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);

  const [disabledModels, setDisabledModels] = useState<Set<string>>(new Set());
  const [railOpen, setRailOpen] = useState(true);
  const [modelsExpanded, setModelsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [loadedRunCreatedAt, setLoadedRunCreatedAt] = useState<string | null>(null);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<
    { name: string; content: string } | null
  >(null);
  const [attachedImage, setAttachedImage] = useState<
    { name: string; content: string } | null
  >(null);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const deleteRunQuestion = useMemo(
    () => history.find((h) => h.id === deleteRunId)?.question ?? "",
    [history, deleteRunId],
  );

  const activeModels = useMemo(
    () => selectedModels.filter((id) => !disabledModels.has(id)),
    [selectedModels, disabledModels],
  );

  const toggleModel = (id: string) => {
    setDisabledModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const activeCount = selectedModels.filter((m) => !next.has(m)).length;
        if (activeCount <= MIN_MODELS) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const hasResults = useMemo(
    () =>
      Object.values(responses).some((r) => r !== null) ||
      Object.values(evaluations).some((e) => e !== null),
    [responses, evaluations],
  );

  useEffect(() => {
    let cancelled = false;
    fetchArenaRuns()
      .then((runs) => {
        if (cancelled) return;
        setHistory(runs.map(toHistoryEntry));
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Couldn't load history.";
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function compareModels(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResponses({});
    setEvaluations({});
    setSubmittedQuestion(question);
    setLoadedRunCreatedAt(null);

    const contextParts: string[] = [];
    if (attachedFile) {
      contextParts.push(
        `Attached file "${attachedFile.name}":\n${attachedFile.content}`,
      );
    }
    if (attachedImage) {
      contextParts.push(
        `Attached image "${attachedImage.name}":\n${attachedImage.content}`,
      );
    }
    const context = contextParts.length ? contextParts.join("\n\n") : undefined;

    try {
      const result = await sendQuestionToCompareModels(
        activeModels,
        question,
        expectedOutput,
        context,
      );

      const nextResponses: Record<string, string | null> = {};
      const nextEvaluations: Record<string, ModelEvaluation | null> = {};
      for (const id of activeModels) {
        nextResponses[id] =
          result.responses.find((r) => r.model === id)?.response.content ??
          null;
        nextEvaluations[id] =
          result.comparison.find((c) => c.name === id) ?? null;
      }
      setResponses(nextResponses);
      setEvaluations(nextEvaluations);

      if (result.runId) {
        const newEntry: HistoryEntry = {
          id: result.runId,
          question,
          createdAt: new Date().toISOString(),
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, 50));
      }
    } catch (err) {
      toast.error(humanizeArenaError(err));
    } finally {
      setLoading(false);
    }
  }

  const newComparison = useCallback(() => {
    setQuestion("");
    setExpectedOutput("");
    setResponses({});
    setEvaluations({});
    setSubmittedQuestion(null);
    setLoadedRunCreatedAt(null);
    setAttachedFile(null);
    setAttachedImage(null);
  }, []);

  const changeModel = (index: number, newId: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(newId) && prev[index] !== newId) return prev;
      const next = [...prev];
      next[index] = newId;
      return next;
    });
  };

  const removeModel = (index: number) => {
    setSelectedModels((prev) => {
      if (prev.length <= MIN_MODELS) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const addModel = (id: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
  };

  // The appbar hosts the "New Comparison" button and dispatches this event.
  useEffect(() => {
    const handler = () => newComparison();
    window.addEventListener("compare-models:new", handler);
    return () => window.removeEventListener("compare-models:new", handler);
  }, [newComparison]);

  async function copyText(text: string, label = "response") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${label} to clipboard.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 pb-6">
      {/* Body shell: main column + optional right rail */}
      <div className="flex min-h-0 flex-1 gap-6">
        {/* Main column — white card per Figma */}
        <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden rounded-[20px] bg-bg-white p-6">
          {/* Scrollable content area (prompt + responses) */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {!hasResults && !loading && !submittedQuestion && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
                <Sparkles className="h-8 w-8 text-text-3" strokeWidth={1.5} />
                <h3 className="text-[16px] font-semibold text-text-1">
                  Compare models side by side
                </h3>
                <p className="max-w-[420px] text-[13px] text-text-2">
                  Pick models in the right rail, write a prompt and the
                  expected output, then hit Compare.
                </p>
              </div>
            )}

            {submittedQuestion && (
              <>
                {(loadedRunCreatedAt || hasResults) && (
                  <button
                    type="button"
                    onClick={newComparison}
                    className="inline-flex h-8 w-fit cursor-pointer items-center gap-2 self-start rounded-lg border border-border-2 bg-bg-white px-3 text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Comparison
                  </button>
                )}
                <PromptBubble
                  question={submittedQuestion}
                  onEdit={() => {
                    setQuestion(submittedQuestion);
                    setSubmittedQuestion(null);
                    setLoadedRunCreatedAt(null);
                  }}
                />
              </>
            )}

            {(loading || hasResults) && (
              <div className="flex flex-wrap gap-4">
                {activeModels.map((id) => (
                  <ResponseCard
                    key={id}
                    modelId={id}
                    response={responses[id] ?? null}
                    evaluation={evaluations[id] ?? null}
                    loading={loading && (responses[id] ?? null) === null}
                    onCopy={(t) => copyText(t, getModelLabel(id))}
                  />
                ))}
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
            activeModelCount={activeModels.length}
            onSubmit={compareModels}
            attachedFile={attachedFile}
            setAttachedFile={setAttachedFile}
            attachedImage={attachedImage}
            setAttachedImage={setAttachedImage}
            onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
          />
        </section>

        {/* Right rail */}
        {railOpen ? (
          <RightRail
            selectedModels={selectedModels}
            disabledModels={disabledModels}
            onToggleModel={toggleModel}
            onChangeModel={changeModel}
            onRemoveModel={removeModel}
            modelsExpanded={modelsExpanded}
            setModelsExpanded={setModelsExpanded}
            historyExpanded={historyExpanded}
            setHistoryExpanded={setHistoryExpanded}
            history={history}
            onDeleteHistory={(runId) => setDeleteRunId(runId)}
            onLoadHistory={(runId) => {
              fetchArenaRun(runId)
                .then((run) => {
                  setQuestion(run.question);
                  setExpectedOutput(run.expectedOutput);
                  setSelectedModels(run.models);
                  setDisabledModels(new Set());
                  setSubmittedQuestion(run.question);
                  setLoadedRunCreatedAt(run.createdAt);
                  const nextResponses: Record<string, string | null> = {};
                  const nextEvaluations: Record<string, ModelEvaluation | null> = {};
                  for (const id of run.models) {
                    nextResponses[id] =
                      run.responses.find((r) => r.model === id)?.response.content ??
                      null;
                    nextEvaluations[id] =
                      run.comparison.find((c) => c.name === id) ?? null;
                  }
                  setResponses(nextResponses);
                  setEvaluations(nextEvaluations);
                })
                .catch((err) => {
                  const message =
                    err instanceof Error ? err.message : "Couldn't load run.";
                  toast.error(message);
                });
            }}
            onClose={() => setRailOpen(false)}
            onAddModel={() => setAddModelOpen(true)}
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

      <AddModelDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        selectedModels={selectedModels}
        onAdd={(id) => {
          addModel(id);
          toast.success(`Added ${getModelLabel(id)} to comparison.`);
        }}
      />

      <PromptLibraryDialog
        open={promptLibraryOpen}
        onOpenChange={setPromptLibraryOpen}
        onInsert={(p) => {
          setQuestion((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${prev.replace(/\s+$/, "")}\n\n${p.body}` : p.body;
          });
          toast.success(`Inserted "${p.title}".`);
        }}
      />

      <Dialog
        open={deleteRunId !== null}
        onOpenChange={(open) => !open && setDeleteRunId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Comparison</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <strong>“{deleteRunQuestion}”</strong>? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteRunId(null)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const runId = deleteRunId;
                if (!runId) return;
                const previous = history;
                setHistory((prev) => prev.filter((h) => h.id !== runId));
                setDeleteRunId(null);
                deleteArenaRun(runId).catch((err) => {
                  setHistory(previous);
                  const message =
                    err instanceof Error ? err.message : "Couldn't delete run.";
                  toast.error(message);
                });
              }}
              className="cursor-pointer"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    <div className="flex items-start gap-3 rounded bg-bg-1 p-4">
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
  const provider = getModelProvider(modelId);

  return (
    <article className="flex min-w-0 flex-1 basis-[320px] flex-col gap-2.5 rounded bg-bg-1 p-4">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}
          >
            <Bot className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="truncate text-[14px] font-medium text-text-2">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {evaluation?.time !== undefined && (
            <span className="text-[11px] font-medium text-text-3">
              {(evaluation.time / 1000).toFixed(1)}s
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
                title="Model info"
                aria-label="Model info"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone}`}
                >
                  <Bot className="h-3 w-3" strokeWidth={2} />
                </span>
                <span className="truncate text-[13px] font-semibold text-text-1">
                  {label}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="flex flex-col gap-1.5 px-2 py-1.5 text-[11px]">
                <InfoRow label="Provider" value={provider} />
                <InfoRow label="Model ID" value={modelId} mono />
                <InfoRow label="Tier" value="Free" />
                {evaluation?.totalTokens !== undefined && (
                  <InfoRow label="Tokens" value={String(evaluation.totalTokens)} />
                )}
                {evaluation?.totalCost !== undefined && (
                  <InfoRow
                    label="Cost"
                    value={`$${Number(evaluation.totalCost).toFixed(5)}`}
                  />
                )}
                {evaluation?.time !== undefined && (
                  <InfoRow label="Time" value={`${evaluation.time} ms`} />
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
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

      {/* Footer actions */}
      <footer className="flex items-center justify-end border-t border-border-2 pt-2">
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

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-3">{label}</span>
      <span
        className={`truncate text-text-1 ${mono ? "font-mono text-[10px]" : "font-medium"}`}
        title={value}
      >
        {value}
      </span>
    </div>
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

const ATTACH_FILE_EXTENSIONS = [
  ".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".json", ".log",
  ".ts", ".tsx", ".js", ".jsx", ".py", ".html", ".css", ".yml", ".yaml",
  ".xml", ".sql", ".sh", ".rb", ".go", ".rs", ".java", ".c", ".cpp",
  ".h", ".hpp", ".toml", ".ini", ".env",
] as const;
const ATTACH_FILE_ACCEPT = ATTACH_FILE_EXTENSIONS.join(",");
const ATTACH_FILE_MAX_BYTES = 30 * 1024 * 1024;

const ATTACH_IMAGE_MIMETYPES = [
  "image/png", "image/jpeg", "image/webp", "image/gif",
] as const;
const ATTACH_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
const ATTACH_IMAGE_ACCEPT = ATTACH_IMAGE_MIMETYPES.join(",");
const ATTACH_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

type AttachKind = "file" | "image";

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

function describeFileType(file: File): string {
  const ext = fileExtension(file.name);
  if (ext) return ext;
  if (file.type) return `(${file.type})`;
  return "(no extension)";
}

const IMAGE_ALLOWED_LABEL = "PNG, JPG, JPEG, WebP, GIF";
const FILE_ALLOWED_LABEL =
  "PDF, DOCX, TXT, MD, MARKDOWN, CSV, JSON, LOG, TS, TSX, JS, JSX, PY, HTML, CSS, YML, YAML, XML, SQL, SH, RB, GO, RS, JAVA, C, CPP, H, HPP, TOML, INI, ENV";

function validateAttachment(file: File, kind: AttachKind): string | null {
  const ext = fileExtension(file.name);

  if (kind === "image") {
    // Extension-only check: some systems mis-report MIME (e.g. Windows maps
    // .jiff → image/jpeg), so trusting MIME would let unsupported formats through.
    if ((ATTACH_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return null;
    return `Image type ${describeFileType(file)} isn't allowed. Only ${IMAGE_ALLOWED_LABEL} are allowed.`;
  }

  if (!ext) {
    return `"${file.name}" has no file extension, so we can't tell its type. Only ${FILE_ALLOWED_LABEL} are allowed.`;
  }
  if ((ATTACH_FILE_EXTENSIONS as readonly string[]).includes(ext)) return null;
  return `File type ${ext} isn't allowed. Only ${FILE_ALLOWED_LABEL} are allowed.`;
}

function needsServerParse(file: File): boolean {
  const lower = file.name.toLowerCase();
  return (
    file.type === "application/pdf" ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type.startsWith("image/") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx")
  );
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function Composer({
  question,
  setQuestion,
  expectedOutput,
  setExpectedOutput,
  loading,
  activeModelCount,
  onSubmit,
  attachedFile,
  setAttachedFile,
  attachedImage,
  setAttachedImage,
  onOpenPromptLibrary,
}: {
  question: string;
  setQuestion: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  loading: boolean;
  activeModelCount: number;
  onSubmit: (e: React.FormEvent) => void;
  attachedFile: { name: string; content: string } | null;
  setAttachedFile: (f: { name: string; content: string } | null) => void;
  attachedImage: { name: string; content: string } | null;
  setAttachedImage: (f: { name: string; content: string } | null) => void;
  onOpenPromptLibrary: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  function handleInsertShortcut(shortcut: Shortcut) {
    const ta = questionRef.current;
    if (!ta) {
      const sep = question.trim() ? " " : "";
      setQuestion(question + sep + shortcut.body);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = question.slice(0, start);
    const after = question.slice(end);
    const hasSelection = start !== end;
    const insert = hasSelection
      ? shortcut.body
      : before.length > 0 && !/\s$/.test(before)
        ? ` ${shortcut.body}`
        : shortcut.body;
    const newValue = before + insert + after;
    const cursor = before.length + insert.length;
    setQuestion(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  async function ingestFile(
    file: File,
    kind: AttachKind,
    maxBytes: number,
    setTarget: (f: { name: string; content: string } | null) => void,
  ) {
    const validationError = validateAttachment(file, kind);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (file.size > maxBytes) {
      const limitMb = (maxBytes / 1024 / 1024).toFixed(0);
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      const target = kind === "image" ? "Images are" : "Attachments are";
      toast.error(
        `"${file.name}" is too large (${sizeMb} MB). ${target} capped at ${limitMb} MB.`,
      );
      return;
    }

    if (needsServerParse(file)) {
      const verb = isImageFile(file) ? "Reading" : "Parsing";
      const toastId = toast.loading(`${verb} ${file.name}…`);
      try {
        const parsed = await parseArenaAttachment(file);
        setTarget(parsed);
        toast.success(`Attached ${parsed.name}.`, { id: toastId });
      } catch (err) {
        toast.error(humanizeArenaError(err), { id: toastId });
      }
      return;
    }

    try {
      const content = await file.text();
      setTarget({ name: file.name, content });
    } catch (err) {
      toast.error(humanizeArenaError(err));
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await ingestFile(file, "file", ATTACH_FILE_MAX_BYTES, setAttachedFile);
  }

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await ingestFile(file, "image", ATTACH_IMAGE_MAX_BYTES, setAttachedImage);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full flex-col gap-2.5 rounded-[16px] bg-[#E5E6EB] p-2"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACH_FILE_ACCEPT}
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={imageInputRef}
        type="file"
        accept={ATTACH_IMAGE_ACCEPT}
        onChange={handleImageChange}
        className="hidden"
      />
      <div className="flex flex-col rounded-[16px] border border-[#86909C] bg-bg-white">
        {/* Input row */}
        <div className="flex items-start gap-2.5 px-4 py-3">
          <Image
            src="/main-logo.png"
            alt="WorkenAI"
            width={30}
            height={29}
            className="shrink-0"
          />
          <textarea
            ref={questionRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask me Anything"
            className="min-h-[72px] w-full resize-y border-0 bg-transparent text-[14px] font-normal leading-[18px] text-text-1 placeholder:text-text-2 focus:outline-none"
            disabled={loading}
          />
        </div>
        {/* Expected output (functional addition — not in Figma) */}
        <textarea
          value={expectedOutput}
          onChange={(e) => setExpectedOutput(e.target.value)}
          placeholder="Expected output (used to score the responses)"
          className="min-h-[24px] w-full resize-y border-t border-border-2 bg-transparent px-4 py-3 text-[14px] leading-[1.3] text-text-1 placeholder:text-text-2 focus:outline-none"
          disabled={loading}
        />
        {/* Attachment pills — one per slot, both can coexist */}
        {(attachedFile || attachedImage) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-2 px-4 py-2">
            {attachedFile && (
              <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-2 bg-bg-1 px-3 py-1.5 text-[13px] text-text-1">
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[320px] truncate" title={attachedFile.name}>
                  {attachedFile.name}
                </span>
                <span className="text-[11px] text-text-3">
                  {(attachedFile.content.length / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedFile(null)}
                  className="ml-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
                  title="Remove file"
                  aria-label="Remove file"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            {attachedImage && (
              <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border-2 bg-bg-1 px-3 py-1.5 text-[13px] text-text-1">
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[320px] truncate" title={attachedImage.name}>
                  {attachedImage.name}
                </span>
                <span className="text-[11px] text-text-3">
                  {(attachedImage.content.length / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="ml-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1"
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
        )}
        {/* Chips + actions row */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <ComposerChip
              icon={Paperclip}
              label="Attach File"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            />
            <ComposerChip
              icon={ImageIcon}
              label="Upload Image"
              onClick={() => imageInputRef.current?.click()}
              disabled={loading}
            />
            <ComposerChip
              icon={Library}
              label="Prompt Library"
              onClick={onOpenPromptLibrary}
              disabled={loading}
            />
            <ShortcutsPopover
              disabled={loading}
              onInsert={handleInsertShortcut}
            />
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              disabled
              className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-lg bg-bg-white text-primary-6 opacity-50"
              title="Voice input (coming soon)"
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={!question.trim() || !expectedOutput.trim() || loading || activeModelCount < MIN_MODELS}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-primary-6 text-white transition-colors hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-50"
              title={loading ? "Comparing…" : "Compare"}
              aria-label="Compare"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function ComposerChip({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Paperclip;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-2.5 rounded-lg border border-[#E5E6EB] bg-bg-white px-3 text-[14px] font-normal text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
      title={onClick ? label : "Coming soon"}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/* ─── Right rail ─────────────────────────────────────────────────────── */

function RightRail({
  selectedModels,
  disabledModels,
  onToggleModel,
  onChangeModel,
  onRemoveModel,
  modelsExpanded,
  setModelsExpanded,
  historyExpanded,
  setHistoryExpanded,
  history,
  onLoadHistory,
  onDeleteHistory,
  onClose,
  onAddModel,
}: {
  selectedModels: string[];
  disabledModels: Set<string>;
  onToggleModel: (id: string) => void;
  onChangeModel: (index: number, newId: string) => void;
  onRemoveModel: (index: number) => void;
  modelsExpanded: boolean;
  setModelsExpanded: (v: boolean) => void;
  historyExpanded: boolean;
  setHistoryExpanded: (v: boolean) => void;
  history: HistoryEntry[];
  onLoadHistory: (runId: string) => void;
  onDeleteHistory: (runId: string) => void;
  onClose: () => void;
  onAddModel: () => void;
}) {
  const canRemove = selectedModels.length > MIN_MODELS;
  const allModelIds = useMemo(() => MODELS.map((m) => m.id), []);
  const canAddMore = selectedModels.length < allModelIds.length;
  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-6 overflow-y-auto">
      <header className="flex items-center justify-between">
        <h2 className="text-[18px] font-bold leading-[1.3] text-text-2">
          Comparison Details
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
          title="Close"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Models section */}
      <RailSection
        title="Models"
        expanded={modelsExpanded}
        onToggle={() => setModelsExpanded(!modelsExpanded)}
      >
        {selectedModels.map((modelId, idx) => {
          const isEnabled = !disabledModels.has(modelId);
          const activeCount = selectedModels.filter(
            (id) => !disabledModels.has(id),
          ).length;
          return (
            <ModelPill
              key={modelId}
              slot={slotLabel(idx)}
              value={modelId}
              enabled={isEnabled}
              canDisable={!isEnabled || activeCount > MIN_MODELS}
              onToggle={() => onToggleModel(modelId)}
              onChange={(newId) => onChangeModel(idx, newId)}
              onRemove={canRemove ? () => onRemoveModel(idx) : undefined}
              disabledIds={selectedModels.filter((id) => id !== modelId)}
            />
          );
        })}
        <button
          type="button"
          onClick={onAddModel}
          disabled={!canAddMore}
          className="inline-flex h-8 w-fit cursor-pointer items-center gap-2.5 self-start rounded-lg border border-border-2 bg-bg-white px-3 text-[14px] font-normal text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            canAddMore
              ? "Add another model to the comparison"
              : "All available models are already in the comparison"
          }
        >
          <Plus className="h-4 w-4" />
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
          <p className="text-[13px] text-text-3">
            Your recent comparisons will appear here.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupHistoryByDate(history).map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <p className="text-[13px] font-normal text-text-2">{group.label}</p>
                <ul className="flex flex-col gap-2">
                  {group.items.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onLoadHistory(h.id)}
                        className="line-clamp-3 flex-1 cursor-pointer text-left text-[14px] leading-[1.4] text-text-1 transition-colors hover:text-primary-6"
                        title={h.question}
                      >
                        “{h.question}”
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteHistory(h.id)}
                        className="mt-0.5 shrink-0 cursor-pointer rounded p-1 text-text-3 transition-colors hover:bg-bg-1 hover:text-[#D92D20]"
                        title="Delete this comparison"
                        aria-label="Delete this comparison"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
        className="flex cursor-pointer items-center justify-between rounded text-left text-[16px] font-medium leading-[1.3] text-text-1 transition-colors hover:text-primary-6"
      >
        {title}
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {expanded && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}

function ModelPill({
  slot,
  value,
  enabled,
  canDisable,
  onToggle,
  onChange,
  onRemove,
  disabledIds,
}: {
  slot: string;
  value: string;
  enabled: boolean;
  canDisable: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  onRemove?: () => void;
  disabledIds: string[];
}) {
  const tone = getModelTone(value);
  const label = getModelLabel(value);

  const toggleButton = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}
      onClick={canDisable ? onToggle : undefined}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
        canDisable ? "cursor-pointer" : "cursor-not-allowed"
      } ${enabled ? "bg-primary-6" : "bg-text-3"}`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-bg-white transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );

  return (
    <div
      className={`flex items-center gap-2.5 rounded-[20px] bg-bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06),_0_1px_3px_rgba(0,0,0,0.1)] transition-opacity ${
        enabled ? "" : "opacity-50"
      }`}
    >
      {canDisable ? (
        toggleButton
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{toggleButton}</span>
          </TooltipTrigger>
          <TooltipContent>
            At least {MIN_MODELS} models must be active
          </TooltipContent>
        </Tooltip>
      )}

      {/* Avatar + name */}
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}
        title={`Model ${slot}`}
      >
        <Bot className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.3] text-text-1">
        {label}
      </span>

      {/* Swap menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-1 hover:text-text-1"
            title="Change model"
            aria-label="Change model"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Slot {slot}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MODELS.map((m) => {
            const isActive = m.id === value;
            const isOther = disabledIds.includes(m.id) && !isActive;
            return (
              <DropdownMenuItem
                key={m.id}
                disabled={isOther}
                onSelect={(e) => {
                  e.preventDefault();
                  if (!isOther) onChange(m.id);
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{m.label}</span>
                {isActive && (
                  <Check className="h-3.5 w-3.5 text-primary-6" />
                )}
              </DropdownMenuItem>
            );
          })}
          {onRemove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  onRemove();
                }}
                className="text-[#D92D20] focus:text-[#D92D20]"
              >
                Remove from comparison
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ─── Add Model dialog ───────────────────────────────────────────────── */

interface ProviderGroup {
  provider: string;
  models: typeof MODELS[number][];
}

function groupModelsByProvider(query: string): ProviderGroup[] {
  const q = query.trim().toLowerCase();
  const matched = MODELS.filter((m) => {
    if (!q) return true;
    return (
      m.label.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      getModelProvider(m.id).toLowerCase().includes(q)
    );
  });

  const map = new Map<string, typeof MODELS[number][]>();
  for (const m of matched) {
    const provider = getModelProvider(m.id);
    const existing = map.get(provider) ?? [];
    existing.push(m);
    map.set(provider, existing);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, models]) => ({ provider, models }));
}

function AddModelDialog({
  open,
  onOpenChange,
  selectedModels,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedModels: string[];
  onAdd: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  // Default selection points at the first model not already in the comparison.
  const firstAvailable = useMemo(
    () => MODELS.find((m) => !selectedModels.includes(m.id))?.id ?? MODELS[0].id,
    [selectedModels],
  );
  const [selectedId, setSelectedId] = useState<string>(firstAvailable);

  // Reset selection only on the false→true transition so the user's pick
  // isn't overwritten while the dialog is open.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedId(firstAvailable);
      setQuery("");
    }
    wasOpenRef.current = open;
  }, [open, firstAvailable]);

  const groups = useMemo(() => groupModelsByProvider(query), [query]);
  const selected = MODELS.find((m) => m.id === selectedId) ?? MODELS[0];
  const tone = getModelTone(selected.id);
  const alreadyInUse = selectedModels.includes(selected.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[900px] gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border-2 px-6 py-4">
          <DialogTitle className="text-[18px] font-bold text-text-1">
            Add Model
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="grid grid-cols-1 divide-x divide-border-2 sm:grid-cols-2">
          {/* List column */}
          <div className="flex max-h-[480px] flex-col gap-3 overflow-hidden p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Models"
                className="h-10 pl-9 placeholder:text-text-3"
              />
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
              {groups.length === 0 && (
                <p className="py-8 text-center text-[12px] text-text-3">
                  No models match your search.
                </p>
              )}
              {groups.map((g) => (
                <section key={g.provider} className="flex flex-col gap-1.5">
                  <h3 className="px-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                    {g.provider}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {g.models.map((m) => {
                      const isSelected = m.id === selectedId;
                      const inUse = selectedModels.includes(m.id);
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(m.id)}
                            className={`flex w-full cursor-pointer flex-col items-start rounded px-3 py-2 text-left transition-colors ${
                              isSelected
                                ? "bg-bg-1"
                                : "hover:bg-bg-1/60"
                            }`}
                          >
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="text-[13px] font-medium text-text-1">
                                {m.label}
                              </span>
                              {inUse && (
                                <span className="rounded bg-primary-6/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-6">
                                  In use
                                </span>
                              )}
                            </span>
                            <span className="truncate text-[11px] text-text-3">
                              {m.id}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          {/* Detail column */}
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}
              >
                <Bot className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-[15px] font-bold text-text-1">
                  {selected.label}
                </span>
                <span className="truncate text-[11px] text-text-3">
                  {selected.id}
                </span>
              </div>
            </div>

            <p className="text-[13px] leading-[1.5] text-text-2">
              Free tier model provided via OpenRouter. Used to compare answers
              against other models in the arena.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <SpecChip label="Provider" value={getModelProvider(selected.id)} />
              <SpecChip label="Tier" value="Free" />
              <SpecChip
                label="Status"
                value={alreadyInUse ? "In use" : "Available"}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-border-2 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-full px-5"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onAdd(selectedId);
              onOpenChange(false);
            }}
            disabled={alreadyInUse}
            className="cursor-pointer rounded-full bg-primary-6 px-6 hover:bg-primary-7"
            title={alreadyInUse ? "Model is already in the comparison" : undefined}
          >
            Add Model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SpecChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded bg-bg-1 px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-text-3">
        {label}
      </span>
      <span className="truncate text-[12px] font-semibold text-text-1">
        {value}
      </span>
    </div>
  );
}

/* ─── Prompt Library dialog ──────────────────────────────────────────── */

function PromptLibraryDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInsert: (p: PromptSummary) => void;
}) {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    fetchPrompts()
      .then((rows) => {
        setPrompts(rows);
        setLoaded(true);
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Couldn't load prompts.";
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [open, loaded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [prompts, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border-2 px-6 py-4">
          <DialogTitle className="text-[18px] font-bold text-text-1">
            Insert from Prompt Library
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your prompts"
              className="h-10 pl-9 placeholder:text-text-3"
            />
          </div>

          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
            {loading && !loaded ? (
              <p className="py-8 text-center text-[13px] text-text-3">
                Loading prompts…
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-text-3">
                {prompts.length === 0
                  ? "You haven't saved any prompts yet."
                  : "No prompts match your search."}
              </p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onInsert(p);
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer flex-col gap-1 rounded border border-border-2 bg-bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-6 hover:bg-bg-1/50"
                >
                  <span className="text-[13px] font-semibold text-text-1">
                    {p.title}
                  </span>
                  {p.description && (
                    <span className="line-clamp-2 text-[12px] text-text-2">
                      {p.description}
                    </span>
                  )}
                  {(p.category || p.tags.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {p.category && (
                        <span className="rounded bg-[#EBF8FF] px-2 py-0.5 text-[10px] font-medium text-text-2">
                          {p.category}
                        </span>
                      )}
                      {p.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded border border-border-2 bg-bg-white px-2 py-0.5 text-[10px] text-text-2"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          {prompts.length === 0 && !loading && (
            <a
              href="/resources/prompt-builder"
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded border border-border-2 bg-bg-white text-[13px] font-medium text-text-1 transition-colors hover:border-primary-6 hover:text-primary-6"
            >
              <Plus className="h-4 w-4" />
              Create your first prompt
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Shortcuts popover ──────────────────────────────────────────────── */

function ShortcutsPopover({
  disabled,
  onInsert,
}: {
  disabled?: boolean;
  onInsert: (s: Shortcut) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Shortcut[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchShortcuts()
      .then((rows) => setItems(rows))
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Couldn't load shortcuts.";
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q) ||
        (s.category?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex h-8 cursor-pointer items-center gap-2.5 rounded-lg border border-[#E5E6EB] bg-bg-white px-3 text-[14px] font-normal text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
          title="Insert a saved shortcut"
        >
          <LayoutGrid className="h-4 w-4" />
          Shortcuts
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[320px] p-0"
      >
        <div className="flex items-center gap-2 border-b border-border-2 px-3 py-2">
          <Search className="h-3.5 w-3.5 text-text-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts"
            className="h-7 w-full border-0 bg-transparent text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
            autoFocus
          />
        </div>
        <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1">
          {loading ? (
            <p className="py-6 text-center text-[12px] text-text-3">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-text-3">
              {items.length === 0
                ? "No shortcuts saved yet."
                : "No matches."}
            </p>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onInsert(s);
                  setOpen(false);
                }}
                className="flex cursor-pointer flex-col gap-0.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-1"
                title={s.body}
              >
                <span className="text-[13px] font-medium text-text-1">
                  {s.label}
                </span>
                <span className="line-clamp-1 text-[11px] text-text-3">
                  {s.body}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-border-2 p-1">
          <a
            href="/resources/shortcuts"
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-bg-1 hover:text-primary-6"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Manage shortcuts →
          </a>
        </div>
      </PopoverContent>
    </Popover>
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
