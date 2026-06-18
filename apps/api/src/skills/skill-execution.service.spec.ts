import { ConflictException } from '@nestjs/common';
import { skillRuns } from '@worken/database/schema';
import { SkillExecutionService } from './skill-execution.service.js';
import type { AgentLoopEvent } from '../integrations/agent-tools.types.js';

const SKILL = {
  id: 's1',
  userId: 'u1',
  source: 'executable',
  instructions: 'do it',
  scripts: [],
};

/** Minimal chainable drizzle stub covering what run() touches. */
function makeDb(skill: unknown) {
  const steps: Record<string, unknown>[] = [];
  const runUpdates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(skill ? [skill] : []) }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === skillRuns) {
          return { returning: () => Promise.resolve([{ id: 'run-1' }]) };
        }
        steps.push(v);
        return Promise.resolve(undefined);
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          runUpdates.push(v);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { db, steps, runUpdates };
}

const toolRegistry = {
  build: () => ({ tools: [], dispatch: () => Promise.resolve('') }),
};

/** BYOK-Anthropic route: budget gate is a no-op, catalog prices each round. */
function makeDeps(costPerCall = 0.01) {
  const recorded: Record<string, unknown>[] = [];
  let gateCalls = 0;
  const transport = {
    resolve: () => Promise.resolve({ kind: 'anthropic-sdk', source: 'byok' }),
    assertManagedBudgetApproved: () => {
      gateCalls += 1;
      return Promise.resolve(undefined);
    },
  };
  const observability = {
    recordLLMCall: (input: Record<string, unknown>) => {
      recorded.push(input);
      return Promise.resolve(undefined);
    },
  };
  const catalog = {
    estimateCost: () => Promise.resolve(costPerCall),
  };
  return {
    transport,
    observability,
    catalog,
    recorded,
    gateCalls: () => gateCalls,
  };
}

/**
 * Faithfully mirrors the real Anthropic adapter's contract: before each round
 * it calls onBeforeCall (throwing stops the loop with an `error` event), then
 * emits that round's `usage`. Lets us drive per-call gating + accumulation.
 */
function gatingProvider(
  rounds: { promptTokens: number; completionTokens: number }[],
) {
  return {
    streamWithTools: async function* (req: {
      onBeforeCall?: (i: number) => Promise<void>;
    }): AsyncIterable<AgentLoopEvent> {
      for (let i = 0; i < rounds.length; i++) {
        try {
          if (req.onBeforeCall) await req.onBeforeCall(i);
        } catch (err) {
          yield {
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          };
          return;
        }
        const r = rounds[i];
        yield {
          type: 'usage',
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.promptTokens + r.completionTokens,
        };
      }
      yield { type: 'done', stopReason: 'end_turn' };
    },
  };
}

/** Deny-by-default sandbox (Phase B behavior) unless a test overrides. */
const denySandbox = {
  isAvailable: () => false,
  run: () => Promise.reject(new Error('sandbox unavailable')),
};

function makeSvc(
  db: unknown,
  provider: unknown,
  deps = makeDeps(),
  sandbox: unknown = denySandbox,
): SkillExecutionService {
  return new SkillExecutionService(
    db as never,
    provider as never,
    toolRegistry as never,
    deps.transport as never,
    deps.observability as never,
    deps.catalog as never,
    sandbox as never,
  );
}

function scriptedProvider(events: AgentLoopEvent[]) {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    streamWithTools: async function* () {
      for (const e of events) yield e;
    },
  };
}

async function drain(gen: AsyncIterable<unknown>) {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('SkillExecutionService.run', () => {
  it('streams events, persists a tool + llm step, and finalizes the run as done', async () => {
    const { db, steps, runUpdates } = makeDb(SKILL);
    const provider = scriptedProvider([
      { type: 'tool_call', id: 't1', name: 'kc_search', input: { query: 'x' } },
      {
        type: 'tool_result',
        id: 't1',
        name: 'kc_search',
        output: 'res',
        isError: false,
      },
      { type: 'usage', promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const svc = makeSvc(db, provider);

    const events = (await drain(
      svc.run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' }),
    )) as { type: string; status?: string }[];

    expect(events[0].type).toBe('run_started');
    expect(events.at(-1)).toMatchObject({ type: 'run_done', status: 'done' });
    expect(steps.map((s) => s.stepType)).toEqual(['tool', 'llm']);
    expect(runUpdates.at(-1)).toMatchObject({ status: 'done' });
  });

  it('rejects a second concurrent run for the same user (one-run-per-user)', async () => {
    const { db } = makeDb(SKILL);
    // A provider that yields once then blocks, keeping run #1 in flight.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = {
      streamWithTools: async function* (): AsyncIterable<AgentLoopEvent> {
        yield { type: 'text', delta: 'hi' };
        await gate;
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const svc = makeSvc(db, provider);

    const gen1 = svc.run({
      userId: 'u1',
      skillId: 's1',
      modelIdentifier: 'anthropic/x',
    });
    await gen1.next(); // run_started — registers the aborter
    await gen1.next(); // into the loop (yields 'text', then awaits the gate)

    await expect(
      svc
        .run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' })
        .next(),
    ).rejects.toBeInstanceOf(ConflictException);

    release();
    await drain(gen1);
  });

  it('cancel returns false when the user has no run in flight', () => {
    const { db } = makeDb(SKILL);
    const svc = makeSvc(db, scriptedProvider([]));
    expect(svc.cancel('u1')).toBe(false);
  });

  it('aggregates spend across calls and tags each with the run id (turnId)', async () => {
    const { db, steps, runUpdates } = makeDb(SKILL);
    const deps = makeDeps(0.02);
    const svc = makeSvc(
      db,
      gatingProvider([
        { promptTokens: 100, completionTokens: 50 },
        { promptTokens: 100, completionTokens: 50 },
        { promptTokens: 100, completionTokens: 50 },
      ]),
      deps,
    );

    const events = (await drain(
      svc.run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' }),
    )) as { type: string; status?: string; costUsd?: number }[];

    // One observability event per upstream call, every one tagged turnId=runId.
    expect(deps.recorded).toHaveLength(3);
    expect(deps.recorded.every((r) => r.turnId === 'run-1')).toBe(true);
    expect(deps.recorded.every((r) => r.eventType === 'skill_run_call')).toBe(
      true,
    );
    // One llm step persisted per call.
    expect(steps.filter((s) => s.stepType === 'llm')).toHaveLength(3);
    // run_done + persisted run carry the rolled-up cost (3 × 0.02).
    const done = events.at(-1)!;
    expect(done).toMatchObject({ type: 'run_done', status: 'done' });
    expect(done.costUsd).toBeCloseTo(0.06, 6);
    expect(Number(runUpdates.at(-1)!.costUsd)).toBeCloseTo(0.06, 6);
  });

  it('re-gates the budget before every upstream call', async () => {
    const { db } = makeDb(SKILL);
    const deps = makeDeps(0.01);
    const svc = makeSvc(
      db,
      gatingProvider([
        { promptTokens: 10, completionTokens: 5 },
        { promptTokens: 10, completionTokens: 5 },
      ]),
      deps,
    );

    await drain(
      svc.run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' }),
    );

    expect(deps.gateCalls()).toBe(2);
  });

  it('fails closed when the per-run cost ceiling is reached', async () => {
    const { db, runUpdates } = makeDb(SKILL);
    // 0.6/call vs the $1.00 ceiling. Call 0 runs (acc→0.6, last→0.6). Call 1's
    // pre-flight gate projects acc+last = 1.2 ≥ 1.0 and stops BEFORE spending
    // again — so only one call is billed (stop before the overshoot).
    const deps = makeDeps(0.6);
    const svc = makeSvc(
      db,
      gatingProvider([
        { promptTokens: 1, completionTokens: 1 },
        { promptTokens: 1, completionTokens: 1 },
        { promptTokens: 1, completionTokens: 1 },
      ]),
      deps,
    );

    const events = (await drain(
      svc.run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' }),
    )) as { type: string; status?: string; message?: string }[];

    // Only the first call was billed before the projected ceiling tripped.
    expect(deps.recorded).toHaveLength(1);
    const err = events.find((e) => e.type === 'error');
    expect(err?.message).toMatch(/cost ceiling/i);
    expect(events.at(-1)).toMatchObject({
      type: 'run_done',
      status: 'failed',
    });
    expect(runUpdates.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('still accrues cost (and can hit the ceiling) when the catalog has no price', async () => {
    const { db } = makeDb(SKILL);
    // Catalog returns null → the run falls back to a token-based estimate, so
    // the ceiling is NOT bypassed. ~1000 prompt+completion tokens at the
    // $0.02/1k fallback ≈ $0.02/call.
    const deps = makeDeps(0.02);
    deps.catalog.estimateCost = () => Promise.resolve(null);
    const svc = makeSvc(
      db,
      gatingProvider([{ promptTokens: 600, completionTokens: 400 }]),
      deps,
    );

    const events = (await drain(
      svc.run({ userId: 'u1', skillId: 's1', modelIdentifier: 'anthropic/x' }),
    )) as { type: string; costUsd?: number }[];

    // One call recorded with a non-zero fallback cost (not silently $0).
    expect(deps.recorded).toHaveLength(1);
    expect(Number(deps.recorded[0].costUsd)).toBeCloseTo(0.02, 6);
    const done = events.at(-1)!;
    expect(done.costUsd).toBeCloseTo(0.02, 6);
  });
});
