import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  observabilityEvents,
  orgSettings,
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { NATIVE_ENDPOINTS, providerOfModel } from './native-endpoints.js';

/**
 * Marker string the FE chat-error humanizer matches on to render the
 * "ask your admin to approve a budget" message instead of the generic
 * "monthly budget exhausted" one. Exported so it stays a single source
 * of truth on both sides.
 */
export const PENDING_APPROVAL_MARKER = 'BUDGET_PENDING_APPROVAL';

/**
 * Marker for the per-member team cap (separate from the team-wide cap).
 * Surfaced to the FE humanizer so a user who hit *their* cap sees a
 * different message than one who hit the *team's* shared budget.
 */
export const MEMBER_CAP_REACHED_MARKER = 'TEAM_MEMBER_CAP_REACHED';
export const MEMBER_SUSPENDED_MARKER = 'TEAM_MEMBER_SUSPENDED';

/**
 * Marker for the org-wide monthly budget gate. Distinct from the
 * team-wide budget exhausted hit (raised by OpenRouter against a team's
 * sub-account) and from the per-member cap above. Lets the FE
 * humanizer route the user to "ask an admin to raise the company
 * budget" instead of "raise your personal cap".
 */
export const ORG_BUDGET_EXCEEDED_MARKER = 'ORG_BUDGET_EXCEEDED';

/**
 * Pure decision function for the per-member cap gate. Returns either
 * `{ pass: true }` or `{ pass: false, message }` so the IO-bound caller
 * can throw uniformly while the policy stays unit-testable without a
 * database.
 *
 * Rules:
 *   - cap === null → no per-user cap configured, always pass
 *   - cap === 0   → member suspended in this team, always block
 *   - cap > 0     → block when (spent + estimate) >= cap. Pre-flight
 *                   (spent < cap, estimate pushes over) gets a softer
 *                   "try a smaller prompt" message; post-flight
 *                   (spent >= cap, estimate ignored) tells them
 *                   they're locked out for the month.
 */
export function decideCapAction(input: {
  capCents: number | null;
  spentCents: number;
  estimatedCostCents: number;
}): { pass: true } | { pass: false; marker: string; message: string } {
  const { capCents, spentCents } = input;
  const estimateCents = Math.max(input.estimatedCostCents, 0);

  if (capCents == null) return { pass: true };

  if (capCents === 0) {
    return {
      pass: false,
      marker: MEMBER_SUSPENDED_MARKER,
      message: `${MEMBER_SUSPENDED_MARKER}: Your access to this team is paused. Ask the team admin to set a non-zero monthly cap in Management → Teams → Members.`,
    };
  }

  const projectedCents = spentCents + estimateCents;
  if (projectedCents < capCents) return { pass: true };

  const capUsd = (capCents / 100).toFixed(2);
  const spentUsdStr = (spentCents / 100).toFixed(2);
  const isPreflight = estimateCents > 0 && spentCents < capCents;
  const detail = isPreflight
    ? `would push you to ~$${(projectedCents / 100).toFixed(2)} (cap $${capUsd}, currently $${spentUsdStr}). Try a smaller prompt or a cheaper model.`
    : `is reached (used $${spentUsdStr}). Resets on the 1st of next month, or ask an admin to raise the cap.`;
  return {
    pass: false,
    marker: MEMBER_CAP_REACHED_MARKER,
    message: `${MEMBER_CAP_REACHED_MARKER}: Your monthly cap of $${capUsd} for this team ${detail}`,
  };
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type ChatRoutingSource = 'openrouter' | 'byok' | 'custom';

/**
 * Which client the chat layer should instantiate. `openai-sdk` is the
 * default — works for OpenRouter, OpenAI-compatible BYOK, and Custom
 * LLMs alike. `anthropic-sdk` triggers AnthropicClientService for
 * Anthropic BYOK (their native API isn't OpenAI-compatible).
 */
export type ChatTransportKind = 'openai-sdk' | 'anthropic-sdk';

export interface ChatTransport {
  /** baseURL for the OpenAI SDK client. Unused when kind is 'anthropic-sdk'. */
  baseURL: string;
  /** Plaintext API key. Empty string means "no auth header" (rare). */
  apiKey: string;
  /** Model id to pass to the SDK. May differ from input for custom routes. */
  model: string;
  /** Provider label for observability. */
  provider: string;
  /** How the call was routed. */
  source: ChatRoutingSource;
  /** Which SDK to use. */
  kind: ChatTransportKind;
}

/**
 * Resolves which (baseURL, apiKey, model) tuple a chat call should use.
 *
 * Routing rules, in order:
 *
 *   1. **Custom LLM** — if the user has a `model_configs` row for this
 *      model with `integrationId` set, the alias is bound to a specific
 *      Custom LLM endpoint. Use that integration's apiUrl + decrypted
 *      apiKey.
 *
 *   2. **BYOK** — if the model id has a slash (e.g. "anthropic/…"), look
 *      for an enabled, key-bearing `integrations` row matching the
 *      provider. Use the provider's native endpoint from
 *      NATIVE_ENDPOINTS — but only if it's openAICompatible. Anthropic /
 *      Google / Qwen native APIs aren't OpenAI-compatible, so BYOK keys
 *      are stored but the chat path skips them and falls through.
 *
 *   3. **OpenRouter** — fallback. Resolves the per-team or per-user
 *      OpenRouter key via the existing KeyResolverService.
 */
@Injectable()
export class ChatTransportService {
  private readonly logger = new Logger(ChatTransportService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly keyResolverService: KeyResolverService,
  ) {}

  async resolve(input: {
    userId: string;
    modelIdentifier: string;
    /** Optional. When set, used to resolve the OpenRouter key for the
     *  fallback path: project's team key when the project has a team,
     *  user key otherwise. */
    projectId?: string | null;
    /** Optional. Explicit team scope for callers that don't have a
     *  projectId (compare-models composer, etc.). When set, the
     *  OpenRouter fallback uses the team's key directly — so the
     *  spend gets billed to the team budget, matching what the
     *  pending-approval gate checks. */
    teamId?: string | null;
  }): Promise<ChatTransport> {
    const { userId, modelIdentifier, projectId, teamId } = input;

    // Resolve team scope ONCE up-front — used by Custom LLM alias
    // lookup, BYOK lookup, and the OpenRouter fallback billing
    // decision. Pulled out of the BYOK section because alias lookup
    // now needs it too (team-scoped aliases bound to team-scoped
    // Custom integrations).
    let teamScopeId = teamId ?? null;
    if (!teamScopeId && projectId) {
      const [proj] = await this.db
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      teamScopeId = proj?.teamId ?? null;
    }

    // 1. Custom LLM — alias bound to a Custom integration row. Prefer
    //    team-scoped alias when the chat is in team context, then fall
    //    back to user-personal. Without the team-scope branch, an admin
    //    could not share a Custom LLM endpoint with team members.
    let alias: { integrationId: string | null } | undefined;
    if (teamScopeId) {
      const [teamAlias] = await this.db
        .select({ integrationId: modelConfigs.integrationId })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.teamId, teamScopeId),
            eq(modelConfigs.modelIdentifier, modelIdentifier),
          ),
        )
        .limit(1);
      if (teamAlias) alias = teamAlias;
    }
    if (!alias) {
      const [userAlias] = await this.db
        .select({ integrationId: modelConfigs.integrationId })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.ownerId, userId),
            isNull(modelConfigs.teamId),
            eq(modelConfigs.modelIdentifier, modelIdentifier),
          ),
        )
        .limit(1);
      if (userAlias) alias = userAlias;
    }

    if (alias?.integrationId) {
      const [integration] = await this.db
        .select()
        .from(integrations)
        .where(eq(integrations.id, alias.integrationId))
        .limit(1);

      if (integration && integration.isEnabled && integration.apiUrl) {
        const apiKey = integration.apiKeyEncrypted
          ? this.safeDecrypt(integration.apiKeyEncrypted, 'custom integration')
          : '';
        return {
          baseURL: integration.apiUrl,
          apiKey,
          model: modelIdentifier,
          provider: 'custom',
          source: 'custom',
          kind: 'openai-sdk',
        };
      }

      this.logger.warn(
        `Alias ${modelIdentifier} pointed at integration ${alias.integrationId}, but it's missing/disabled — falling through.`,
      );
    }

    // 2. BYOK — team-scoped first (admin-shared key for everyone in
    //    the team), then user-personal. teamScopeId is already
    //    resolved at the top. Without the team branch a team member
    //    would always fall through to their own BYOK row even when the
    //    team has a shared key configured — defeating the whole point
    //    of "admin sets up Anthropic for TEAM X, members just use it".
    const provider = providerOfModel(modelIdentifier);
    if (provider) {
      let byokRow: typeof integrations.$inferSelect | undefined;

      if (teamScopeId) {
        // Predefined providers only — apiUrl IS NULL filter mirrors
        // the partial unique index that backs the table for team-
        // scoped BYOK. Custom LLMs aren't supported at team scope yet.
        const [teamByok] = await this.db
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.teamId, teamScopeId),
              eq(integrations.providerId, provider),
              eq(integrations.isEnabled, true),
              isNull(integrations.apiUrl),
            ),
          )
          .limit(1);
        if (teamByok?.apiKeyEncrypted) byokRow = teamByok;
      }

      if (!byokRow) {
        const [userByok] = await this.db
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.ownerId, userId),
              isNull(integrations.teamId),
              eq(integrations.providerId, provider),
              eq(integrations.isEnabled, true),
            ),
          )
          .limit(1);
        if (userByok?.apiKeyEncrypted) byokRow = userByok;
      }

      if (byokRow?.apiKeyEncrypted) {
        const native = NATIVE_ENDPOINTS[provider];
        const bareModel = modelIdentifier.slice(provider.length + 1);
        const apiKey = this.safeDecrypt(
          byokRow.apiKeyEncrypted,
          `BYOK ${provider}`,
        );

        // 2a. OpenAI-compatible providers go through the standard
        // OpenAI SDK with a custom baseURL.
        if (native?.openAICompatible) {
          return {
            baseURL: native.baseURL,
            apiKey,
            model: bareModel,
            provider,
            source: 'byok',
            kind: 'openai-sdk',
          };
        }

        // 2b. Providers we have a dedicated SDK shim for (currently
        // Anthropic). The chat layer recognises kind === 'anthropic-sdk'
        // and routes to AnthropicClientService instead of OpenAI SDK.
        if (native?.nativeSdkAvailable) {
          return {
            baseURL: native.baseURL, // unused by the SDK path
            apiKey,
            model: bareModel,
            provider,
            source: 'byok',
            kind: 'anthropic-sdk',
          };
        }

        this.logger.warn(
          `${provider} has a BYOK key set but no native transport available — falling back to OpenRouter for ${modelIdentifier}.`,
        );
      }
    }

    // 3. OpenRouter fallback. Order of precedence for which key to
    // bill the spend against: explicit teamId (compare-models with
    // a team picker) > projectId (chat in a project that may have
    // a team) > user. Aligns with how
    // assertManagedBudgetApproved decides which budget to gate on.
    const apiKey = teamId
      ? await this.keyResolverService.resolveTeamKey(teamId)
      : projectId
        ? await this.keyResolverService.resolveForProject(projectId, userId)
        : await this.keyResolverService.resolveUserKey(userId);

    return {
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      model: modelIdentifier,
      provider: provider ?? 'unknown',
      source: 'openrouter',
      kind: 'openai-sdk',
    };
  }

  /**
   * Pending-approval gate for Managed Cloud (OpenRouter-routed) calls.
   *
   * Managed-Cloud users sit at `monthlyBudgetCents = 0` from onboarding
   * until an admin explicitly approves a budget — at which point
   * `users.service.updateBudget` provisions or patches the OpenRouter
   * key with that budget. Without this gate, the user's first chat
   * either trips a generic 402 from OpenRouter ("budget exhausted",
   * misleading — they never had a budget) or sends `key-resolver`
   * lazy-provisioning a key behind the admin's back.
   *
   * Predicate is keyed on `infraChoice` not `openrouterKeyId` so the
   * gate fires equally for users whose onboarding-time provisioning
   * failed (no key + budget=0) and for those whose key exists with
   * budget=0 — both need admin approval before any spend.
   *
   * Skip for BYOK / Custom routes — those have their own external
   * billing and don't go through our budget tracking.
   *
   * @param teamId pass when the call is scoped to a specific team
   *   (compare-models with explicit teamId). For project-routed chats,
   *   pass `projectId` instead and the team is looked up from there.
   */
  async assertManagedBudgetApproved(
    transport: ChatTransport,
    userId: string,
    options: { projectId?: string | null; teamId?: string | null } = {},
  ): Promise<void> {
    if (transport.source !== 'openrouter') return;

    // Resolve the team scope: explicit teamId wins, otherwise look up
    // from project. Either way, team budget gates the spend.
    let teamId = options.teamId ?? null;
    if (!teamId && options.projectId) {
      const [proj] = await this.db
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(eq(projects.id, options.projectId))
        .limit(1);
      teamId = proj?.teamId ?? null;
    }

    if (teamId) {
      const [team] = await this.db
        .select({ budgetCents: teams.monthlyBudgetCents })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (team && team.budgetCents === 0) {
        throw new HttpException(
          `${PENDING_APPROVAL_MARKER}: This team is pending budget approval. Ask an admin to set a monthly budget in Management → Teams so members can use AI.`,
          402,
        );
      }
      return;
    }

    // No team scope → personal call. Gate fires for managed-cloud users
    // with budget=0 regardless of whether their key was provisioned.
    const [u] = await this.db
      .select({
        budgetCents: users.monthlyBudgetCents,
        infraChoice: users.infraChoice,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (u?.infraChoice === 'managed' && u.budgetCents === 0) {
      throw new HttpException(
        `${PENDING_APPROVAL_MARKER}: Your account is pending budget approval. Ask your admin to set a monthly budget in Management → Users so you can start using AI.`,
        402,
      );
    }
  }

  /**
   * Per-member team cap gate.
   *
   * Sits alongside `assertManagedBudgetApproved`: that one checks
   * whether the *team* has any budget at all (admin approval); this one
   * checks whether *this user* has hit *their* per-month cap inside the
   * team. Both fire for every team-scoped chat — the order doesn't
   * matter (each throws independently).
   *
   * Cap source: `team_members.monthly_cap_cents`.
   *   - NULL  → no per-user cap (member shares the team budget freely)
   *   - 0     → suspended in this team (admin disabled them via cap=0)
   *   - >0    → enforced. Spend = sum of observability_events.cost_usd
   *             for (userId, teamId, success=true, this calendar month).
   *
   * Spend computation runs against `observability_events` so it
   * covers all routing sources uniformly: WorkenAI default, team-
   * scoped BYOK, project-routed chats. The same monthly window
   * (`date_trunc('month', now())`) the Integration tab's "this
   * month" stats use, so admin and user see the same number.
   *
   * The gate fires regardless of the call's routing source so the
   * suspension state (cap=0) and the already-cap-reached state
   * apply uniformly to every routing path. The spend math is
   * naturally $0 for Custom routes though — observability logs
   * cost=null when there's no catalog pricing for the model, so the
   * SUM contributes nothing and the cap-exceeded branch never trips
   * from Custom usage alone. In other words: Custom LLMs never
   * *consume* the cap, but they're blocked when the member is
   * suspended or has already exceeded the cap via other routes.
   *
   * @param teamId pass when the call is scoped to a specific team
   *   (compare-models with explicit teamId). For project-routed chats,
   *   pass `projectId` instead and the team is looked up from there.
   */
  async assertTeamMemberCapNotExceeded(
    userId: string,
    options: {
      projectId?: string | null;
      teamId?: string | null;
      /**
       * Upper-bound cost estimate (cents) for the call about to happen.
       * Compared against `cap - currentSpend`; if the call would push
       * the member past their cap, blocked pre-flight. Pass 0 (or omit)
       * to skip the pre-flight check — gate then only fires once
       * post-flight spend already crosses the cap.
       *
       * Caller computes from catalog pricing + prompt length so the
       * gate stays decoupled from the model catalog service.
       */
      estimatedCostCents?: number;
    } = {},
  ): Promise<void> {
    // Custom routes don't have catalog pricing, so observability
    // logs cost=null — the spend SUM below naturally counts $0 for
    // them and the cap-exceeded branch never trips. We still RUN the
    // gate though, because the suspension state (cap=0) must apply
    // to every routing source: an admin who sets a member's cap to 0
    // expects them locked out of every chat path including team
    // Custom LLMs.

    let teamId = options.teamId ?? null;
    if (!teamId && options.projectId) {
      const [proj] = await this.db
        .select({ teamId: projects.teamId })
        .from(projects)
        .where(eq(projects.id, options.projectId))
        .limit(1);
      teamId = proj?.teamId ?? null;
    }
    if (!teamId) return;

    const [membership] = await this.db
      .select({ cap: teamMembers.monthlyCapCents })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
      )
      .limit(1);
    if (!membership) return;
    if (membership.cap == null) return; // no cap configured

    if (membership.cap === 0) {
      throw new HttpException(
        `${MEMBER_SUSPENDED_MARKER}: Your access to this team is paused. Ask the team admin to set a non-zero monthly cap in Management → Teams → Members.`,
        402,
      );
    }

    // Sum cost for this user, this team, this calendar month. Only
    // successful calls count — failed calls aren't billed (the
    // upstream returned an error before any tokens were charged).
    // costUsd is numeric(12,6) → drizzle returns string. Coalesce on
    // the SQL side so an empty result row gives '0' not null.
    const startOfMonth = sql`date_trunc('month', now())`;
    const [agg] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
      })
      .from(observabilityEvents)
      .where(
        and(
          eq(observabilityEvents.userId, userId),
          eq(observabilityEvents.teamId, teamId),
          eq(observabilityEvents.success, true),
          gte(observabilityEvents.createdAt, startOfMonth),
        ),
      );
    const spentUsd = agg ? parseFloat(agg.total) : 0;
    const spentCents = Math.round(spentUsd * 100);

    const decision = decideCapAction({
      capCents: membership.cap,
      spentCents,
      estimatedCostCents: options.estimatedCostCents ?? 0,
    });
    if (!decision.pass) {
      throw new HttpException(decision.message, 402);
    }
  }

  /**
   * Org-wide monthly budget gate. Pulls the singleton target from
   * `org_settings` and compares against aggregate org spend for the
   * current calendar month, optionally including a pre-flight cost
   * estimate.
   *
   * Rules:
   *   - target === 0 → "no target set", always pass. Existing
   *     deployments that never opened the Company tab Pencil keep
   *     working unchanged.
   *   - target > 0 → block when (spent + estimate) >= target. Same
   *     pre-flight vs post-flight wording split as decideCapAction
   *     so the user sees actionable copy.
   *
   * Runs on every chat path (WorkenAI default, BYOK, Custom). Custom
   * routes have cost=null in observability so they don't *consume*
   * the cap, but they're still blocked once the target is exhausted
   * by other routes — same shape as the per-member gate.
   */
  async assertOrgBudgetNotExceeded(
    options: {
      /**
       * Upper-bound cost estimate (cents) for the call about to happen.
       * Same semantics as the per-member gate — pass 0 (or omit) to
       * skip the pre-flight branch.
       */
      estimatedCostCents?: number;
    } = {},
  ): Promise<void> {
    const [settings] = await this.db
      .select({ monthlyBudgetCents: orgSettings.monthlyBudgetCents })
      .from(orgSettings)
      .orderBy(asc(orgSettings.createdAt))
      .limit(1);
    const targetCents = settings?.monthlyBudgetCents ?? 0;
    if (targetCents <= 0) return; // no target set

    const startOfMonth = sql`date_trunc('month', now())`;
    const [agg] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)`,
      })
      .from(observabilityEvents)
      .where(
        and(
          eq(observabilityEvents.success, true),
          gte(observabilityEvents.createdAt, startOfMonth),
        ),
      );
    const spentUsd = agg ? parseFloat(agg.total) : 0;
    const spentCents = Math.round(spentUsd * 100);

    const estimateCents = Math.max(options.estimatedCostCents ?? 0, 0);
    const projectedCents = spentCents + estimateCents;
    if (projectedCents < targetCents) return;

    const targetUsd = (targetCents / 100).toFixed(2);
    const spentUsdStr = (spentCents / 100).toFixed(2);
    const isPreflight = estimateCents > 0 && spentCents < targetCents;
    const detail = isPreflight
      ? `would push the company past ~$${(projectedCents / 100).toFixed(2)} (target $${targetUsd}, currently $${spentUsdStr}). Try a smaller prompt or wait for next month.`
      : `is reached (spent $${spentUsdStr}). Resets on the 1st of next month, or ask an admin to raise the target in Management → Company.`;
    throw new HttpException(
      `${ORG_BUDGET_EXCEEDED_MARKER}: Your company's monthly AI budget of $${targetUsd} ${detail}`,
      402,
    );
  }

  private safeDecrypt(encrypted: string, context: string): string {
    try {
      return this.encryptionService.decrypt(encrypted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to decrypt ${context} key: ${msg}. OPENROUTER_ENCRYPTION_KEY may have changed since the key was stored.`,
      );
    }
  }
}
