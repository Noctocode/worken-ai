import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
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
    const rows = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.ownerId, userId));

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

    // For custom rows we surface boundAliasCount so the FE can warn
    // before deletion ("N aliases will be unlinked"). One query for all
    // customs at once.
    const customIds = rows
      .filter((r) => r.providerId === 'custom')
      .map((r) => r.id);
    const aliasCountByIntegration = new Map<string, number>();
    if (customIds.length > 0) {
      const aliasRows = await this.db
        .select({
          integrationId: modelConfigs.integrationId,
          count: sql<number>`count(*)::int`,
        })
        .from(modelConfigs)
        .where(inArray(modelConfigs.integrationId, customIds))
        .groupBy(modelConfigs.integrationId);
      for (const r of aliasRows) {
        if (r.integrationId) {
          aliasCountByIntegration.set(r.integrationId, Number(r.count ?? 0));
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
      out.push({
        id: r.id,
        providerId: 'custom',
        displayName: deriveCustomDisplayName(r.apiUrl ?? ''),
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
    }

    const apiKeyEncrypted = input.apiKey?.trim()
      ? this.encryptionService.encrypt(input.apiKey.trim())
      : null;

    if (isCustom) {
      await this.db.insert(integrations).values({
        ownerId: userId,
        providerId: 'custom',
        apiUrl: input.apiUrl!,
        apiKeyEncrypted,
        isEnabled: input.isEnabled ?? true,
      });
    } else {
      // Upsert: try update, else insert.
      const [existing] = await this.db
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.ownerId, userId),
            eq(integrations.providerId, input.providerId),
          ),
        );

      if (existing) {
        const updates: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled;
        if (apiKeyEncrypted !== null) updates.apiKeyEncrypted = apiKeyEncrypted;
        if (apiKeyEncrypted === null && input.apiKey === '') {
          // Empty string explicitly clears the key.
          updates.apiKeyEncrypted = null;
        }
        await this.db
          .update(integrations)
          .set(updates)
          .where(eq(integrations.id, existing.id));
      } else {
        await this.db.insert(integrations).values({
          ownerId: userId,
          providerId: input.providerId,
          apiUrl: null,
          apiKeyEncrypted,
          isEnabled: input.isEnabled ?? true,
        });
      }
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

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled;
    if (input.apiKey !== undefined) {
      updates.apiKeyEncrypted = input.apiKey
        ? this.encryptionService.encrypt(input.apiKey)
        : null;
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

  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    if (row.ownerId !== userId) {
      throw new ForbiddenException('Not your integration');
    }
    if (row.providerId !== 'custom') {
      throw new BadRequestException(
        'Predefined provider rows cannot be deleted — disable them instead.',
      );
    }
    await this.db.delete(integrations).where(eq(integrations.id, id));
  }
}

/**
 * "https://api.together.xyz/v1/chat/completions" → "api.together.xyz"
 * Used as a card title for custom LLMs since the dialog doesn't ask for
 * a friendly name (Figma shows only the API Link field).
 */
function deriveCustomDisplayName(url: string): string {
  try {
    return new URL(url).hostname || 'Custom LLM';
  } catch {
    return 'Custom LLM';
  }
}
