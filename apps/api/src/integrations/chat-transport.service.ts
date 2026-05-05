import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  observabilityEvents,
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

    // 1. Custom LLM — alias explicitly bound to a Custom integration row.
    const [alias] = await this.db
      .select({
        integrationId: modelConfigs.integrationId,
      })
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.ownerId, userId),
          eq(modelConfigs.modelIdentifier, modelIdentifier),
        ),
      )
      .limit(1);

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

    // 2. BYOK — team-scoped first (admin-shared key for everyone in the
    //    team), then user-personal. Resolve the team scope from explicit
    //    teamId or by looking up the project's team. Without this two-
    //    step lookup, a team member would always fall through to their
    //    own BYOK row even when the team has a shared key configured —
    //    defeating the whole point of "admin sets up Anthropic for
    //    TEAM X, members just use it".
    const provider = providerOfModel(modelIdentifier);
    if (provider) {
      let teamScopeId = teamId ?? null;
      if (!teamScopeId && projectId) {
        const [proj] = await this.db
          .select({ teamId: projects.teamId })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        teamScopeId = proj?.teamId ?? null;
      }

      let byokRow:
        | typeof integrations.$inferSelect
        | undefined;

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

    if (
      u?.infraChoice === 'managed' &&
      u.budgetCents === 0
    ) {
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
   * Spend computation runs against `observability_events` (not
   * OpenRouter's per-key usage API) so it covers all routing sources
   * uniformly: OpenRouter team key, team-scoped BYOK, project-routed
   * chats. The same monthly window (`date_trunc('month', now())`) the
   * Integration tab's "this month" stats use, so admin and user see
   * the same number.
   *
   * Skipped for `source='custom'` — Custom LLM endpoints have their
   * own external billing and we don't track cost reliably there.
   *
   * @param teamId pass when the call is scoped to a specific team
   *   (compare-models with explicit teamId). For project-routed chats,
   *   pass `projectId` instead and the team is looked up from there.
   */
  async assertTeamMemberCapNotExceeded(
    transport: ChatTransport,
    userId: string,
    options: { projectId?: string | null; teamId?: string | null } = {},
  ): Promise<void> {
    if (transport.source === 'custom') return;

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
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, userId),
        ),
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
    if (spentCents >= membership.cap) {
      const capUsd = (membership.cap / 100).toFixed(2);
      const spentUsdStr = (spentCents / 100).toFixed(2);
      throw new HttpException(
        `${MEMBER_CAP_REACHED_MARKER}: Your monthly cap of $${capUsd} for this team is reached (used $${spentUsdStr}). Resets on the 1st of next month, or ask an admin to raise the cap.`,
        402,
      );
    }
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
