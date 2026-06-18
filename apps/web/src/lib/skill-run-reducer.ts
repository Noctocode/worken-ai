import type { SkillArtifact, SkillRunEvent } from "@/lib/api";

/** One tool invocation in the run timeline (a call + its eventual result). */
export interface SkillRunStep {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  done: boolean;
}

export type SkillRunStatus =
  | "idle"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

/** The reduced view of a skill run, derived purely from its event stream. */
export interface SkillRunView {
  status: SkillRunStatus;
  runId: string | null;
  /** Accumulated assistant text. */
  text: string;
  /** Tool-step timeline, in call order. */
  steps: SkillRunStep[];
  artifacts: SkillArtifact[];
  estimatedUsd: number | null;
  costUsd: number | null;
  tokens: { prompt: number; completion: number; total: number } | null;
  error: string | null;
}

export const initialSkillRunView: SkillRunView = {
  status: "idle",
  runId: null,
  text: "",
  steps: [],
  artifacts: [],
  estimatedUsd: null,
  costUsd: null,
  tokens: null,
  error: null,
};

const TERMINAL: ReadonlySet<SkillRunStatus> = new Set([
  "done",
  "failed",
  "cancelled",
]);

/**
 * Fold one {@link SkillRunEvent} into the view. Pure + immutable so it can be
 * unit-tested and driven from a useReducer. `run_done` is authoritative for the
 * final status; a late `error` never downgrades an already-terminal run.
 */
export function reduceSkillRun(
  state: SkillRunView,
  event: SkillRunEvent,
): SkillRunView {
  switch (event.type) {
    case "run_started":
      return { ...state, status: "running", runId: event.runId };
    case "cost_estimate":
      return { ...state, estimatedUsd: event.estimatedUsd };
    case "text":
      return { ...state, text: state.text + event.delta };
    case "tool_call":
      return {
        ...state,
        steps: [
          ...state.steps,
          { id: event.id, name: event.name, input: event.input, done: false },
        ],
      };
    case "tool_result": {
      let matched = false;
      const steps = state.steps.map((s) => {
        if (s.id !== event.id || s.done) return s;
        matched = true;
        return { ...s, output: event.output, isError: event.isError, done: true };
      });
      // A result with no preceding call (shouldn't happen) still shows up.
      if (!matched) {
        steps.push({
          id: event.id,
          name: event.name,
          input: undefined,
          output: event.output,
          isError: event.isError,
          done: true,
        });
      }
      return { ...state, steps };
    }
    case "artifact": {
      if (state.artifacts.some((a) => a.id === event.id)) return state;
      return {
        ...state,
        artifacts: [
          ...state.artifacts,
          {
            id: event.id,
            filename: event.filename,
            mimeType: event.mimeType,
            sizeBytes: event.sizeBytes,
          },
        ],
      };
    }
    case "usage": {
      const prev = state.tokens ?? { prompt: 0, completion: 0, total: 0 };
      return {
        ...state,
        tokens: {
          prompt: prev.prompt + event.promptTokens,
          completion: prev.completion + event.completionTokens,
          total: prev.total + event.totalTokens,
        },
      };
    }
    case "run_done":
      return { ...state, status: event.status, costUsd: event.costUsd };
    case "error":
      return TERMINAL.has(state.status)
        ? { ...state, error: state.error ?? event.message }
        : { ...state, status: "failed", error: event.message };
    case "done":
    default:
      return state;
  }
}
