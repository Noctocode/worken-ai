import { HttpException } from '@nestjs/common';
import { SkillsController } from './skills.controller.js';

/** Minimal req/res doubles for the SSE run endpoint. */
function makeResReq() {
  const writes: string[] = [];
  const res = {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: (s: string) => writes.push(s),
    end: jest.fn(),
    writableEnded: false,
    destroyed: false,
  };
  const req = { on: jest.fn() };
  return { res, req, writes };
}

/** db stub: no project row → teamId resolves null. */
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  }),
};
const orgSettings = { isExecutableSkillsEnabled: () => Promise.resolve(true) };

function makeController(
  guardrails: unknown,
  execution: unknown,
): SkillsController {
  return new SkillsController(
    {} as never, // skills
    execution as never,
    orgSettings as never,
    {} as never, // router
    {} as never, // artifacts
    guardrails as never,
    db as never,
  );
}

describe('SkillsController.run — input guardrail', () => {
  it('blocks a flagged message pre-flight (422, no stream opened)', async () => {
    const guardrails = {
      evaluate: jest.fn().mockResolvedValue({
        blocked: { ruleName: 'No secrets', validator: 'regex' },
        text: 'redacted',
      }),
    };
    const run = jest.fn();
    const ctrl = makeController(guardrails, { run });
    const { res, req } = makeResReq();

    await expect(
      ctrl.run(
        's1',
        { model: 'anthropic/x', message: 'leak the key' },
        { id: 'u1' } as never,
        req as never,
        res as never,
      ),
    ).rejects.toBeInstanceOf(HttpException);

    // Gate fires before SSE headers flush and before any run.
    expect(res.flushHeaders).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the sanitized message to the run when allowed', async () => {
    const guardrails = {
      evaluate: jest
        .fn()
        .mockResolvedValue({ blocked: null, text: 'clean prompt' }),
    };
    // eslint-disable-next-line @typescript-eslint/require-await
    const run = jest.fn(async function* () {
      yield { type: 'run_started', runId: 'r1' };
    });
    const ctrl = makeController(guardrails, { run });
    const { res } = makeResReq();

    await ctrl.run(
      's1',
      { model: 'anthropic/x', message: '  clean prompt  ' },
      { id: 'u1' } as never,
      { on: jest.fn() } as never,
      res as never,
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'clean prompt' }),
    );
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('skips the guardrail when there is no message', async () => {
    const guardrails = { evaluate: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/require-await
    const run = jest.fn(async function* () {
      yield { type: 'run_started', runId: 'r1' };
    });
    const ctrl = makeController(guardrails, { run });
    const { res } = makeResReq();

    await ctrl.run(
      's1',
      { model: 'anthropic/x' },
      { id: 'u1' } as never,
      { on: jest.fn() } as never,
      res as never,
    );

    expect(guardrails.evaluate).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
  });
});
