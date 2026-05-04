import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  projects,
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
     *  fallback path (team key vs user key). */
    projectId?: string | null;
  }): Promise<ChatTransport> {
    const { userId, modelIdentifier, projectId } = input;

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

    // 2. BYOK — user has a key for the model's native provider.
    const provider = providerOfModel(modelIdentifier);
    if (provider) {
      const [byok] = await this.db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.ownerId, userId),
            eq(integrations.providerId, provider),
            eq(integrations.isEnabled, true),
          ),
        )
        .limit(1);

      if (byok?.apiKeyEncrypted) {
        const native = NATIVE_ENDPOINTS[provider];
        const bareModel = modelIdentifier.slice(provider.length + 1);
        const apiKey = this.safeDecrypt(
          byok.apiKeyEncrypted,
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

    // 3. OpenRouter fallback.
    const apiKey = projectId
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
