"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  LayoutGrid,
  Info,
  Library,
  Loader2,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Mic,
  Send,
  Sparkles,
  Square,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ModelCombobox } from "@/components/ui/model-combobox";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
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
import { Pagination } from "@/components/ui/pagination";
import { SkillsDialog } from "@/components/project-chat/skills-dialog";
import {
  deleteArenaRun,
  fetchArenaRun,
  fetchArenaRuns,
  fetchArenaJudgeDefault,
  fetchPrompts,
  fetchShortcuts,
  parseArenaAttachment,
  streamCompareModels,
  updateArenaRunFavorite,
  type ArenaRunSummary,
  type PromptSummary,
  type Shortcut,
} from "@/lib/api";
import { humanizeChatError } from "@/lib/chat-errors";
import { useUserModels } from "@/lib/hooks/use-user-models";
import type { AvailableModel } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";

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
  "liquid/lfm-2.5-1.2b-thinking:free": "bg-[#4338CA]/10 text-[#4338CA]",
};

// getModelLabel: each component that needs it calls useUserModels() and
// destructures `getLabel`. The hook shares a single React Query cache across
// the page so multiple calls don't refetch.

function getModelTone(id: string): string {
  return MODEL_COLORS[id] ?? "bg-bg-1 text-text-2";
}

function scoreBadgeTone(score: number): string {
  if (score >= 8) return "bg-success-1 text-success-7";
  if (score >= 5) return "bg-warning-1 text-warning-6";
  return "bg-danger-1 text-danger-6";
}

const MIN_MODELS = 2;
// Where the picked-model set is mirrored so revisits restore the
// last selection instead of resetting to the catalog's first two.
const ARENA_MODELS_STORAGE_KEY = "arena.selectedModels";
// Persisted judge-model choice. Empty string = "use the backend
// default" (ARENA_JUDGE_MODEL env / its built-in default).
const ARENA_JUDGE_STORAGE_KEY = "arena.judgeModel";

function slotLabel(index: number): string {
  // A, B, C, ... AA after Z. Plenty for our purposes.
  if (index < 26) return String.fromCharCode(65 + index);
  return `M${index + 1}`;
}

export default function CompareModelsPage() {
  const { t } = useLanguage();
  const {
    models: availableModels,
    isLoading: modelsLoading,
    isFetching: modelsFetching,
    getLabel: getModelLabel,
  } = useUserModels();
  // Persist the picked model set across navigation / reload via
  // localStorage. Server-render returns [] (no window), then the
  // first client effect rehydrates from storage if anything was
  // saved. Stale IDs (admin disabled the model since last visit)
  // are filtered out once the catalog loads.
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(ARENA_MODELS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  });

  // Drop any persisted IDs that are no longer in the catalog. Only
  // depends on availableModels so it runs exactly when the catalog
  // changes (avoids a feedback loop with the setter below).
  useEffect(() => {
    if (availableModels.length === 0) return;
    const validIds = new Set(availableModels.map((m) => m.id));
    setSelectedModels((prev) => {
      const cleaned = prev.filter((id) => validIds.has(id));
      return cleaned.length === prev.length ? prev : cleaned;
    });
     
  }, [availableModels]);

  // Seed the comparison with the first two enabled models once the
  // catalog loads AND nothing was restored from localStorage. The
  // seed runs as a separate effect so the restore-or-seed paths
  // share the same MIN_MODELS contract without duplicating logic.
  useEffect(() => {
    if (selectedModels.length === 0 && availableModels.length >= MIN_MODELS) {
      setSelectedModels([availableModels[0].id, availableModels[1].id]);
    }
  }, [availableModels, selectedModels.length]);

  // Mirror every change back to localStorage so the next mount
  // (re-navigation, refresh) restores the same selection. Skip the
  // empty state — that's the unseeded initial render and would
  // overwrite a still-good prior selection with [].
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedModels.length === 0) return;
    try {
      window.localStorage.setItem(
        ARENA_MODELS_STORAGE_KEY,
        JSON.stringify(selectedModels),
      );
    } catch {
      // Quota / privacy mode — non-fatal, just lose persistence.
    }
  }, [selectedModels]);
  const [question, setQuestion] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [responses, setResponses] = useState<Record<string, string | null>>({});
  const [evaluations, setEvaluations] = useState<
    Record<string, ModelEvaluation | null>
  >({});
  const [loading, setLoading] = useState(false);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  // Surfaces the evaluator-failed reason inline above the response
  // grid. The toast in compareModels() fires alongside this, but an
  // inline banner is harder to miss when you're focused on the
  // comparison cards. Cleared on every new run.
  const [evaluatorError, setEvaluatorError] = useState<string | null>(null);

  // Judge-model selection. "" = let the backend pick its default. The
  // judge (a hidden 3rd model that scores the answers) runs through the
  // caller's own key — its cost lands on the user's personal budget,
  // same as the compared models. Persisted across visits.
  const [selectedJudge, setSelectedJudge] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(ARENA_JUDGE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedJudge) {
        window.localStorage.setItem(ARENA_JUDGE_STORAGE_KEY, selectedJudge);
      } else {
        window.localStorage.removeItem(ARENA_JUDGE_STORAGE_KEY);
      }
    } catch {
      // Quota / privacy mode — non-fatal.
    }
  }, [selectedJudge]);
  // Drop a persisted judge id that's no longer in the catalog.
  useEffect(() => {
    if (!selectedJudge || availableModels.length === 0) return;
    if (!availableModels.some((m) => m.id === selectedJudge)) {
      setSelectedJudge("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels]);
  // The judge that actually scored the latest run (from the evaluation
  // event), plus whether it also graded its own answer. Drives the
  // "Evaluated by … · billed to your budget" note + self-judge warning.
  const [judgeInfo, setJudgeInfo] = useState<{
    model: string;
    selfJudge: boolean;
  } | null>(null);

  // Pre-flight / network-level failure that prevents the run from
  // even reaching per-panel streams (e.g. budget=0 → 402 from BE,
  // network down). Toast alone disappears after a few seconds; an
  // inline banner sticks around so the user knows what to fix.
  const [arenaError, setArenaError] = useState<string | null>(null);

  // Per-panel lifecycle state so each card can render an accurate
  // pre-stream / streaming / finished label. Derived state alone
  // (was buffer === ''?) couldn't distinguish "queued, waiting for
  // first token" from "model already streamed nothing back".
  type ModelStatus = "pending" | "streaming" | "done" | "error";
  const [modelStatuses, setModelStatuses] = useState<
    Record<string, ModelStatus>
  >({});
  // Per-panel actual model: set only when a fallback answered in place of the
  // picked model, so the card can show which model really responded.
  const [usedModels, setUsedModels] = useState<Record<string, string>>({});
  // The model whose answer the user marked as their favorite for this
  // comparison. Single-select — marking one clears the previous. Stays put
  // until cleared or a new comparison starts.
  const [favoriteModel, setFavoriteModel] = useState<string | null>(null);
  // The saved run id for the current comparison (set once the evaluator
  // persists the run, or when a history run is loaded). When present, the
  // "best answer" pick is persisted to the DB so it survives reload.
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  // Mirror of favoriteModel for reads inside the streaming closure (which
  // captures a stale value): lets the evaluation handler flush a pick the
  // user made mid-stream once the run id finally lands.
  const favoriteModelRef = useRef<string | null>(null);
  useEffect(() => {
    favoriteModelRef.current = favoriteModel;
  }, [favoriteModel]);

  // Top-level evaluator phase. After all panels reach done/error
  // the BE moves on to running the comparison eval — the FE has no
  // explicit "evaluator started" event, so we infer the running
  // state from the per-panel statuses + absence of an evaluation
  // event so far.
  type EvaluatorStatus = "idle" | "waiting" | "running" | "done" | "error";
  const [evaluatorStatus, setEvaluatorStatus] = useState<EvaluatorStatus>(
    "idle",
  );

  // AbortController for the in-flight arena fan-out. Drives the
  // Stop button in the composer; abort propagates through fetch →
  // BE req.close → every model stream cancels at once.
  const arenaAbortRef = useRef<AbortController | null>(null);
  // Wall-clock of the last Stop click. Used as a cooldown guard in
  // compareModels — Stop's click sometimes fires the form's
  // onSubmit a beat later (React re-renders Stop → Send mid-event;
  // browser dispatches the synthetic submit to the newly-rendered
  // Send button at the same DOM position). Without this guard, the
  // form would re-submit and reset every panel back to "Waiting to
  // start…". 200ms is plenty for the re-render race; intentional
  // clicks come well after.
  const lastStopAtRef = useRef<number>(0);
  const handleStopArena = () => {
    lastStopAtRef.current = Date.now();
    arenaAbortRef.current?.abort();
  };

  const [disabledModels, setDisabledModels] = useState<Set<string>>(new Set());
  const [railOpen, setRailOpen] = useState(true);
  // Separate state so the mobile drawer doesn't leak into the desktop
  // inline rail when crossing the md breakpoint. The 3-dot button in
  // the mobile header is the only path that flips it.
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [modelsExpanded, setModelsExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [loadedRunCreatedAt, setLoadedRunCreatedAt] = useState<string | null>(null);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<
    { name: string; content: string } | null
  >(null);
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Skills pinned for this comparison — injected into every panel's context.
  const [pinnedSkillIds, setPinnedSkillIds] = useState<string[]>([]);
  const deleteRunQuestion = useMemo(
    () => history.find((h) => h.id === deleteRunId)?.question ?? "",
    [history, deleteRunId],
  );

  const activeModels = useMemo(
    () => selectedModels.filter((id) => !disabledModels.has(id)),
    [selectedModels, disabledModels],
  );

  // At <md the response grid collapses to a single visible card with
  // a tab strip on top — phone viewports can't fit two cards side by
  // side at a readable line length. Active tab defaults to the first
  // model and follows the user-selected list as they add/remove
  // models (e.g. dropping the currently active one falls back to the
  // first available).
  const [mobileActiveModel, setMobileActiveModel] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (activeModels.length === 0) {
      setMobileActiveModel(null);
      return;
    }
    if (!mobileActiveModel || !activeModels.includes(mobileActiveModel)) {
      setMobileActiveModel(activeModels[0]);
    }
  }, [activeModels, mobileActiveModel]);

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
          err instanceof Error ? err.message : t("compareModels.toastLoadHistoryFailed");
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function compareModels(e: React.FormEvent) {
    e.preventDefault();
    // Belt-and-braces guard against double-submission: if a run is
    // already in flight, ignore the second submit. The Send button
    // is replaced by Stop during loading, so this only fires when
    // an event somehow slipped through (synthetic event quirks,
    // Enter-key on a stale form, devtools, …).
    if (loading) return;
    // Cooldown after a Stop click. React tears down the Stop button
    // and renders Send at the same DOM coordinates while the user's
    // click is still being dispatched — the browser ends up firing
    // submit on the freshly-rendered Send button. Drop those submits
    // for 200ms after Stop so they don't visibly re-launch the run.
    if (Date.now() - lastStopAtRef.current < 200) return;
    setLoading(true);
    // Reset to empty-string per panel so the streaming loop can
    // append into each model's slot without first checking null.
    // Errors flip the panel back to null below.
    const initialResponses: Record<string, string | null> = {};
    for (const id of activeModels) initialResponses[id] = "";
    setResponses(initialResponses);
    setEvaluations({});
    setEvaluatorError(null);
    setJudgeInfo(null);
    setArenaError(null);
    setSubmittedQuestion(question);
    setLoadedRunCreatedAt(null);

    // Every panel starts in "pending" — no tokens yet. First
    // model-delta flips it to "streaming"; model-done/-error settle
    // it. Evaluator stays "waiting" until all panels settle.
    const initialStatuses: Record<string, ModelStatus> = {};
    for (const id of activeModels) initialStatuses[id] = "pending";
    setModelStatuses(initialStatuses);
    setEvaluatorStatus("waiting");

    const contextParts: string[] = [];
    if (attachedFile) {
      contextParts.push(
        `Attached file "${attachedFile.name}":\n${attachedFile.content}`,
      );
    }
    const context = contextParts.length ? contextParts.join("\n\n") : undefined;

    // Local accumulators that the setState calls below mirror onto
    // React state. Direct dict so we don't pay re-render cost on
    // every token (we batch each call into one setResponses).
    const buffers: Record<string, string> = {};
    for (const id of activeModels) buffers[id] = "";

    // Per-run AbortController so the Stop button can cancel the
    // whole fan-out. fetch signal → BE req.close → every in-flight
    // upstream call aborts. The catch below distinguishes user-
    // initiated stop from real errors.
    const controller = new AbortController();
    arenaAbortRef.current = controller;

    try {
      // Arena always bills against the user's Personal Monthly Budget.
      // Team / company budget routing was intentionally removed —
      // every arena run is metered against `user.monthlyBudgetCents`.
      for await (const event of streamCompareModels(
        activeModels,
        question,
        expectedOutput,
        context,
        controller.signal,
        // Empty string → backend default judge model.
        selectedJudge || undefined,
        pinnedSkillIds,
      )) {
        // Defensive: if the user pressed Stop, the abort signal is
        // set but BE-side bytes already on the wire still surface
        // here as model-delta events. Processing them would
        // re-flip panels back to "streaming" and look like the
        // run had restarted. Bail into the catch with a synthetic
        // AbortError to take the standard cleanup path.
        if (controller.signal.aborted) {
          throw new DOMException("Aborted by user", "AbortError");
        }
        if (event.type === "model-delta") {
          // Flip status to "streaming" on the first byte. Subsequent
          // deltas keep it streaming; functional update so we don't
          // race with another panel's status transition.
          setModelStatuses((prev) =>
            prev[event.model] === "streaming"
              ? prev
              : { ...prev, [event.model]: "streaming" },
          );
          buffers[event.model] = (buffers[event.model] ?? "") + event.text;
          setResponses((prev) => ({
            ...prev,
            [event.model]: buffers[event.model],
          }));
        } else if (event.type === "model-fallback") {
          // The picked model was dead/unavailable; a configured fallback
          // answered instead. Record it so the panel shows the real model.
          setUsedModels((prev) => ({
            ...prev,
            [event.model]: event.usedModel,
          }));
        } else if (event.type === "model-replace") {
          // Per-model output guardrail fix-rule pass; swap the
          // panel's visible text for the redacted version.
          buffers[event.model] = event.text;
          setResponses((prev) => ({
            ...prev,
            [event.model]: event.text,
          }));
        } else if (event.type === "model-error") {
          // Only this panel fails; the rest keep streaming. Show
          // humanized message inside the panel so the user can see
          // which model went wrong and why.
          const errMessage = humanizeChatError(
            new Error(
              event.status
                ? `${event.status}: ${event.message}`
                : event.message,
            ),
          );
          buffers[event.model] = errMessage;
          setResponses((prev) => ({
            ...prev,
            [event.model]: errMessage,
          }));
          setModelStatuses((prev) => {
            const next = { ...prev, [event.model]: "error" as ModelStatus };
            // If this was the last unsettled panel AND at least one
            // panel actually succeeded, the BE evaluator is about
            // to start running. When EVERY panel errored (e.g.
            // budget gate hit all of them), the BE skips the
            // evaluator entirely — flashing "Scoring responses…"
            // would be misleading.
            const allSettled = activeModels.every(
              (id) => next[id] === "done" || next[id] === "error",
            );
            const anySuccess = activeModels.some(
              (id) => next[id] === "done",
            );
            if (allSettled) {
              setEvaluatorStatus(anySuccess ? "running" : "idle");
            }
            return next;
          });
        } else if (event.type === "model-done") {
          // Belt-and-suspenders: also capture the used model from the final
          // event in case the fallback notice was missed.
          if (event.usedModel && event.usedModel !== event.model) {
            const used = event.usedModel;
            setUsedModels((prev) => ({ ...prev, [event.model]: used }));
          }
          // Per-model totals arrive here. We don't surface them
          // outside the evaluation card below today; the BE
          // already records observability events. Settle the
          // panel's status and check whether the evaluator phase
          // should start on the FE — the BE has no explicit
          // "evaluator started" event so we infer it from "all
          // panels are settled".
          setModelStatuses((prev) => {
            const next = { ...prev, [event.model]: "done" as ModelStatus };
            const allSettled = activeModels.every(
              (id) => next[id] === "done" || next[id] === "error",
            );
            // Mirror the model-error branch above: only enter the
            // "Scoring responses…" state when at least one panel
            // actually has a successful answer for the evaluator
            // to grade. This `done` branch should always have
            // anySuccess = true (we got here because a panel
            // succeeded), but guard anyway for parity.
            const anySuccess = activeModels.some(
              (id) => next[id] === "done",
            );
            if (allSettled) {
              setEvaluatorStatus(anySuccess ? "running" : "idle");
            }
            return next;
          });
        } else if (event.type === "evaluation") {
          // Evaluator ran post-fan-out — paint the score cards.
          // If every retry failed, BE surfaces the reason in
          // `error`; show it as a toast so the user knows the
          // visible answers are real but the comparison didn't
          // make it through (likely :free-tier rate limit on the
          // evaluator model).
          if (event.error) {
            setEvaluatorError(event.error);
            setEvaluatorStatus("error");
            toast.error(
              t("compareModels.toastScoreFailed").replace("{error}", event.error),
            );
          } else {
            setEvaluatorStatus("done");
          }
          // Record which judge scored this run (+ self-judge bias flag)
          // so the UI can label the evaluator and its billing note.
          // Only on success — showing "Evaluated by X" next to the
          // "Couldn't score" banner would contradict itself.
          if (event.judgeModel && !event.error) {
            setJudgeInfo({
              model: event.judgeModel,
              selfJudge: !!event.selfJudge,
            });
          } else {
            setJudgeInfo(null);
          }
          const nextEvaluations: Record<string, ModelEvaluation | null> =
            {};
          for (const id of activeModels) {
            const item = event.comparisonItems.find((c) => c.name === id);
            nextEvaluations[id] = item ?? null;
          }
          setEvaluations(nextEvaluations);
          if (event.runId) {
            const runId = event.runId;
            const newEntry: HistoryEntry = {
              id: runId,
              question,
              createdAt: new Date().toISOString(),
            };
            setHistory((prev) => [newEntry, ...prev].slice(0, 50));
            setCurrentRunId(runId);
            // Persist a "best answer" the user may have marked before the run
            // was saved (the toggle couldn't reach the DB without a run id).
            if (favoriteModelRef.current) {
              void updateArenaRunFavorite(
                runId,
                favoriteModelRef.current,
              ).catch(() => {});
            }
          }
        }
        // `done` event is a noop — loop exits naturally after it.
      }
    } catch (err) {
      // AbortError → user pressed Stop. Don't surface as toast
      // error; instead mark every panel that hadn't settled yet as
      // stopped, and roll the evaluator status back so the FE
      // doesn't sit on "Scoring responses…" forever.
      const isAbort =
        err instanceof DOMException && err.name === "AbortError";
      if (isAbort) {
        toast.info(t("compareModels.toastStopped"));
        setModelStatuses((prev) => {
          const next = { ...prev };
          for (const id of activeModels) {
            if (next[id] === "pending" || next[id] === "streaming") {
              next[id] = "done";
            }
          }
          return next;
        });
        setEvaluatorStatus("idle");
      } else {
        const humanized = humanizeChatError(err);
        toast.error(humanized);
        // Inline banner so the message persists once the toast
        // fades — especially important for soft errors like
        // pending budget approval where the user needs the text
        // long enough to act on it (open Management → Users).
        setArenaError(humanized);
      }
    } finally {
      arenaAbortRef.current = null;
      setLoading(false);
    }
  }

  const newComparison = useCallback(() => {
    // Cancel any in-flight fan-out — the back-arrow doubles as the escape hatch
    // now that the composer (and its Stop button) is hidden while a run shows.
    arenaAbortRef.current?.abort();
    setQuestion("");
    setExpectedOutput("");
    setResponses({});
    setUsedModels({});
    setFavoriteModel(null);
    setEvaluations({});
    setEvaluatorError(null);
    setJudgeInfo(null);
    setArenaError(null);
    setModelStatuses({});
    setEvaluatorStatus("idle");
    setSubmittedQuestion(null);
    setLoadedRunCreatedAt(null);
    setCurrentRunId(null);
    setAttachedFile(null);
  }, []);

  // Toggle the "best answer" pick (single-select). Persists to the saved run
  // when one already exists; otherwise it's persisted once the run is saved
  // (the evaluation handler flushes the pending pick).
  const toggleFavorite = useCallback(
    (modelId: string) => {
      setFavoriteModel((prev) => {
        const next = prev === modelId ? null : modelId;
        if (currentRunId) {
          void updateArenaRunFavorite(currentRunId, next).catch(() => {
            toast.error(t("compareModels.toastSaveFavoriteFailed"));
          });
        }
        return next;
      });
    },
    [currentRunId, t],
  );

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

  // Mirror the "viewing a comparison" state to the appbar so it can render a
  // back-arrow (left of the title) that returns to the composer — replaces the
  // in-card "Back to Comparison" button. Same window-event channel the appbar
  // already uses for its actions. The dispatch only flips post-mount (initial
  // state has no submitted question), so the appbar's listener is always
  // attached before the first `true` lands.
  // Base this on panel status, NOT hasResults: on submit every panel's
  // response slot is seeded with "" (so the streaming loop can append), which
  // makes hasResults true instantly and would hide the composer — and its Stop
  // button — during the pending phase. modelStatuses starts all "pending" and
  // only leaves it once a panel actually streams/settles, so the composer
  // stays put until the run is genuinely under way.
  const arenaViewing =
    !!submittedQuestion &&
    (!!loadedRunCreatedAt ||
      Object.values(modelStatuses).some((s) => s !== "pending"));
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("compare-models:viewing", { detail: arenaViewing }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("compare-models:viewing", { detail: false }),
      );
    };
  }, [arenaViewing]);

  /**
   * Hydrate the composer + panels from a saved arena run. Called
   * from the history rail and from the `?run=<id>` deep-link
   * effect below so the same path runs whether the user clicked
   * History or arrived from the dashboard. Pops the rail open so
   * the loaded run is visible in context.
   */
  const loadHistoryRun = useCallback(
    (runId: string) => {
      fetchArenaRun(runId)
        .then((run) => {
          setQuestion(run.question);
          setExpectedOutput(run.expectedOutput);
          setSelectedModels(run.models);
          setDisabledModels(new Set());
          setSubmittedQuestion(run.question);
          setLoadedRunCreatedAt(run.createdAt);
          // Restore the saved "best answer" pick and bind to this run so
          // toggling persists straight back to it.
          setCurrentRunId(run.id);
          setFavoriteModel(run.favoriteModel ?? null);
          const nextResponses: Record<string, string | null> = {};
          const nextEvaluations: Record<string, ModelEvaluation | null> = {};
          const nextStatuses: Record<string, ModelStatus> = {};
          for (const id of run.models) {
            nextResponses[id] =
              run.responses.find((r) => r.model === id)?.response.content ??
              null;
            nextEvaluations[id] =
              run.comparison.find((c) => c.name === id) ?? null;
            // Historical runs were already completed — mark every
            // panel done so the body renders content (not the
            // "Waiting…" placeholder) on load.
            nextStatuses[id] = "done";
          }
          setResponses(nextResponses);
          setEvaluations(nextEvaluations);
          setModelStatuses(nextStatuses);
          setEvaluatorStatus(run.comparison.length > 0 ? "done" : "idle");
          setEvaluatorError(null);
          setJudgeInfo(
            run.judgeModel && run.comparison.length > 0
              ? {
                  model: run.judgeModel,
                  selfJudge: run.models.includes(run.judgeModel),
                }
              : null,
          );
          // Surface the loaded run in the history rail so users see
          // it highlighted alongside the other entries.
          setRailOpen(true);
          setHistoryExpanded(true);
        })
        .catch((err) => {
          const message =
            err instanceof Error ? err.message : t("compareModels.toastLoadRunFailed");
          toast.error(message);
        });
    },
    [t],
  );

  // Deep-link support: clicking a card on the dashboard opens
  // /compare-models?run=<id> — auto-load that run, then scrub the
  // param so a refresh doesn't re-trigger and so the URL reads as
  // the canonical /compare-models again.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const runId = searchParams.get("run");
    if (!runId) return;
    loadHistoryRun(runId);
    router.replace(pathname, { scroll: false });
    // We deliberately omit `loadHistoryRun` etc from deps — the
    // effect should fire once per URL change, not on render-time
    // reference churn. router/pathname are stable per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function copyText(text: string, label?: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        t("compareModels.toastCopied").replace(
          "{label}",
          label ?? t("compareModels.copyLabelResponse"),
        ),
      );
    } catch {
      toast.error(t("compareModels.toastCopyFailed"));
    }
  }

  // Gate: arena needs at least MIN_MODELS active aliases under
  // Management → Models. Without that we can't even seed the comparison,
  // and silently rendering an empty rail looks broken.
  //
  // Wait for BOTH the initial load AND any in-flight background refetch
  // before deciding the user really has no models. A model mutation
  // elsewhere runs invalidateModelMutations(), which force-refetches
  // our ["models", "effective"] query even while this page is
  // unmounted. On navigating back, that refetch may still be in flight
  // over a stale cached `[]` — `isLoading` reports false because there
  // IS cached data, so without the `isFetching` gate the empty state
  // flashes before the real list lands.
  if (!modelsLoading && !modelsFetching && availableModels.length < MIN_MODELS) {
    return (
      <div className="flex h-0 min-h-0 flex-1 items-center justify-center pb-6">
        <div className="flex max-w-[480px] flex-col items-center gap-4 rounded-[20px] bg-bg-white p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-1">
            <LayoutGrid className="h-6 w-6 text-primary-7" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-[18px] font-bold text-text-1">
              {t("arena.addModels")}
            </h3>
            <p className="text-[14px] text-text-2">
              {t("teams.models")}
            </p>
          </div>
          <Link
            href="/teams?tab=models"
            className="inline-flex h-10 items-center rounded-lg bg-primary-6 px-5 text-[14px] font-medium text-white transition-colors hover:bg-primary-7"
          >
            {t("arena.manageModels")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    // Natural height: the page grows with its content and the app shell's
    // own scroll container (layout.tsx → the `overflow-y-auto` wrapper
    // around {children}) handles scrolling at page level. We deliberately
    // do NOT claim a fixed shell height here, so the comparison card never
    // traps content in an inner scrollbar.
    <div className="flex flex-col gap-3 lg:gap-6 pb-3 lg:pb-6">
      {/* Mobile in-page header — the desktop appbar (default variant)
          renders the "Model Arena" title + the "New Comparison"
          appbarAction. At <md the appbar collapses to MobileTopbar
          (logo + hamburger only), so the page owns this slot itself
          per Figma frame 4659:70093 — back arrow, title, "New" button,
          and a placeholder 3-dot menu. */}
      <div className="lg:hidden -mx-6 flex items-center justify-between gap-3 border-b border-bg-1 bg-bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            aria-label={t("arena.back")}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border-2 bg-bg-white text-text-2 hover:text-text-1"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="truncate text-[20px] font-bold text-text-1">
            {t("arena.title")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={newComparison}
            className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-primary-6 px-3 text-[14px] font-medium text-white hover:bg-primary-7"
          >
            <Plus className="h-4 w-4" />
            {t("arena.new")}
          </button>
          <button
            type="button"
            onClick={() => setMobileRailOpen(true)}
            aria-label={t("arena.comparisonDetails")}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border-2 bg-bg-white text-text-2 hover:text-text-1"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body shell: main column + optional right rail. CSS Grid at lg+
          keeps the two columns side by side; rows are auto-height
          (items-start) so each column grows with its content and the page
          — not an inner box — handles scrolling. */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6 lg:items-start">
        {/* Main column — white card per Figma. Height is content-driven:
            the card grows with the responses/composer and the page scrolls,
            rather than the content scrolling inside a fixed-height box. */}
        <section className="flex min-w-0 flex-col gap-3 rounded-xl bg-bg-white p-3 lg:gap-4 lg:rounded-[20px] lg:p-6">
          <div className="flex flex-col gap-3 lg:gap-4">
            {!hasResults && !loading && !submittedQuestion && (
              // `my-auto` keeps the placeholder vertically centred inside
              // the scrollable area without changing the area's flex
              // sizing — so the composer below it stays put and the
              // white card never reflows when state changes.
              <div className="mx-auto my-auto flex w-full max-w-[480px] flex-col items-center gap-2 py-10 text-center">
                <Sparkles className="h-8 w-8 text-text-3" strokeWidth={1.5} />
                <h3 className="text-[16px] font-semibold text-text-1">
                  {t("arena.compareTitle")}
                </h3>
                <p className="max-w-[420px] text-[13px] text-text-2">
                  {t("arena.compareDesc")}
                </p>
              </div>
            )}

            {submittedQuestion && (
              <PromptBubble
                question={submittedQuestion}
              />
            )}

            {/* Pre-flight / run-level error banner — fires when the
                run never reached the per-panel stream (e.g. budget
                gate 402 from the BE before any model could start).
                Sticks around past the toast so the user can act on
                it. Cleared on the next submit / "New comparison". */}
            {arenaError && (
              <div className="mb-3 flex items-start gap-3 rounded-lg border border-warning-2 bg-warning-1/40 px-4 py-3">
                <AlertTriangle
                  className="h-5 w-5 shrink-0 text-warning-7 mt-0.5"
                  strokeWidth={2}
                />
                <div className="text-[13px] leading-relaxed text-text-2">
                  <p className="font-semibold text-text-1">
                    {t("arena.comparisonDidntRun")}
                  </p>
                  <p className="text-text-3">{arenaError}</p>
                </div>
              </div>
            )}

            {/* "Scoring responses…" banner. Shows after every panel
                has settled (done/error) but before the evaluation
                event arrives. The evaluator runs server-side and
                can take 5-15s on the :free-tier nemotron, so without
                this banner the user sees stale "done" cards and
                wonders why scores haven't appeared. */}
            {evaluatorStatus === "running" && (
              <div className="mb-3 flex items-center gap-3 rounded-lg border border-primary-2 bg-primary-1/30 px-4 py-3">
                <Loader2
                  className="h-5 w-5 shrink-0 animate-spin text-primary-7"
                  strokeWidth={2}
                />
                <div className="text-[13px] leading-relaxed text-text-2">
                  <p className="font-semibold text-text-1">
                    {t("arena.scoringResponses")}
                  </p>
                  <p className="text-text-3">
                    {t("arena.allFinished")}
                  </p>
                </div>
              </div>
            )}

            {/* Inline evaluator-failure banner — sits above the
                response grid so it's unmissable. Fires only after
                the stream resolves with an evaluator error set;
                clears on every new run. */}
            {evaluatorError && (
              <div className="mb-3 flex items-start gap-3 rounded-lg border border-warning-2 bg-warning-1/40 px-4 py-3">
                <AlertTriangle
                  className="h-5 w-5 shrink-0 text-warning-7 mt-0.5"
                  strokeWidth={2}
                />
                <div className="text-[13px] leading-relaxed text-text-2">
                  <p className="font-semibold text-text-1">
                    {t("arena.couldntScore")}
                  </p>
                  <p className="text-text-3">
                    {t("arena.rerunHint").replace("{error}", evaluatorError)}
                  </p>
                </div>
              </div>
            )}

            {/* Who scored this run + where the evaluation cost lands.
                The judge is a hidden 3rd model; its cost bills the same
                personal budget as the compared models. */}
            {judgeInfo && (
              <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-border-2 bg-bg-1 px-4 py-2.5 text-[12px] leading-relaxed text-text-3">
                <Sparkles className="h-4 w-4 shrink-0 text-primary-6 mt-0.5" />
                <div>
                  <span className="text-text-2">
                    {t("arena.evaluatedBy").replace(
                      "{model}",
                      getModelLabel(judgeInfo.model),
                    )}
                  </span>{" "}
                  <span>{t("arena.judgeCostNote")}</span>
                  {judgeInfo.selfJudge && (
                    <span className="mt-1 flex items-center gap-1.5 text-warning-7">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {t("arena.selfJudgeWarning")}
                    </span>
                  )}
                </div>
              </div>
            )}

            {(loading || hasResults) && (
              <>
                {/* Mobile tabs (<md) — pick which model's response to
                    look at. Active tab gets a blue underline + bold
                    text per Figma 4659:70101. Single tab? Skip the
                    strip entirely; the single card carries enough
                    identity on its own via ResponseCard's header. */}
                {activeModels.length > 1 && (
                  <div className="lg:hidden -mx-3 flex items-stretch overflow-x-auto border-b border-border-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    {activeModels.map((id) => {
                      const isActive = mobileActiveModel === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setMobileActiveModel(id)}
                          className={`relative flex shrink-0 cursor-pointer items-center gap-1.5 px-4 py-3 text-[12px] font-medium transition-colors ${
                            isActive
                              ? "text-text-1"
                              : "text-text-3 hover:text-text-2"
                          }`}
                        >
                          {getModelLabel(id)}
                          {isActive && (
                            <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary-6" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Desktop grid — up to 3 cards per row, each 1/3 of
                    the available width. 4th+ wrap to the next row at
                    the same 1/3 width so a single comparison never
                    silently widens its cards just because the row is
                    half-empty. With 1 or 2 cards we still cap columns
                    at the active count so they fill the row evenly
                    (full / half). */}
                <div
                  className="hidden lg:grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(
                      Math.max(activeModels.length, 1),
                      3,
                    )}, minmax(0, 1fr))`,
                  }}
                >
                  {activeModels.map((id) => (
                    <ResponseCard
                      key={id}
                      modelId={id}
                      usedModel={usedModels[id]}
                      response={responses[id] ?? null}
                      evaluation={evaluations[id] ?? null}
                      status={modelStatuses[id] ?? (loading ? "pending" : "done")}
                      isFavorite={favoriteModel === id}
                      onToggleFavorite={() => toggleFavorite(id)}
                      onCopy={(text) => copyText(text, getModelLabel(id))}
                    />
                  ))}
                </div>

                {/* Mobile single-card view — render only the active
                    tab's ResponseCard. Same component, same data, just
                    one at a time. */}
                <div className="lg:hidden flex flex-col gap-3">
                  {activeModels
                    .filter((id) =>
                      mobileActiveModel ? id === mobileActiveModel : true,
                    )
                    .map((id) => (
                      <ResponseCard
                        key={id}
                        modelId={id}
                        usedModel={usedModels[id]}
                        response={responses[id] ?? null}
                        evaluation={evaluations[id] ?? null}
                        status={modelStatuses[id] ?? (loading ? "pending" : "done")}
                        isFavorite={favoriteModel === id}
                        onToggleFavorite={() => toggleFavorite(id)}
                        onCopy={(text) => copyText(text, getModelLabel(id))}
                      />
                    ))}
                </div>
              </>
            )}
          </div>

          {/* Composer (anchored at bottom). Hidden once a comparison is on
              screen — the results take over the card and the appbar back-arrow
              returns here. Still shown during the initial streaming (before any
              result lands) so its Stop button stays reachable. */}
          {!arenaViewing && (
            <Composer
              question={question}
              setQuestion={setQuestion}
              expectedOutput={expectedOutput}
              setExpectedOutput={setExpectedOutput}
              loading={loading}
              activeModelCount={activeModels.length}
              onSubmit={compareModels}
              onStop={handleStopArena}
              attachedFile={attachedFile}
              setAttachedFile={setAttachedFile}
              onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
              onOpenSkills={() => setSkillsOpen(true)}
              pinnedSkillCount={pinnedSkillIds.length}
            />
          )}
        </section>

        {/* Right rail — hidden at <md: the rail's controls (model
            pickers, history, ...) would crowd a 375px viewport, and
            the in-page mobile header already owns the "New" action.
            Re-introduce as a slide-out Sheet in a follow-up if mobile
            users need history access without scrolling sideways. */}
        {railOpen ? (
          <div className="hidden lg:flex">
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
              onLoadHistory={loadHistoryRun}
              onClose={() => setRailOpen(false)}
              onAddModel={() => setAddModelOpen(true)}
              selectedJudge={selectedJudge}
              onChangeJudge={setSelectedJudge}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="hidden lg:flex self-start cursor-pointer rounded-lg border border-border-2 bg-bg-white p-2 text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            title={t("arena.comparisonDetails")}
            aria-label={t("arena.comparisonDetails")}
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
          </button>
        )}
      </div>

      {/* Mobile Comparison Details drawer — same RightRail content,
          but slid in from the right via a Sheet at <md. Opened from
          the 3-dot button in the page-level mobile header. Auto-close
          on every callback so picking a history entry / adding a
          model dismisses the drawer and returns the user to the
          response view without an extra tap. */}
      <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
        <SheetContent
          side="right"
          className="w-[320px] sm:w-[360px] p-5 lg:hidden"
        >
          {/* hideClose: Sheet ships its own X in the corner — the
              rail's local close button would stack on top of it. */}
          <RightRail
            className="flex h-full flex-col gap-6 overflow-y-auto pr-1"
            hideClose
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
              loadHistoryRun(runId);
              setMobileRailOpen(false);
            }}
            onClose={() => setMobileRailOpen(false)}
            onAddModel={() => {
              setAddModelOpen(true);
              setMobileRailOpen(false);
            }}
            selectedJudge={selectedJudge}
            onChangeJudge={setSelectedJudge}
          />
        </SheetContent>
      </Sheet>

      <AddModelDialog
        open={addModelOpen}
        onOpenChange={setAddModelOpen}
        selectedModels={selectedModels}
        onAdd={(id) => {
          addModel(id);
          toast.success(t("compareModels.toastAddedModel").replace("{label}", getModelLabel(id)));
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
          toast.success(t("compareModels.toastInsertedPrompt").replace("{title}", p.title));
        }}
      />

      <SkillsDialog
        open={skillsOpen}
        onOpenChange={setSkillsOpen}
        pinnedIds={pinnedSkillIds}
        onTogglePin={(id) =>
          setPinnedSkillIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
      />

      <Dialog
        open={deleteRunId !== null}
        onOpenChange={(open) => !open && setDeleteRunId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("arena.deleteComparison")}</DialogTitle>
            <DialogDescription>
              {t("arena.deleteConfirm").replace("{question}", deleteRunQuestion)}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteRunId(null)}
              className="cursor-pointer"
            >
              {t("common.cancel")}
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
                    err instanceof Error ? err.message : t("compareModels.toastDeleteRunFailed");
                  toast.error(message);
                });
              }}
              className="cursor-pointer"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─── Prompt bubble ──────────────────────────────────────────────────── */

function PromptBubble({ question }: { question: string }) {
  return (
    <div className="flex items-start gap-3 rounded bg-bg-1 p-4">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-6 text-[11px] font-semibold text-white">
        U
      </div>
      <p className="flex-1 text-[14px] italic leading-[1.5] text-text-1">
        “{question}”
      </p>
    </div>
  );
}

/* ─── Response + evaluation card ─────────────────────────────────────── */

function ResponseCard({
  modelId,
  usedModel,
  response,
  evaluation,
  status,
  isFavorite,
  onToggleFavorite,
  onCopy,
}: {
  modelId: string;
  /** Set when a configured fallback answered in place of `modelId` (the
   *  picked model was dead/unavailable). Drives the "via …" indicator. */
  usedModel?: string;
  /** True when this is the model whose answer the user marked as best. */
  isFavorite: boolean;
  onToggleFavorite: () => void;
  response: string | null;
  evaluation: ModelEvaluation | null;
  /** Per-panel lifecycle. Drives the body's loading-style text:
   *   pending   → "Waiting to start…"
   *   streaming → if response is empty, "Generating…"; once tokens
   *               arrive, render content with a subtle inline
   *               typing cursor at the end.
   *   done      → render content as-is.
   *   error     → render content (already the humanized message). */
  status: "pending" | "streaming" | "done" | "error";
  onCopy: (text: string) => void;
}) {
  const { t } = useLanguage();
  const { getLabel: getModelLabel } = useUserModels();
  const label = getModelLabel(modelId);
  const tone = getModelTone(modelId);
  const provider = getModelProvider(modelId);
  // When a fallback answered, surface the model that actually responded.
  const usedLabel =
    usedModel && usedModel !== modelId ? getModelLabel(usedModel) : null;

  return (
    <article
      className={`flex min-w-0 flex-col gap-2.5 rounded bg-bg-1 p-4 transition-shadow ${
        isFavorite ? "ring-2 ring-success-7" : ""
      }`}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}
          >
            <Bot className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-medium text-text-2">
              {label}
            </span>
            {usedLabel && (
              <span
                className="truncate text-[11px] text-warning-6"
                title={`${label} ${t("arena.fallbackUnavailable")} ${usedLabel}`}
              >
                ↳ {t("arena.answeredBy")} {usedLabel}
              </span>
            )}
          </div>
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
                title={t("compareModels.titleModelInfo")}
                aria-label={t("compareModels.titleModelInfo")}
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
                {usedLabel && (
                  <InfoRow label={t("arena.answeredBy")} value={usedLabel} />
                )}
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

      {/* Body — driven by `status` so each lifecycle phase has its
          own visual treatment instead of conflating "no content
          yet" with "no response will ever arrive". `break-words`
          stops long unbreakable strings (URLs, code samples) from
          forcing horizontal page scroll on narrow viewports. */}
      <div className="rounded bg-bg-white p-3 text-[13px] leading-[1.625] text-text-1 break-words min-w-0">
        {status === "pending" ? (
          <span className="flex items-center gap-2 text-text-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("arena.waitingToStart")}
          </span>
        ) : status === "streaming" && !response ? (
          <span className="flex items-center gap-2 text-text-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("arena.generatingResponse")}
          </span>
        ) : response ? (
          // Streaming-with-content + done both render the markdown.
          // While streaming, append a subtle blinking cursor to
          // signal more tokens are still on the way.
          <div>
            <AiResponseRender content={response} />
            {status === "streaming" && (
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-primary-6 align-middle" />
            )}
          </div>
        ) : (
          <span className="text-text-3">{t("arena.noResponse")}</span>
        )}
      </div>

      {/* Evaluation */}
      {evaluation && <EvaluationBlock evaluation={evaluation} />}

      {/* Footer actions */}
      <footer className="flex items-center justify-end gap-1 border-t border-border-2 pt-2">
        <button
          type="button"
          onClick={() => response && onCopy(response)}
          disabled={!response}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-text-3 transition-colors hover:bg-bg-white hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          title={t("compareModels.titleCopy")}
          aria-label={t("compareModels.titleCopy")}
        >
          <Clipboard className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={isFavorite}
          title={t("arena.bestAnswer")}
          aria-label={t("arena.bestAnswer")}
          className={`flex h-7 cursor-pointer items-center gap-1.5 rounded px-2 text-[12px] font-medium transition-colors ${
            isFavorite
              ? "bg-success-1 text-success-7"
              : "text-text-3 hover:bg-bg-white hover:text-text-1"
          }`}
        >
          <ThumbsUp
            className="h-3.5 w-3.5"
            fill={isFavorite ? "currentColor" : "none"}
            strokeWidth={2}
          />
          {isFavorite && <span>{t("arena.best")}</span>}
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
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-3 rounded border border-border-2 bg-bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-text-2">
          {t("arena.evaluation")}
        </span>
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-bold ${scoreBadgeTone(evaluation.score)}`}
        >
          {t("arena.score")}: {evaluation.score}
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
          {t("arena.advantages")}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-success-7">
          {evaluation.advantages.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-2">
          {t("arena.disadvantages")}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-danger-6">
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

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

const FILE_ALLOWED_LABEL =
  "PDF, DOCX, TXT, MD, MARKDOWN, CSV, JSON, LOG, TS, TSX, JS, JSX, PY, HTML, CSS, YML, YAML, XML, SQL, SH, RB, GO, RS, JAVA, C, CPP, H, HPP, TOML, INI, ENV";

function validateAttachment(file: File): string | null {
  const ext = fileExtension(file.name);
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
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx")
  );
}

function Composer({
  question,
  setQuestion,
  expectedOutput,
  setExpectedOutput,
  loading,
  activeModelCount,
  onSubmit,
  onStop,
  attachedFile,
  setAttachedFile,
  onOpenPromptLibrary,
  onOpenSkills,
  pinnedSkillCount,
}: {
  question: string;
  setQuestion: (v: string) => void;
  expectedOutput: string;
  setExpectedOutput: (v: string) => void;
  loading: boolean;
  activeModelCount: number;
  onSubmit: (e: React.FormEvent) => void;
  /** Called when the user clicks the Stop button mid-stream. Wired
   *  to the page-level AbortController so cancel propagates to the
   *  BE and every in-flight model stream tears down. */
  onStop: () => void;
  attachedFile: { name: string; content: string } | null;
  setAttachedFile: (f: { name: string; content: string } | null) => void;
  onOpenPromptLibrary: () => void;
  onOpenSkills: () => void;
  pinnedSkillCount: number;
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const expectedRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the question textarea to fit its content, capped so a
  // pasted novel can't push the composer to fill the page. Past the
  // cap the textarea scrolls internally.
  useEffect(() => {
    const ta = questionRef.current;
    if (!ta) return;
    const MAX = 200;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, MAX);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > MAX ? "auto" : "hidden";
  }, [question]);

  // Auto-grow the expected-output textarea the same way: fit content up to a
  // cap, then scroll internally past it (replaces the manual resize handle /
  // fixed-height scroller).
  useEffect(() => {
    const ta = expectedRef.current;
    if (!ta) return;
    const MAX = 160;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, MAX);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > MAX ? "auto" : "hidden";
  }, [expectedOutput]);

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

  async function ingestFile(file: File) {
    const validationError = validateAttachment(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (file.size > ATTACH_FILE_MAX_BYTES) {
      const limitMb = (ATTACH_FILE_MAX_BYTES / 1024 / 1024).toFixed(0);
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      toast.error(
        t("compareModels.toastFileTooLarge")
          .replace("{name}", file.name)
          .replace("{size}", sizeMb)
          .replace("{limit}", limitMb),
      );
      return;
    }

    if (needsServerParse(file)) {
      const toastId = toast.loading(t("compareModels.toastParsing").replace("{name}", file.name));
      try {
        const parsed = await parseArenaAttachment(file);
        setAttachedFile(parsed);
        toast.success(t("compareModels.toastAttached").replace("{name}", parsed.name), { id: toastId });
      } catch (err) {
        toast.error(humanizeChatError(err), { id: toastId });
      }
      return;
    }

    try {
      const content = await file.text();
      setAttachedFile({ name: file.name, content });
    } catch (err) {
      toast.error(humanizeChatError(err));
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await ingestFile(file);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full flex-col gap-2.5 rounded-[16px] bg-bg-3 p-2"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACH_FILE_ACCEPT}
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex flex-col rounded-[16px] border border-border-4 bg-bg-white">
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
            placeholder={t("arena.askMeAnything")}
            rows={1}
            className={`min-h-[30px] w-full resize-none overflow-hidden border-0 bg-transparent font-normal text-text-1 placeholder:text-text-2 focus:outline-none ${
              question
                ? "text-[14px] leading-[18px]"
                : "text-[16px] leading-[30px]"
            }`}
            disabled={loading}
          />
        </div>
        {/* Expected output (functional addition — not in Figma) */}
        <textarea
          ref={expectedRef}
          value={expectedOutput}
          onChange={(e) => setExpectedOutput(e.target.value)}
          placeholder={t("arena.expectedOutput")}
          rows={1}
          className="min-h-[24px] w-full resize-none overflow-hidden border-t border-border-2 bg-transparent px-4 py-3 text-[14px] leading-[1.3] text-text-1 placeholder:text-text-2 focus:outline-none"
          disabled={loading}
        />
        {/* Attached file pill — single slot. */}
        {attachedFile && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-2 px-4 py-2">
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
                title={t("compareModels.titleRemoveFile")}
                aria-label={t("compareModels.titleRemoveFile")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        )}
        {/* Chips + actions row */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <ComposerChip
              icon={Paperclip}
              label={t("arena.attachFile")}
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            />
            <ComposerChip
              icon={Library}
              label={t("arena.promptLibrary")}
              onClick={onOpenPromptLibrary}
              disabled={loading}
            />
            <ComposerChip
              icon={Sparkles}
              label={
                pinnedSkillCount > 0
                  ? `${t("arena.skills")} (${pinnedSkillCount})`
                  : t("arena.skills")
              }
              onClick={onOpenSkills}
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
              title={t("arena.voiceComingSoon")}
              aria-label={t("compareModels.ariaVoiceInput")}
            >
              <Mic className="h-4 w-4" />
            </button>
            {/* Send swaps to Stop while the arena fan-out is in
                flight. Stop fires the page-level abort which
                propagates through fetch → BE req.close → cancels
                every model stream at once. */}
            {loading ? (
              <button
                type="button"
                onClick={onStop}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-danger-6 text-white transition-colors hover:bg-danger-7"
                title={t("arena.stopGenerating")}
                aria-label={t("compareModels.ariaStop")}
              >
                <Square
                  className="h-3.5 w-3.5"
                  fill="currentColor"
                  strokeWidth={0}
                />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  !question.trim() ||
                  !expectedOutput.trim() ||
                  activeModelCount < MIN_MODELS
                }
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-primary-6 text-white transition-colors hover:bg-primary-7 disabled:cursor-not-allowed disabled:opacity-50"
                title={t("arena.compare")}
                aria-label={t("arena.compare")}
              >
                <Send className="h-4 w-4" />
              </button>
            )}
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
      className="inline-flex h-8 items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-3 text-[14px] font-normal text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
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
  selectedJudge,
  onChangeJudge,
  hideClose = false,
  className,
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
  /** Judge-model selection ("" = backend default) + setter. */
  selectedJudge: string;
  onChangeJudge: (id: string) => void;
  /** When the rail is embedded in a parent that already supplies a
   *  close affordance (e.g. the mobile Sheet's built-in X), suppress
   *  the local X in the header to avoid two stacked dismiss buttons. */
  hideClose?: boolean;
  /** Override the default desktop aside layout (fixed 300px wide). */
  className?: string;
}) {
  const { t } = useLanguage();
  const { models, getLabel } = useUserModels();
  const canRemove = selectedModels.length > MIN_MODELS;
  const canAddMore = selectedModels.length < models.length;
  const [judgeExpanded, setJudgeExpanded] = useState(false);
  // The BE-resolved default judge (ARENA_JUDGE_MODEL / its default) so
  // the "Default" option names the real model without hardcoding it.
  const { data: judgeDefault } = useQuery({
    queryKey: ["arena-judge-default"],
    queryFn: fetchArenaJudgeDefault,
    staleTime: 60 * 60 * 1000,
  });
  const judgeDefaultLabel = judgeDefault?.name
    ? t("arena.judgeDefault").replace("{model}", judgeDefault.name)
    : t("arena.judgeDefaultPlain");

  // History pagination — 5 entries per page so the rail doesn't grow
  // into a wall of past prompts. Page state is local to the rail so
  // opening/closing the section doesn't reset, but a new history
  // entry (post-comparison) snaps back to page 1 so the most recent
  // run is visible.
  const HISTORY_PAGE_SIZE = 5;
  const [historyPage, setHistoryPage] = useState(1);
  const historyTotalPages = Math.max(
    1,
    Math.ceil(history.length / HISTORY_PAGE_SIZE),
  );
  useEffect(() => {
    setHistoryPage(1);
  }, [history.length]);
  useEffect(() => {
    if (historyPage > historyTotalPages) setHistoryPage(historyTotalPages);
  }, [historyPage, historyTotalPages]);
  const pagedHistory = history.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE,
  );

  return (
    <aside
      className={
        className ??
        // h-full + min-h-0 ride the desktop wrapper's bounded height
        // and let overflow-y-auto kick in. Without h-full the aside
        // would take its content height and overflow into the parent.
        "flex h-full min-h-0 w-[300px] shrink-0 flex-col gap-6 overflow-y-auto"
      }
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[18px] font-bold leading-[1.3] text-text-2">
          {t("arena.comparisonDetails")}
        </h2>
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            title={t("compareModels.titleClose")}
            aria-label={t("compareModels.titleClose")}
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      {/* Models section */}
      <RailSection
        title={t("teams.models")}
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
          {t("arena.addModel")}
        </button>
      </RailSection>

      {/* Judge model — which model scores the answers. "Default" lets
          the backend pick (ARENA_JUDGE_MODEL). Its cost bills the same
          personal budget as the compared models. */}
      <RailSection
        title={t("arena.judgeModel")}
        expanded={judgeExpanded}
        onToggle={() => setJudgeExpanded(!judgeExpanded)}
      >
        <p className="text-[12px] leading-relaxed text-text-3">
          {t("arena.judgeModelHint")}
        </p>
        <ModelCombobox
          value={selectedJudge}
          onChange={onChangeJudge}
          models={[
            { id: "", name: judgeDefaultLabel },
            ...models.map((m) => ({ id: m.id, name: getLabel(m.id) })),
          ]}
        />
      </RailSection>

      {/* History section — paginated 5 per page so the rail doesn't
          balloon past the viewport on power users. Date grouping
          applies to the current page only; users scan one page at
          a time so cross-page grouping wasn't carrying its weight. */}
      <RailSection
        title={t("arena.history")}
        expanded={historyExpanded}
        onToggle={() => setHistoryExpanded(!historyExpanded)}
      >
        {history.length === 0 ? (
          <p className="text-[13px] text-text-3">
            {t("arena.noHistory")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupHistoryByDate(pagedHistory).map((group) => (
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
                        className="mt-0.5 shrink-0 cursor-pointer rounded p-1 text-text-3 transition-colors hover:bg-bg-1 hover:text-danger-6"
                        title={t("arena.deleteComparison")}
                        aria-label={t("arena.deleteComparison")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {historyTotalPages > 1 && (
              <Pagination
                page={historyPage}
                totalPages={historyTotalPages}
                onPageChange={setHistoryPage}
                compact
              />
            )}
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
  const { t } = useLanguage();
  const { models, getLabel: getModelLabel } = useUserModels();
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
            {t("sidebar.noCreateTooltip")}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Avatar + name */}
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}
        title={`${t("common.model")} ${slot}`}
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
            title={t("compareModels.titleChangeModel")}
            aria-label={t("compareModels.titleChangeModel")}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Slot {slot}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {models.map((m) => {
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
                <span className="truncate">{m.name}</span>
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
                className="text-danger-6 focus:text-danger-6"
              >
                {t("compareModels.removeFromComparison")}
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
  models: AvailableModel[];
}

function groupModelsByProvider(
  source: AvailableModel[],
  query: string,
): ProviderGroup[] {
  const q = query.trim().toLowerCase();
  const matched = source.filter((m) => {
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      getModelProvider(m.id).toLowerCase().includes(q)
    );
  });

  const map = new Map<string, AvailableModel[]>();
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
  const { t } = useLanguage();
  const { models } = useUserModels();
  const [query, setQuery] = useState("");
  // Default selection points at the first model not already in the comparison.
  const firstAvailable = useMemo(
    () =>
      models.find((m) => !selectedModels.includes(m.id))?.id ??
      models[0]?.id ??
      "",
    [models, selectedModels],
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

  const groups = useMemo(
    () => groupModelsByProvider(models, query),
    [models, query],
  );
  const selected =
    models.find((m) => m.id === selectedId) ?? models[0] ?? null;
  const tone = selected ? getModelTone(selected.id) : "bg-bg-1 text-text-2";
  const alreadyInUse = selected ? selectedModels.includes(selected.id) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-[880px] sm:max-w-[880px] gap-0 p-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border-2 px-6 py-4">
          <DialogTitle className="text-[18px] font-bold text-text-1">
            {t("arena.addModel")}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            aria-label={t("compareModels.titleClose")}
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
                placeholder={t("compareModels.placeholderSearchModels")}
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
                                {m.name}
                              </span>
                              {inUse && (
                                <span className="rounded bg-primary-6/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-6">
                                  {t("compareModels.inUse")}
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
            {selected ? (
              <>
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}
                  >
                    <Bot className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-bold text-text-1">
                      {selected.name}
                    </span>
                    <span className="truncate text-[11px] text-text-3">
                      {selected.id}
                    </span>
                  </div>
                </div>

                <p className="text-[13px] leading-[1.5] text-text-2">
                  {selected.description ??
                    "Available in WorkenAI. Used to compare answers against other models in the arena."}
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <SpecChip label="Provider" value={getModelProvider(selected.id)} />
                  {selected.context_length ? (
                    <SpecChip
                      label="Context"
                      value={`${selected.context_length.toLocaleString()} tokens`}
                    />
                  ) : (
                    <SpecChip label="Tier" value="—" />
                  )}
                  <SpecChip
                    label="Status"
                    value={alreadyInUse ? "In use" : "Available"}
                  />
                </div>
              </>
            ) : (
              <p className="text-[13px] text-text-3">
                No models found. Check back in a moment.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-border-2 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-full px-5"
          >
            {t("common.cancel")}
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
            {t("arena.addModel")}
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
  const { t } = useLanguage();
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
          err instanceof Error ? err.message : t("compareModels.toastLoadPromptsFailed");
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [open, loaded, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [prompts, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border-2 px-6 py-4">
          <DialogTitle className="text-[18px] font-bold text-text-1">
            {t("arena.promptLibrary")}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-1 hover:text-text-1"
            aria-label={t("compareModels.titleClose")}
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
              placeholder={t("compareModels.placeholderSearchPrompts")}
              className="h-10 pl-9 placeholder:text-text-3"
            />
          </div>

          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
            {loading && !loaded ? (
              <p className="py-8 text-center text-[13px] text-text-3">
                {t("common.loading")}
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
                        <span className="rounded bg-primary-1 px-2 py-0.5 text-[10px] font-medium text-text-2">
                          {p.category}
                        </span>
                      )}
                      {p.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-border-2 bg-bg-white px-2 py-0.5 text-[10px] text-text-2"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>

          <div className="border-t border-border-2 pt-2">
            <Link
              href="/toolkit/prompt-library"
              onClick={() => onOpenChange(false)}
              className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-bg-1 hover:text-primary-6"
            >
              <Library className="h-3.5 w-3.5" />
              Manage prompts →
            </Link>
          </div>
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
  const { t } = useLanguage();
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
          err instanceof Error ? err.message : t("compareModels.toastLoadShortcutsFailed");
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [open, t]);

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
          className="inline-flex h-8 cursor-pointer items-center gap-2.5 rounded-lg border border-border-2 bg-bg-white px-3 text-[14px] font-normal text-text-1 transition-colors hover:border-primary-6 disabled:cursor-not-allowed disabled:opacity-50"
          title={t("compareModels.titleInsertShortcut")}
        >
          <LayoutGrid className="h-4 w-4" />
          {t("compareModels.shortcuts")}
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
            placeholder={t("compareModels.placeholderSearchShortcuts")}
            className="h-7 w-full border-0 bg-transparent text-[13px] text-text-1 placeholder:text-text-3 focus:outline-none"
            autoFocus
          />
        </div>
        <div className="flex max-h-[280px] flex-col gap-0.5 overflow-y-auto p-1">
          {loading ? (
            <p className="py-6 text-center text-[12px] text-text-3">{t("common.loading")}</p>
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
          <Link
            href="/toolkit/shortcuts"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-bg-1 hover:text-primary-6"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Manage shortcuts →
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Markdown renderer (kept from previous implementation) ──────────── */

// Some models (notably Anthropic Claude) occasionally emit HTML entities
// like `&quot;` directly in the response text. Without this pre-pass our
// `escapeHtml` re-escapes the leading `&` to `&amp;`, so the browser only
// half-decodes and the user sees literal `&quot;` instead of a quote.
// Decode first, then let the renderer do its single escape pass.
// `&amp;` must come last so we don't re-decode entities we just produced.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function aiResponseToHtml(raw: string): string {
  if (!raw) return "";

  const lines = decodeHtmlEntities(raw).split(/\r?\n/);

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
      const listItems = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, "")))}</li>`,
        );
        i++;
      }
      htmlLines.push("<ul>" + listItems.join("") + "</ul>");
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(
          `<li>${processBold(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, "")))}</li>`,
        );
        i++;
      }
      htmlLines.push("<ol>" + listItems.join("") + "</ol>");
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
