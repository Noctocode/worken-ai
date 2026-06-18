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
  const transport = {
    resolve: () => Promise.resolve({ kind: 'anthropic-sdk', source: 'byok' }),
    assertManagedBudgetApproved: () => Promise.resolve(undefined),
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
  return { transport, observability, catalog, recorded };
}

function makeSvc(
  db: unknown,
  provider: unknown,
  deps = makeDeps(),
): SkillExecutionService {
  return new SkillExecutionService(
    db as never,
    provider as never,
    toolRegistry as never,
    deps.transport as never,
    deps.observability as never,
    deps.catalog as never,
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
});
