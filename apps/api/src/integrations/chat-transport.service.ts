import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { integrations, modelConfigs } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { NATIVE_ENDPOINTS, providerOfModel } from './native-endpoints.js';

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
