import { HttpException } from '@nestjs/common';
import type { Database } from '../database/database.module.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { EncryptionService } from '../openrouter/encryption.service.js';
import type { KeyResolverService } from '../openrouter/key-resolver.service.js';
import {
  ChatTransportService,
  KEY_LIMIT_EXCEEDED_MARKER,
  KEY_LOW_BALANCE_TOKENS,
  KEY_PAUSED_MARKER,
  MEMBER_CAP_REACHED_MARKER,
  MEMBER_SUSPENDED_MARKER,
  ORG_BUDGET_EXCEEDED_MARKER,
  ORG_SUSPENDED_MARKER,
  TEAM_BUDGET_EXCEEDED_MARKER,
  TEAM_SUSPENDED_MARKER,
  decideCapAction,
  decideIntegrationLimit,
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

/* ─── decideIntegrationLimit (pure) ────────────────────────────────── */

describe('decideIntegrationLimit', () => {
  it('passes with no alerts when no limit is set', () => {
    expect(
      decideIntegrationLimit({
        limitTokens: null,
        usedTokens: 9_999_999,
        estimatedTokens: 9_999_999,
      }),
    ).toEqual({ pass: true, alerts: [] });
  });

  it('blocks a paused key (limit=0) with KEY_PAUSED and no alerts', () => {
    const d = decideIntegrationLimit({
      limitTokens: 0,
      usedTokens: 0,
      estimatedTokens: 0,
    });
    expect(d.pass).toBe(false);
    expect(d.marker).toBe(KEY_PAUSED_MARKER);
    expect(d.alerts).toEqual([]);
  });

  it('passes quietly well under the limit', () => {
    const d = decideIntegrationLimit({
      limitTokens: 1_000_000,
      usedTokens: 100_000,
      estimatedTokens: 1_000,
    });
    expect(d).toEqual({ pass: true, marker: undefined, alerts: [] });
  });

  it('fires the 80% alert on the call that crosses 80%', () => {
    const d = decideIntegrationLimit({
      limitTokens: 1_000_000,
      usedTokens: 790_000,
      estimatedTokens: 20_000, // projected 810k ≥ 800k
    });
    expect(d.pass).toBe(true);
    expect(d.alerts).toContain('80');
  });

  it('fires the low-balance alert as headroom crosses the band', () => {
    // limit 1M, low band = min(KEY_LOW_BALANCE_TOKENS, 5% = 50k) = 50k.
    // used leaves 60k headroom; estimate pushes headroom below 50k.
    const d = decideIntegrationLimit({
      limitTokens: 1_000_000,
      usedTokens: 940_000,
      estimatedTokens: 15_000, // remaining 60k → 45k, crosses 50k band
    });
    expect(d.alerts).toContain('low');
    expect(KEY_LOW_BALANCE_TOKENS).toBeGreaterThan(0);
  });

  it('blocks and fires 100% on the call that reaches the limit', () => {
    const d = decideIntegrationLimit({
      limitTokens: 100_000,
      usedTokens: 95_000,
      estimatedTokens: 10_000, // projected 105k ≥ 100k
    });
    expect(d.pass).toBe(false);
    expect(d.marker).toBe(KEY_LIMIT_EXCEEDED_MARKER);
    expect(d.alerts).toContain('100');
  });

  it('blocks post-flight without re-firing 100% once already over', () => {
    const d = decideIntegrationLimit({
      limitTokens: 100_000,
      usedTokens: 120_000, // already over
      estimatedTokens: 0,
    });
    expect(d.pass).toBe(false);
    expect(d.marker).toBe(KEY_LIMIT_EXCEEDED_MARKER);
    // used is already past the limit, so the crossing alert does NOT fire
    expect(d.alerts).not.toContain('100');
  });

  it('clamps negative usage/estimate so a bad caller cannot bypass', () => {
    const d = decideIntegrationLimit({
      limitTokens: 100_000,
      usedTokens: -50_000,
      estimatedTokens: -50_000,
    });
    expect(d.pass).toBe(true);
    expect(d.alerts).toEqual([]);
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
      then: (onFulfilled?: (value: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onFulfilled),
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
      db as unknown as Database,

      {} as unknown as EncryptionService,

      {} as unknown as KeyResolverService,

      // NotificationsService stub — budget-alert fanout is fire-
      // and-forget here, only `getTeamBudgetRecipients` /
      // `getOrgBudgetRecipients` would matter and both default to
      // empty (no recipients → no rows enqueued).
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
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
      db as unknown as Database,

      {} as unknown as EncryptionService,

      {} as unknown as KeyResolverService,

      // NotificationsService stub — budget-alert fanout is fire-
      // and-forget here, only `getTeamBudgetRecipients` /
      // `getOrgBudgetRecipients` would matter and both default to
      // empty (no recipients → no rows enqueued).
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
    );
  }

  it('silently passes when no callerUserId is provided (test/back-compat)', async () => {
    // Without a caller we can't identify a tenant; prod paths always
    // wire it in, but back-compat tests don't, and the gate should
    // be a no-op rather than fall back to a deployment-wide cap.
    const svc = makeService([]);
    await expect(svc.assertOrgBudgetNotExceeded()).resolves.toBeUndefined();
  });

  it('silently passes when caller has no tenant (personal-profile / mid-onboarding)', async () => {
    // LEFT JOIN companies onto users — personal callers land here
    // with companyId=null and monthlyBudgetCents=null and the gate
    // skips.
    const svc = makeService([[{ companyId: null, monthlyBudgetCents: null }]]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ callerUserId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('passes when tenant monthlyBudgetCents is null ("no target set")', async () => {
    const svc = makeService([[{ companyId: 'c1', monthlyBudgetCents: null }]]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ callerUserId: 'u1' }),
    ).resolves.toBeUndefined();
  });

  it('throws ORG_SUSPENDED when tenant monthlyBudgetCents = 0 (kill switch)', async () => {
    const svc = makeService([[{ companyId: 'c1', monthlyBudgetCents: 0 }]]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ callerUserId: 'u1' }),
    ).rejects.toThrow(ORG_SUSPENDED_MARKER);
  });

  it('passes when projected (spent + estimate) stays under the tenant target', async () => {
    // Row order matters: the aggregate's outer `db.select` is shifted
    // off the queue BEFORE the subquery's `db.select` (JS evaluates
    // the method chain head before evaluating the where-arg's
    // sub-expression). So [agg] resolves to row[1]; the empty row[2]
    // is just a placeholder the subquery shift consumes silently.
    const svc = makeService([
      [{ companyId: 'c1', monthlyBudgetCents: 50000 }], // $500 tenant cap
      [{ total: '100.00' }], // aggregate: $100 spent so far in tenant
      [], // tenant-users subquery (consumed and discarded)
    ]);
    await expect(
      svc.assertOrgBudgetNotExceeded({
        callerUserId: 'u1',
        estimatedCostCents: 100,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws ORG_BUDGET_EXCEEDED post-flight when tenant spend already crosses target', async () => {
    const svc = makeService([
      [{ companyId: 'c1', monthlyBudgetCents: 50000 }], // $500
      [{ total: '512.00' }], // aggregate: $512 — over
      [], // tenant-users subquery
    ]);
    await expect(
      svc.assertOrgBudgetNotExceeded({ callerUserId: 'u1' }),
    ).rejects.toThrow(ORG_BUDGET_EXCEEDED_MARKER);
  });

  it('throws ORG_BUDGET_EXCEEDED pre-flight when the estimate would push the tenant over', async () => {
    const svc = makeService([
      [{ companyId: 'c1', monthlyBudgetCents: 50000 }], // $500
      [{ total: '498.00' }], // aggregate: $498
      [], // tenant-users subquery
    ]);
    await expect(
      svc.assertOrgBudgetNotExceeded({
        callerUserId: 'u1',
        estimatedCostCents: 500,
      }),
    ).rejects.toThrow(/would push the company past/);
  });
});

/* ─── resolve() Azure BYOK routing (with mocked db) ──────────────── */

describe('ChatTransportService.resolve (Azure BYOK)', () => {
  const USER_ID = 'user-id';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as unknown as Database,
      // encryption: decrypt returns a deterministic plaintext key
      { decrypt: (s: string) => `plain:${s}` } as unknown as EncryptionService,
      // key-resolver: OpenRouter fallback key
      {
        resolveUserKey: () => Promise.resolve('openrouter-key'),
      } as unknown as KeyResolverService,
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
    );
  }

  it('routes azure/<deployment> through the AzureOpenAI client with endpoint + api-version', async () => {
    const svc = makeService([
      [], // user alias lookup — none
      [], // personalUseTeamIds: accepted memberships — none
      [], // personalUseTeamIds: owned teams — none (→ no shared-key lookups)
      [
        {
          apiKeyEncrypted: 'enc',
          config: {
            azureEndpoint: 'https://my-res.openai.azure.com',
            azureApiVersion: '2024-10-21',
            azureDeployments: [{ deploymentName: 'gpt4-prod', label: 'GPT-4' }],
          },
        },
      ], // user BYOK azure row
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: 'azure/gpt4-prod',
    });

    expect(t.kind).toBe('azure-sdk');
    expect(t.source).toBe('byok');
    expect(t.provider).toBe('azure');
    expect(t.model).toBe('gpt4-prod'); // the deployment name
    expect(t.apiKey).toBe('plain:enc');
    expect(t.azureEndpoint).toBe('https://my-res.openai.azure.com');
    expect(t.azureApiVersion).toBe('2024-10-21');
  });

  it('falls back to OpenRouter when the azure config is incomplete', async () => {
    const svc = makeService([
      [], // user alias lookup — none
      [], // personalUseTeamIds: accepted memberships — none
      [], // personalUseTeamIds: owned teams — none
      [{ apiKeyEncrypted: 'enc', config: { azureApiVersion: '2024-10-21' } }], // no endpoint
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: 'azure/gpt4-prod',
    });

    expect(t.kind).toBe('openai-sdk');
    expect(t.source).toBe('openrouter');
    expect(t.apiKey).toBe('openrouter-key');
    expect(t.model).toBe('azure/gpt4-prod');
  });
});

describe('ChatTransportService.resolve (Custom LLM team link)', () => {
  const USER_ID = 'user-id';
  const TEAM_ID = 'team-id';
  const MODEL = 'team:abcd1234:my-llm';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as unknown as Database,
      { decrypt: (s: string) => `plain:${s}` } as unknown as EncryptionService,
      {
        resolveUserKey: () => Promise.resolve('openrouter-key'),
        resolveTeamKey: () => Promise.resolve('team-openrouter-key'),
        resolveForProject: () => Promise.resolve('openrouter-key'),
      } as unknown as KeyResolverService,
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
    );
  }

  it('routes a team-shared Custom LLM when the team link is enabled', async () => {
    const svc = makeService([
      [{ integrationId: 'int-1', upstreamModel: 'llama-3.1' }], // team alias
      [
        {
          isEnabled: true,
          apiUrl: 'https://llm.local/v1',
          apiKeyEncrypted: 'enc',
        },
      ], // integration
      [{ isEnabled: true }], // team link
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: MODEL,
      teamId: TEAM_ID,
    });

    expect(t.source).toBe('custom');
    expect(t.provider).toBe('custom');
    expect(t.baseURL).toBe('https://llm.local/v1');
    expect(t.model).toBe('llama-3.1'); // upstream model, not the synthetic id
    expect(t.apiKey).toBe('plain:enc');
  });

  it('falls through to OpenRouter when the team link is paused (is_enabled=false)', async () => {
    const svc = makeService([
      [{ integrationId: 'int-1', upstreamModel: 'llama-3.1' }], // team alias
      [
        {
          isEnabled: true,
          apiUrl: 'https://llm.local/v1',
          apiKeyEncrypted: 'enc',
        },
      ], // integration enabled…
      [{ isEnabled: false }], // …but the team link is paused
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: MODEL,
      teamId: TEAM_ID,
    });

    // No custom route: the paused link must stop routing here.
    expect(t.source).toBe('openrouter');
    expect(t.model).toBe(MODEL);
  });
});

/* ─── assertTeamBudgetNotExceeded (with mocked db) ────────────────── */

describe('ChatTransportService.assertTeamBudgetNotExceeded', () => {
  const TEAM_ID = 'team-id';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as never,
      {} as never,
      {} as never,
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as never,
    );
  }

  it('skips when no team is in scope (personal chat)', async () => {
    const svc = makeService([]);
    await expect(svc.assertTeamBudgetNotExceeded()).resolves.toBeUndefined();
  });

  it('passes when team row is gone (race with deletion)', async () => {
    const svc = makeService([
      [], // teams — no row
    ]);
    await expect(
      svc.assertTeamBudgetNotExceeded({ teamId: TEAM_ID }),
    ).resolves.toBeUndefined();
  });

  it('throws TEAM_SUSPENDED when budget is 0', async () => {
    const svc = makeService([[{ budget: 0, name: 'Engineering' }]]);
    await expect(
      svc.assertTeamBudgetNotExceeded({ teamId: TEAM_ID }),
    ).rejects.toThrow(TEAM_SUSPENDED_MARKER);
  });

  it('passes when projected stays under the budget', async () => {
    const svc = makeService([
      [{ budget: 50000, name: 'Engineering' }], // $500
      [{ total: '100.00' }], // $100 spent
    ]);
    await expect(
      svc.assertTeamBudgetNotExceeded({
        teamId: TEAM_ID,
        estimatedCostCents: 100, // +$1
      }),
    ).resolves.toBeUndefined();
  });

  it('throws TEAM_BUDGET_EXCEEDED post-flight when spend already crosses budget', async () => {
    const svc = makeService([
      [{ budget: 50000, name: 'Engineering' }], // $500
      [{ total: '512.00' }], // $512 — over
    ]);
    await expect(
      svc.assertTeamBudgetNotExceeded({ teamId: TEAM_ID }),
    ).rejects.toThrow(TEAM_BUDGET_EXCEEDED_MARKER);
  });

  it('throws TEAM_BUDGET_EXCEEDED pre-flight when the estimate would push over', async () => {
    const svc = makeService([
      [{ budget: 50000, name: 'Engineering' }], // $500
      [{ total: '498.00' }], // $498
    ]);
    await expect(
      svc.assertTeamBudgetNotExceeded({
        teamId: TEAM_ID,
        estimatedCostCents: 500, // +$5 → $503
      }),
    ).rejects.toThrow(/would push the team past/);
  });
});

/* ─── resolve: personal-scope shared key (allow_personal_use) ───────── */

describe('ChatTransportService.resolve (personal-scope shared key)', () => {
  const USER_ID = 'user-id';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as unknown as Database,
      { decrypt: (s: string) => `plain:${s}` } as unknown as EncryptionService,
      {
        resolveUserKey: () => Promise.resolve('openrouter-key'),
      } as unknown as KeyResolverService,
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
    );
  }

  it('routes a personal chat through a team key shared for personal use', async () => {
    const svc = makeService([
      [], // user alias lookup — none
      [{ teamId: 'team-1' }], // personalUseTeamIds: accepted membership
      [], // personalUseTeamIds: owned teams — none
      [], // shared custom alias — none (this is a BYOK provider)
      [], // user personal BYOK — none
      [{ id: 'int-9', apiKeyEncrypted: 'enc', config: {} }], // shared team BYOK
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: 'openai/gpt-4o',
    });

    expect(t.source).toBe('byok');
    expect(t.kind).toBe('openai-sdk');
    expect(t.integrationId).toBe('int-9');
    expect(t.apiKey).toBe('plain:enc');
    expect(t.model).toBe('gpt-4o');
  });

  it('falls back to OpenRouter when the user is in no team', async () => {
    const svc = makeService([
      [], // user alias lookup — none
      [], // memberships — none
      [], // owned teams — none (→ no shared lookups run)
      [], // user personal BYOK — none
    ]);

    const t = await svc.resolve({
      userId: USER_ID,
      modelIdentifier: 'openai/gpt-4o',
    });

    expect(t.source).toBe('openrouter');
    expect(t.integrationId).toBeUndefined();
  });
});

/* ─── assertIntegrationLimitNotExceeded (with mocked db) ───────────── */

describe('ChatTransportService.assertIntegrationLimitNotExceeded', () => {
  const USER_ID = 'user-id';

  function makeService(rowSets: unknown[][]) {
    const db = makeChainableDb(rowSets);
    return new ChatTransportService(
      db as unknown as Database,
      { decrypt: (s: string) => `plain:${s}` } as unknown as EncryptionService,
      {} as unknown as KeyResolverService,
      {
        getTeamBudgetRecipients: () => Promise.resolve([] as string[]),
        getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
        createIfNotExists: () => Promise.resolve(null),
        create: () => Promise.resolve(null),
      } as unknown as NotificationsService,
    );
  }

  it('skips non-BYOK/Custom routes entirely', async () => {
    const svc = makeService([]); // no db calls expected
    await expect(
      svc.assertIntegrationLimitNotExceeded(
        { source: 'openrouter', integrationId: undefined },
        USER_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('passes when month-to-date tokens stay under the limit', async () => {
    const svc = makeService([
      [{ ownerId: 'owner', limit: 1_000_000, providerId: 'openai' }],
      [{ tokens: '1000', cost: '0' }],
    ]);
    await expect(
      svc.assertIntegrationLimitNotExceeded(
        { source: 'byok', integrationId: 'int-1' },
        USER_ID,
        { estimatedTokens: 1000 },
      ),
    ).resolves.toBeUndefined();
  });

  it('throws KEY_LIMIT_EXCEEDED once usage reaches the limit', async () => {
    const svc = makeService([
      [{ ownerId: 'owner', limit: 100_000, providerId: 'openai' }],
      [{ tokens: '95000', cost: '1.5' }],
    ]);
    await expect(
      svc.assertIntegrationLimitNotExceeded(
        { source: 'byok', integrationId: 'int-1' },
        USER_ID,
        { estimatedTokens: 10_000 },
      ),
    ).rejects.toThrow(KEY_LIMIT_EXCEEDED_MARKER);
  });

  it('throws KEY_PAUSED when the limit is 0', async () => {
    const svc = makeService([
      [{ ownerId: 'owner', limit: 0, providerId: 'custom' }],
      [{ tokens: '0', cost: '0' }],
    ]);
    await expect(
      svc.assertIntegrationLimitNotExceeded(
        { source: 'custom', integrationId: 'int-1' },
        USER_ID,
      ),
    ).rejects.toThrow(KEY_PAUSED_MARKER);
  });

  it('passes when no limit is configured (null)', async () => {
    const svc = makeService([
      [{ ownerId: 'owner', limit: null, providerId: 'openai' }],
    ]);
    await expect(
      svc.assertIntegrationLimitNotExceeded(
        { source: 'byok', integrationId: 'int-1' },
        USER_ID,
      ),
    ).resolves.toBeUndefined();
  });
});
