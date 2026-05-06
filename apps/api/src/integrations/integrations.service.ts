import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  observabilityEvents,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import {
  PREDEFINED_PROVIDERS,
  isPredefinedProvider,
  type PredefinedProvider,
} from './predefined-providers.js';

interface IntegrationStats {
  successRate: number; // 0..1 over last 30 days
  /** Calls in the current calendar month. */
  apiCalls: number;
  /**
   * Peak calls in any single day over the last 30 days. Empirical
   * "burst" signal — replaces a hardcoded provider rate limit because
   * neither OpenRouter nor the native APIs expose per-key quotas in a
   * way we can read uniformly.
   */
  peakDailyCalls: number;
}

export interface IntegrationView {
  id: string | null; // null when no row exists yet (predefined, untouched)
  providerId: string;
  displayName: string;
  description: string;
  iconHint: string;
  apiUrl: string | null; // only set for "custom"
  hasApiKey: boolean; // never expose the key itself
  isEnabled: boolean;
  isCustom: boolean;
  /**
   * Whether the provider's native API speaks OpenAI Chat Completions
   * verbatim. Factual flag.
   */
  openAICompatible: boolean;
  /**
   * Whether we can honour a BYOK key end-to-end (OpenAI SDK against the
   * native baseURL, or a dedicated SDK shim like AnthropicClientService).
   * FE uses this to decide whether to show the "key is stored but chat
   * still routes through OpenRouter" disclaimer.
   */
  byokSupported: boolean;
  /**
   * For custom rows only: how many model_configs aliases reference this
   * integration. Drives the "delete will unlink N aliases" warning.
   */
  boundAliasCount: number;
  stats: IntegrationStats;
  createdAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
  ) {}

  /** Catalog of predefined providers, in canonical UI order. */
  listPredefined(): PredefinedProvider[] {
    return PREDEFINED_PROVIDERS;
  }

  /**
   * Returns one card-row per provider for the Integration tab.
   *
   * Predefined providers always appear (even when the user hasn't touched
   * them yet — id=null, isEnabled=true, no key). Custom LLMs are appended
   * after, one row each.
   */
  async listForUser(userId: string): Promise<IntegrationView[]> {
    // Personal scope only — team-scoped rows the same user owns (e.g.
    // admin configured a team key) belong to the team's Integrations
    // panel, not the personal one.
    const rows = await this.db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          isNull(integrations.teamId),
        ),
      );

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30d
    const statsRows = await this.db
      .select({
        provider: observabilityEvents.provider,
        successCount: sql<number>`count(*) filter (where ${observabilityEvents.success}=true)::int`,
        totalCount: sql<number>`count(*)::int`,
        thisMonth: sql<number>`count(*) filter (where ${observabilityEvents.createdAt} >= date_trunc('month', now()))::int`,
      })
      .from(observabilityEvents)
      .where(
        and(
          eq(observabilityEvents.userId, userId),
          gte(observabilityEvents.createdAt, since),
        ),
      )
      .groupBy(observabilityEvents.provider);

    // Peak calls in a single day over the last 30 days, per provider.
    // Two-step aggregate: count per (provider, day), then max over days.
    const peakRows = await this.db.execute<{
      provider: string;
      peak: number;
    }>(sql`
      SELECT provider, MAX(daily_count)::int AS peak
      FROM (
        SELECT
          ${observabilityEvents.provider} AS provider,
          DATE_TRUNC('day', ${observabilityEvents.createdAt}) AS day,
          COUNT(*) AS daily_count
        FROM ${observabilityEvents}
        WHERE
          ${observabilityEvents.userId} = ${userId}
          AND ${observabilityEvents.createdAt} >= ${since}
          AND ${observabilityEvents.provider} IS NOT NULL
        GROUP BY provider, day
      ) AS daily
      GROUP BY provider
    `);

    const statsByProvider = new Map<
      string,
      {
        successCount: number;
        totalCount: number;
        thisMonth: number;
        peakDaily: number;
      }
    >();
    for (const r of statsRows) {
      if (!r.provider) continue;
      statsByProvider.set(r.provider, {
        successCount: Number(r.successCount ?? 0),
        totalCount: Number(r.totalCount ?? 0),
        thisMonth: Number(r.thisMonth ?? 0),
        peakDaily: 0,
      });
    }
    // peakRows shape varies by drizzle adapter; the typed fields above
    // are what we expect, but the runtime row may have lowercase keys.
    const peakRowList = (peakRows as { rows?: unknown[] }).rows ?? peakRows;
    if (Array.isArray(peakRowList)) {
      for (const r of peakRowList as { provider: string; peak: number }[]) {
        if (!r.provider) continue;
        const existing = statsByProvider.get(r.provider) ?? {
          successCount: 0,
          totalCount: 0,
          thisMonth: 0,
          peakDaily: 0,
        };
        existing.peakDaily = Number(r.peak ?? 0);
        statsByProvider.set(r.provider, existing);
      }
    }

    const buildStats = (providerId: string): IntegrationStats => {
      const s = statsByProvider.get(providerId);
      const successRate =
        s && s.totalCount > 0 ? s.successCount / s.totalCount : 0;
      return {
        successRate,
        apiCalls: s?.thisMonth ?? 0,
        peakDailyCalls: s?.peakDaily ?? 0,
      };
    };

    // For custom rows we surface boundAliasCount (FE delete warning)
    // AND the bound alias's customName (used as the card title — the
    // user-provided name beats the URL hostname fallback). One query
    // for all customs at once.
    const customIds = rows
      .filter((r) => r.providerId === 'custom')
      .map((r) => r.id);
    const aliasCountByIntegration = new Map<string, number>();
    const aliasNameByIntegration = new Map<string, string>();
    if (customIds.length > 0) {
      const aliasRows = await this.db
        .select({
          integrationId: modelConfigs.integrationId,
          customName: modelConfigs.customName,
        })
        .from(modelConfigs)
        .where(inArray(modelConfigs.integrationId, customIds));
      for (const r of aliasRows) {
        if (!r.integrationId) continue;
        aliasCountByIntegration.set(
          r.integrationId,
          (aliasCountByIntegration.get(r.integrationId) ?? 0) + 1,
        );
        // Take the first alias's name as the canonical display.
        // Multiple-alias-per-integration is rare in practice (the
        // upsert flow auto-creates exactly one); the count column
        // covers the warning case.
        if (!aliasNameByIntegration.has(r.integrationId)) {
          aliasNameByIntegration.set(r.integrationId, r.customName);
        }
      }
    }

    const out: IntegrationView[] = [];

    // Predefined first, in catalog order.
    for (const p of PREDEFINED_PROVIDERS) {
      const row = rows.find(
        (r) => r.providerId === p.id && r.apiUrl === null,
      );
      out.push({
        id: row?.id ?? null,
        providerId: p.id,
        displayName: p.displayName,
        description: p.description,
        iconHint: p.iconHint,
        apiUrl: null,
        hasApiKey: !!row?.apiKeyEncrypted,
        // Default OFF for providers the user has never touched. Once
        // they exist in the table, respect whatever toggle state they
        // chose — independent of whether a BYOK key is set, because
        // "enabled without a key" is a meaningful state: it makes the
        // provider's models available in the picker / arena and the
        // chat call routes through the shared WorkenAI OpenRouter
        // account instead of BYOK. The key is an optional upgrade,
        // not a prerequisite.
        isEnabled: row?.isEnabled ?? false,
        isCustom: false,
        openAICompatible: p.openAICompatible,
        byokSupported: p.byokSupported,
        boundAliasCount: 0,
        stats: buildStats(p.id),
        createdAt: row?.createdAt?.toISOString() ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? null,
      });
    }

    // Custom LLMs after, sorted by created_at asc.
    const customs = rows
      .filter((r) => r.providerId === 'custom' && r.apiUrl !== null)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    for (const r of customs) {
      const aliasName = aliasNameByIntegration.get(r.id);
      out.push({
        id: r.id,
        providerId: 'custom',
        displayName: aliasName ?? deriveCustomDisplayName(r.apiUrl ?? ''),
        description: r.apiUrl ?? '',
        iconHint: 'custom',
        apiUrl: r.apiUrl,
        hasApiKey: !!r.apiKeyEncrypted,
        isEnabled: r.isEnabled,
        isCustom: true,
        // Custom URLs are presumed OpenAI-compatible — that's literally
        // what the user signed up for by registering an OpenAI-style
        // endpoint. (If it's not, the chat will fail at request time
        // and the humanizer surfaces the error.)
        openAICompatible: true,
        byokSupported: true,
        boundAliasCount: aliasCountByIntegration.get(r.id) ?? 0,
        stats: buildStats('custom'),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      });
    }

    return out;
  }

  /**
   * Create or upsert an integration row.
   * - For predefined providers: upsert by (ownerId, providerId).
   * - For custom: always insert a new row (apiUrl required).
   */
  async upsert(
    userId: string,
    input: {
      providerId: string;
      apiUrl?: string | null;
      apiKey?: string | null;
      isEnabled?: boolean;
      /** Required when providerId === "custom": the friendly name
       *  the user sees in the model picker. Mirrors the team-scope
       *  flow on /teams/:id/integrations — adding a Custom LLM
       *  auto-creates a bound `model_configs` alias so the user
       *  doesn't have to take a second trip through /catalog. */
      customName?: string | null;
    },
  ): Promise<IntegrationView> {
    const isCustom = input.providerId === 'custom';
    if (!isCustom && !isPredefinedProvider(input.providerId)) {
      throw new BadRequestException(`Unknown provider: ${input.providerId}`);
    }
    if (isCustom) {
      if (!input.apiUrl?.trim()) {
        throw new BadRequestException('Custom LLM requires apiUrl');
      }
      try {
        new URL(input.apiUrl);
      } catch {
        throw new BadRequestException('apiUrl is not a valid URL');
      }
      if (!input.customName?.trim()) {
        throw new BadRequestException(
          'Custom LLM requires a name shown in the model picker',
        );
      }
    }

    const apiKeyEncrypted = input.apiKey?.trim()
      ? this.encryptionService.encrypt(input.apiKey.trim())
      : null;

    if (isCustom) {
      const customName = input.customName!.trim();
      const modelIdentifier = userCustomModelIdentifier(userId, customName);

      // Reject collisions on (ownerId, modelIdentifier) up-front so
      // adding a second Custom LLM with the same display name fails
      // cleanly rather than blowing up at chat-transport lookup
      // time. Mirrors the team flow.
      const [existingAlias] = await this.db
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.ownerId, userId),
            isNull(modelConfigs.teamId),
            eq(modelConfigs.modelIdentifier, modelIdentifier),
          ),
        )
        .limit(1);
      if (existingAlias) {
        throw new BadRequestException(
          `A Custom LLM named "${customName}" already exists. Pick a different name.`,
        );
      }

      const [integration] = await this.db
        .insert(integrations)
        .values({
          ownerId: userId,
          providerId: 'custom',
          apiUrl: input.apiUrl!,
          apiKeyEncrypted,
          isEnabled: input.isEnabled ?? true,
        })
        .returning();
      // Bound alias is what makes the Custom LLM actually appear in
      // the user's model picker. Without it, the integration row
      // exists but every chat falls through to the WorkenAI default.
      await this.db.insert(modelConfigs).values({
        ownerId: userId,
        teamId: null,
        customName,
        modelIdentifier,
        integrationId: integration.id,
        isActive: true,
      });
    } else {
      // Atomic upsert against the partial unique index
      // `(owner_id, provider_id) WHERE api_url IS NULL AND team_id IS NULL`.
      // Replaces an earlier select-then-insert which had a thin race
      // window where two concurrent toggles could land on either side
      // of the SELECT and leave the FE state out of sync.
      //
      // The targetWhere must match the index predicate exactly (PG
      // requires the supplied predicate to imply the index's), so the
      // `team_id IS NULL` half is needed even though we never insert a
      // team-scoped row from this path. Without it the upsert falls
      // back to a different index — or fails with "no unique or
      // exclusion constraint matching".

      // Look up the existing row first so we can validate the *final*
      // state of (isEnabled, apiKey). Predefined providers must not
      // be enabled without a key — surfacing a provider in the model
      // picker while the key is missing leads to surprise 401s at
      // chat time. The check belongs on the BE because both the
      // personal Integration tab and any future API client run
      // through this service.
      const [existing] = await this.db
        .select({
          apiKeyEncrypted: integrations.apiKeyEncrypted,
          isEnabled: integrations.isEnabled,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.ownerId, userId),
            eq(integrations.providerId, input.providerId),
            isNull(integrations.apiUrl),
            isNull(integrations.teamId),
          ),
        )
        .limit(1);
      this.assertEnableHasKey({
        providerId: input.providerId,
        existingKey: existing?.apiKeyEncrypted ?? null,
        existingEnabled: existing?.isEnabled ?? false,
        inputApiKey: input.apiKey,
        nextApiKeyEncrypted: apiKeyEncrypted,
        inputEnabled: input.isEnabled,
      });

      // Build the on-conflict SET clause to preserve the 3-state
      // semantic of `apiKey`:
      //   - undefined → don't touch the stored key
      //   - empty string → clear the stored key (set null)
      //   - non-empty → encrypt and store
      // and similarly for isEnabled (undefined → don't touch).
      const conflictUpdates: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (input.isEnabled !== undefined) {
        conflictUpdates.isEnabled = input.isEnabled;
      }
      if (input.apiKey !== undefined) {
        conflictUpdates.apiKeyEncrypted = apiKeyEncrypted;
      }

      await this.db
        .insert(integrations)
        .values({
          ownerId: userId,
          teamId: null,
          providerId: input.providerId,
          apiUrl: null,
          apiKeyEncrypted,
          isEnabled: input.isEnabled ?? true,
        })
        .onConflictDoUpdate({
          target: [integrations.ownerId, integrations.providerId],
          targetWhere: sql`${integrations.apiUrl} IS NULL AND ${integrations.teamId} IS NULL`,
          set: conflictUpdates,
        });
    }

    const all = await this.listForUser(userId);
    const view = isCustom
      ? all.findLast((v) => v.providerId === 'custom') // newest custom
      : all.find((v) => v.providerId === input.providerId);
    return view!;
  }

  async update(
    userId: string,
    id: string,
    input: { isEnabled?: boolean; apiKey?: string | null },
  ): Promise<IntegrationView> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    if (row.ownerId !== userId) {
      throw new ForbiddenException('Not your integration');
    }
    // Team-scoped rows must go through the team endpoints so the
    // owner/editor role check fires. Without this guard, an admin
    // who later lost team-manage rights could keep editing the team
    // key via /integrations/:id (ownerId is the historical record of
    // who configured it, not who's currently allowed to manage it).
    if (row.teamId) {
      throw new ForbiddenException(
        'Team-scoped integrations must be edited via /teams/:id/integrations',
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled;
    let nextApiKeyEncrypted: string | null = null;
    if (input.apiKey !== undefined) {
      nextApiKeyEncrypted = input.apiKey
        ? this.encryptionService.encrypt(input.apiKey)
        : null;
      updates.apiKeyEncrypted = nextApiKeyEncrypted;
    }
    // Predefined providers can't be enabled without a key (Custom LLMs
    // are exempt — many self-hosted endpoints accept anonymous calls).
    if (row.providerId !== 'custom') {
      this.assertEnableHasKey({
        providerId: row.providerId,
        existingKey: row.apiKeyEncrypted,
        existingEnabled: row.isEnabled,
        inputApiKey: input.apiKey,
        nextApiKeyEncrypted,
        inputEnabled: input.isEnabled,
      });
    }
    await this.db
      .update(integrations)
      .set(updates)
      .where(eq(integrations.id, id));

    const all = await this.listForUser(userId);
    const view = all.find((v) => v.id === id);
    if (!view) throw new NotFoundException('Integration not found after update');
    return view;
  }

  /**
   * Reject `isEnabled = true` for a predefined-provider row that would
   * end up without an API key after the upsert/update. "Enabled
   * without key" used to mean "show this provider's models in my
   * picker, route via WorkenAI's shared OpenRouter account" — which
   * led to surprise 401s when a user assumed Enabled meant their key
   * was active. Now: explicit. Disable-without-key is fine; enable
   * requires a stored key (already there OR being set in this call).
   *
   * Custom LLMs bypass this check upstream — many self-hosted
   * endpoints (Ollama, vLLM behind a reverse proxy) accept anonymous
   * requests.
   */
  assertEnableHasKey(input: {
    providerId: string;
    existingKey: string | null;
    existingEnabled: boolean;
    /** Raw `apiKey` field from the request body — distinguishes the
     *  three call states: undefined / empty / non-empty. */
    inputApiKey: string | null | undefined;
    /** What we'd encrypt and write — null when caller cleared, set
     *  when caller passed a non-empty string. */
    nextApiKeyEncrypted: string | null;
    inputEnabled: boolean | undefined;
  }): void {
    const finalEnabled =
      input.inputEnabled !== undefined ? input.inputEnabled : input.existingEnabled;
    if (!finalEnabled) return; // disabling is always fine

    // What key the row will have after this write:
    //   inputApiKey === undefined → existing key untouched
    //   inputApiKey === null/'' → cleared, no key
    //   inputApiKey === '<value>' → encrypted into nextApiKeyEncrypted
    const finalKey =
      input.inputApiKey === undefined
        ? input.existingKey
        : input.nextApiKeyEncrypted;
    if (finalKey) return;

    throw new BadRequestException(
      'Cannot enable a provider without an API key. Add a key first, then toggle Enabled on.',
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    if (row.ownerId !== userId) {
      throw new ForbiddenException('Not your integration');
    }
    if (row.teamId) {
      throw new ForbiddenException(
        'Team-scoped integrations must be deleted via /teams/:id/integrations',
      );
    }
    if (row.providerId !== 'custom') {
      throw new BadRequestException(
        'Predefined provider rows cannot be deleted — disable them instead.',
      );
    }
    // Drop bound aliases first. The FK ON DELETE SET NULL would
    // otherwise leave orphans with integrationId=null AND a
    // user:short:slug modelIdentifier no provider can serve, showing
    // up in the picker as a dead entry. Same pattern as the team-
    // scope removeIntegration.
    await this.db
      .delete(modelConfigs)
      .where(
        and(
          eq(modelConfigs.ownerId, userId),
          isNull(modelConfigs.teamId),
          eq(modelConfigs.integrationId, id),
        ),
      );
    await this.db.delete(integrations).where(eq(integrations.id, id));
  }
}

/**
 * "https://api.together.xyz/v1/chat/completions" → "api.together.xyz"
 * Used as a card title for custom LLMs created before the upsert flow
 * required a customName (and as a defensive fallback if the bound
 * alias somehow goes missing).
 */
function deriveCustomDisplayName(url: string): string {
  try {
    return new URL(url).hostname || 'Custom LLM';
  } catch {
    return 'Custom LLM';
  }
}

/**
 * Build a stable, namespaced model identifier for a personal Custom
 * LLM alias. Mirrors the team variant in TeamsService — the user-
 * provided customName drives the display label; this gives the chat
 * layer a stable, collision-free identifier to bind aliases to.
 *
 * Format: `user:<userIdShort>:<nameSlug>`. The userIdShort prefix
 * keeps two users with the same display name from colliding on
 * (ownerId, modelIdentifier) at the chat-transport lookup layer.
 */
function userCustomModelIdentifier(userId: string, customName: string): string {
  const slug = customName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const userShort = userId.slice(0, 8);
  return `user:${userShort}:${slug || 'custom'}`;
}
