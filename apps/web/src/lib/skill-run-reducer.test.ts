import { describe, expect, it } from "vitest";
import type { SkillRunEvent } from "@/lib/api";
import {
  initialSkillRunView,
  reduceSkillRun,
  type SkillRunView,
} from "./skill-run-reducer";

/** Fold a sequence of events from the initial state. */
function run(events: SkillRunEvent[]): SkillRunView {
  return events.reduce(reduceSkillRun, initialSkillRunView);
}

describe("reduceSkillRun", () => {
  it("tracks lifecycle: started → running, run_done → final status + cost", () => {
    const state = run([
      { type: "run_started", runId: "r1" },
      { type: "run_done", runId: "r1", status: "done", costUsd: 0.04 },
    ]);
    expect(state.status).toBe("done");
    expect(state.runId).toBe("r1");
    expect(state.costUsd).toBe(0.04);
  });

  it("accumulates streamed text and the pre-run estimate", () => {
    const state = run([
      { type: "cost_estimate", estimatedUsd: 0.01 },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    expect(state.estimatedUsd).toBe(0.01);
    expect(state.text).toBe("Hello");
  });

  it("pairs a tool_call with its tool_result into one timeline step", () => {
    const state = run([
      { type: "tool_call", id: "t1", name: "kc_search", input: { q: "x" } },
      {
        type: "tool_result",
        id: "t1",
        name: "kc_search",
        output: "found",
        isError: false,
      },
    ]);
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({
      id: "t1",
      name: "kc_search",
      output: "found",
      isError: false,
      done: true,
    });
  });

  it("collects artifacts and dedupes by id", () => {
    const art = {
      type: "artifact" as const,
      id: "a1",
      filename: "r.xlsx",
      mimeType: "x",
      sizeBytes: 10,
    };
    const state = run([art, art]);
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0].filename).toBe("r.xlsx");
  });

  it("sums usage across rounds", () => {
    const state = run([
      { type: "usage", promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      { type: "usage", promptTokens: 20, completionTokens: 8, totalTokens: 28 },
    ]);
    expect(state.tokens).toEqual({ prompt: 30, completion: 13, total: 43 });
  });

  it("an error mid-run fails the run and keeps the message", () => {
    const state = run([
      { type: "run_started", runId: "r1" },
      { type: "error", message: "cost ceiling reached" },
    ]);
    expect(state.status).toBe("failed");
    expect(state.error).toBe("cost ceiling reached");
  });

  it("a late error never downgrades an already-terminal run", () => {
    const state = run([
      { type: "run_started", runId: "r1" },
      { type: "run_done", runId: "r1", status: "done", costUsd: 0.02 },
      { type: "error", message: "ignored" },
    ]);
    expect(state.status).toBe("done");
    expect(state.error).toBe("ignored");
  });
});
