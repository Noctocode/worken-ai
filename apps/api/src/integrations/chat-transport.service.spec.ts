import { HttpException } from '@nestjs/common';
import {
  ChatTransportService,
  MEMBER_CAP_REACHED_MARKER,
  MEMBER_SUSPENDED_MARKER,
  ORG_BUDGET_EXCEEDED_MARKER,
  decideCapAction,
} from './chat-transport.service.js';

/* ─── decideCapAction (pure) ───────────────────────────────────────── */

describe('decideCapAction', () => {
  it('passes when no cap is configured', () => {
    expect(
      decideCapAction({
        capCents: null,
        spentCents: 9999,
        estimatedCostCents: 9999,
      }),
    ).toEqual({ pass: true });
  });

  it('blocks suspended members (cap=0) regardless of spend or estimate', () => {
    const decision = decideCapAction({
      capCents: 0,
      spentCents: 0,
      estimatedCostCents: 0,
    });
    expect(decision.pass).toBe(false);
    if (!decision.pass) {
      expect(decision.marker).toBe(MEMBER_SUSPENDED_MARKER);
      expect(decision.message).toContain(MEMBER_SUSPENDED_MARKER);
    }
  });

  it('passes when projected spend stays under cap', () => {
    expect(
      decideCapAction({
        capCents: 2000, // $20
        spentCents: 1000, // $10
        estimatedCostCents: 100, // $1 — projected $11 < $20
      }),
    ).toEqual({ pass: true });
  });

  it('blocks pre-flight when the estimate would push spend over cap', () => {
    const decision = decideCapAction({
      capCents: 2000, // $20
      spentCents: 1900, // $19
      estimatedCostCents: 200, // $2 — projected $21 ≥ $20
    });
    expect(decision.pass).toBe(false);
    if (!decision.pass) {
      expect(decision.marker).toBe(MEMBER_CAP_REACHED_MARKER);
      expect(decision.message).toContain('would push you');
      expect(decision.message).toContain('Try a smaller prompt');
      expect(decision.message).toContain('$20.00');
    }
  });

  it('blocks post-flight with the locked-out message when spend already crossed cap', () => {
    const decision = decideCapAction({
      capCents: 2000,
      spentCents: 2500, // already over
      estimatedCostCents: 0,
    });
    expect(decision.pass).toBe(false);
    if (!decision.pass) {
      expect(decision.marker).toBe(MEMBER_CAP_REACHED_MARKER);
      expect(decision.message).toContain('is reached');
      expect(decision.message).toContain('Resets on the 1st');
    }
  });

  it('treats spent === cap exactly as post-flight blocked (boundary)', () => {
    // The boundary matters: the call that lands cap = spent shouldn't
    // be allowed through even with a 0 estimate, otherwise the user
    // gets one freebie call after they've already spent every cent.
    const decision = decideCapAction({
      capCents: 2000,
      spentCents: 2000,
      estimatedCostCents: 0,
    });
    expect(decision.pass).toBe(false);
    if (!decision.pass) {
      expect(decision.marker).toBe(MEMBER_CAP_REACHED_MARKER);
    }
  });

  it('clamps negative estimates to 0 — no free spend from a bad caller', () => {
    // Defensive: if a caller miscomputes and passes -5000, that
    // shouldn't suddenly let them through the gate. Equivalent to
    // estimate = 0.
    const decision = decideCapAction({
      capCents: 2000,
      spentCents: 1500,
      estimatedCostCents: -5000,
    });
    expect(decision).toEqual({ pass: true });
  });

  it('treats estimate=0 as post-flight (boundary, not pre-flight)', () => {
    // When the caller couldn't compute an estimate (catalog miss for
    // BYOK / Custom routes), the gate degrades to spent >= cap and
    // the message is the locked-out one, not "try a smaller prompt".
    const decision = decideCapAction({
      capCents: 2000,
      spentCents: 2100,
      estimatedCostCents: 0,
    });
    expect(decision.pass).toBe(false);
    if (!decision.pass) {
      expect(decision.message).not.toContain('would push you');
      expect(decision.message).toContain('is reached');
    }
  });
});

/* ─── assertTeamMemberCapNotExceeded (with mocked db) ─────────────── */

/**
 * Drizzle's chained query interface (`db.select().from().where().limit()`)
 * is awkward to mock. We build a tiny chainable that returns whatever
 * the test queues up next — order-of-call dictates which row each
 * `.select()` resolves to. The helper short-circuits unused chain
 * methods to itself so the test only has to enumerate the data.
 */
function makeChainableDb(rowSets: unknown[][]) {
  const queue = [...rowSets];

  const makeChain = (rows: unknown[]) => {
    const promiseLike: Record<string, unknown> & PromiseLike<unknown[]> = {
      then: (
        onFulfilled?: (value: unknown[]) => unknown,
        _onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(onFulfilled),
      catch: (onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(rows).catch(onRejected),
    } as unknown as Record<string, unknown> & PromiseLike<unknown[]>;
    for (const m of [
      'from',
      'where',
      'leftJoin',
      'innerJoin',
      'limit',
      'orderBy',
      'groupBy',
    ]) {
      promiseLike[m] = jest.fn().mockReturnValue(promiseLike);
    }
    return promiseLike;
  };

  return {
    select: jest.fn().mockImplementation(() => {
      const next = queue.shift() ?? [];
      return makeChain(next);
    }),
  };
}

describe('ChatTransportService.assertTeamMemberCapNotExceeded', () => {
  const USER_ID = 'user-id';
  const TEAM_ID = 'team-id';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    // The ctor needs encryption + key-resolver too; we only exercise
    // the cap gate so stubs are sufficient.
    return new ChatTransportService(
      db as any,

      {} as any,

      {} as any,
    );
  }

  it('passes Custom routes when cap is null (no catalog pricing → 0 spend)', async () => {
    // Custom LLMs don't have catalog pricing, so observability never
    // logs cost for them. The gate still RUNS so we can enforce
    // suspension (cap=0); when cap is null/positive the spend math
    // is naturally 0 for custom and the call passes.
    const svc = makeService([
      [{ cap: null }], // teamMembers — no per-user cap
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws SUSPENDED on Custom routes when cap=0', async () => {
    // The hole this closes: previously source=custom early-returned,
    // letting a suspended member chat through team Custom LLMs.
    const svc = makeService([
      [{ cap: 0 }], // suspended
    ]);
    let caught: unknown;
    try {
      await svc.assertTeamMemberCapNotExceeded(USER_ID, { teamId: TEAM_ID });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).message).toContain(
      MEMBER_SUSPENDED_MARKER,
    );
  });

  it('skips when no team scope is in play (personal chat)', async () => {
    const svc = makeService([]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {}),
    ).resolves.toBeUndefined();
  });

  it('passes when cap is null (no per-user limit)', async () => {
    const svc = makeService([
      [{ cap: null }], // teamMembers row — no cap configured
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws SUSPENDED when cap=0 even with no spend', async () => {
    const svc = makeService([
      [{ cap: 0 }], // suspended
    ]);
    let caught: unknown;
    try {
      await svc.assertTeamMemberCapNotExceeded(USER_ID, { teamId: TEAM_ID });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(402);
    expect((caught as HttpException).message).toContain(
      MEMBER_SUSPENDED_MARKER,
    );
  });

  it('passes when cap > current spend and no pre-flight estimate', async () => {
    const svc = makeService([
      [{ cap: 2000 }], // $20 cap
      [{ total: '5.00' }], // sum(cost_usd) = $5 spent
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws CAP_REACHED post-flight when current spend already exceeds cap', async () => {
    const svc = makeService([
      [{ cap: 2000 }], // $20
      [{ total: '25.00' }], // already $25 — over
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
      }),
    ).rejects.toThrow(MEMBER_CAP_REACHED_MARKER);
  });

  it('throws CAP_REACHED pre-flight when the estimate would push over', async () => {
    const svc = makeService([
      [{ cap: 2000 }], // $20
      [{ total: '19.00' }], // $19 spent
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
        estimatedCostCents: 200, // $2 — projected $21 ≥ cap
      }),
    ).rejects.toThrow(/would push you/);
  });

  it('passes when membership row missing (user removed mid-chat — fail-open is ok, the call already routes through their key)', async () => {
    const svc = makeService([
      [], // no teamMembers row
    ]);
    await expect(
      svc.assertTeamMemberCapNotExceeded(USER_ID, {
        teamId: TEAM_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

/* ─── assertOrgBudgetNotExceeded (with mocked db) ─────────────────── */

describe('ChatTransportService.assertOrgBudgetNotExceeded', () => {
  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as any,

      {} as any,

      {} as any,
    );
  }

  it('passes when org_settings row is missing (fresh deployment)', async () => {
    const svc = makeService([
      [], // org_settings — no row yet
    ]);
    await expect(svc.assertOrgBudgetNotExceeded()).resolves.toBeUndefined();
  });

  it('passes when monthlyBudgetCents = 0 ("no target set")', async () => {
    const svc = makeService([[{ monthlyBudgetCents: 0 }]]);
    await expect(svc.assertOrgBudgetNotExceeded()).resolves.toBeUndefined();
  });

  it('passes when projected (spent + estimate) stays under the target', async () => {
    const svc = makeService([
      [{ monthlyBudgetCents: 50000 }], // $500 target
      [{ total: '100.00' }], // $100 spent so far
    ]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ estimatedCostCents: 100 }), // +$1
    ).resolves.toBeUndefined();
  });

  it('throws ORG_BUDGET_EXCEEDED post-flight when spend already crosses target', async () => {
    const svc = makeService([
      [{ monthlyBudgetCents: 50000 }], // $500
      [{ total: '512.00' }], // $512 — over
    ]);
    await expect(svc.assertOrgBudgetNotExceeded()).rejects.toThrow(
      ORG_BUDGET_EXCEEDED_MARKER,
    );
  });

  it('throws ORG_BUDGET_EXCEEDED pre-flight when the estimate would push over', async () => {
    const svc = makeService([
      [{ monthlyBudgetCents: 50000 }], // $500
      [{ total: '498.00' }], // $498
    ]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ estimatedCostCents: 500 }), // +$5 → $503
    ).rejects.toThrow(/would push the company past/);
  });
});
