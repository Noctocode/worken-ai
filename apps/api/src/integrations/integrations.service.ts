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
  users,
  type IntegrationConfig,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { ModelsService } from '../models/models.service.js';
import {
  PREDEFINED_PROVIDERS,
  isPredefinedProvider,
  type PredefinedProvider,
} from './predefined-providers.js';
import { parseAzureConfig } from './azure-validation.js';
import { deriveCustomDisplayName } from './custom-display-name.js';

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
  /**
   * Provider-specific config. `{}` for everything except Azure OpenAI,
   * where it carries the endpoint / api-version / deployments the
   * Settings dialog edits. Never holds secrets.
   */
  config: IntegrationConfig;
  /**
   * When true, members of teams this key is linked into may also use it
   * in their personal scope (personal projects / chats). Drives the
   * "Access" selector on the Integration tab: owner-only (no team links)
   * / team-only (links, flag off) / team + personal (links, flag on).
   */
  allowPersonalUse: boolean;
  /**
   * Monthly token usage cap for this key. null = no limit, 0 = paused,
   * >0 = enforced. See the schema comment on `integrations`.
   */
  monthlyTokenLimit: number | null;
  stats: IntegrationStats;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Validate + normalize an Azure OpenAI integration's config. Throws
 *  BadRequestException on anything that would make chat-transport fall
 *  back to OpenRouter (missing endpoint / api-version / deployments).
 *  Shares the rule set with onboarding via `parseAzureConfig`. */
function validateAzureConfig(
  config: IntegrationConfig | undefined,
): IntegrationConfig {
  const result = parseAzureConfig(config);
  if (!result.ok) throw new BadRequestException(result.reason);
  return result.config;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly modelsService: ModelsService,
  ) {}

  /**
   * Gate key mutations. A company key is shared with the whole company, so
   * only a company **admin** may add / edit / delete it — regular members
   * see keys (read-only) but can't change them. Personal-profile users have
   * no company; they manage their own keys, so they're always allowed.
   */
  private async assertCanManageKeys(userId: string): Promise<void> {
    const [u] = await this.db
      .select({ role: users.role, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // Company member (has a tenant) must be an admin; solo/personal users
    // manage their own keys.
    if (u?.companyId && u.role !== 'admin') {
      throw new ForbiddenException(
        'Only an admin can add or change company AI keys.',
      );
    }
  }

  /**
   * Ids of everyone in the caller's company (company-profile callers only;
   * empty for personal / solo accounts). AI keys are admin-managed at the
   * company level, so the Integration tab and the per-row mutation guard
   * treat a key added by any member as the company's key.
   */
  private async resolveCompanyMemberIds(userId: string): Promise<string[]> {
    const [u] = await this.db
      .select({ profileType: users.profileType, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const companyId = u?.profileType === 'company' ? u.companyId : null;
    if (!companyId) return [];
    const members = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.companyId, companyId));
    return members.map((m) => m.id);
  }

  /**
   * Per-row mutation guard. The owner can always change their own key.
   * Beyond that — because predefined/company keys are admin-managed
   * company-wide — a company admin may change a teamless key owned by
   * another member of the SAME company. (assertCanManageKeys already
   * confirmed the caller is an admin.) Team-scoped rows are handled by
   * the callers' own teamId guards.
   */
  private async assertCanMutateIntegrationRow(
    rowOwnerId: string,
    userId: string,
  ): Promise<void> {
    if (rowOwnerId === userId) return;
    const [caller] = await this.db
      .select({
        role: users.role,
        companyId: users.companyId,
        profileType: users.profileType,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (
      caller?.role === 'admin' &&
      caller.profileType === 'company' &&
      caller.companyId
    ) {
      const [owner] = await this.db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, rowOwnerId))
        .limit(1);
      if (owner?.companyId && owner.companyId === caller.companyId) return;
    }
    throw new ForbiddenException('Not your integration');
  }

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
    const callerRows = await this.db
      .select()
      .from(integrations)
      .where(
        and(eq(integrations.ownerId, userId), isNull(integrations.teamId)),
      );

    // AI keys are admin-managed company-wide, so the Integration tab must
    // reflect the company's keys — not just the caller's own rows. Pull
    // every teamless key owned by a company member so a key added by ONE
    // admin shows as enabled (with its config) on EVERY member's tab.
    // Empty for personal/solo accounts → behaviour unchanged.
    const companyMemberIds = await this.resolveCompanyMemberIds(userId);
    const companyRows =
      companyMemberIds.length > 0
        ? await this.db
            .select()
            .from(integrations)
            .where(
              and(
                inArray(integrations.ownerId, companyMemberIds),
                isNull(integrations.teamId),
              ),
            )
        : [];

    // Combined view (caller rows first, deduped by id) drives the custom
    // cards + alias/stat lookups below; the predefined loop picks its row
    // explicitly via `pickPredefinedRow` so a multi-member company resolves
    // deterministically (caller's own first, else the company key).
    const rowsById = new Map<string, (typeof callerRows)[number]>();
    for (const r of [...callerRows, ...companyRows]) {
      if (!rowsById.has(r.id)) rowsById.set(r.id, r);
    }
    const rows = Array.from(rowsById.values());
    const pickPredefinedRow = (providerId: string) => {
      const own = callerRows.find(
        (r) => r.providerId === providerId && r.apiUrl === null,
      );
      if (own) return own;
      const company = companyRows.filter(
        (r) => r.providerId === providerId && r.apiUrl === null,
      );
      return (
        company.find((r) => r.isEnabled && r.apiKeyEncrypted) ??
        company.find((r) => r.isEnabled) ??
        company[0]
      );
    };

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
      const row = pickPredefinedRow(p.id);
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
        config: row?.config ?? {},
        allowPersonalUse: row?.allowPersonalUse ?? false,
        monthlyTokenLimit: row?.monthlyTokenLimit ?? null,
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
        config: r.config ?? {},
        allowPersonalUse: r.allowPersonalUse,
        monthlyTokenLimit: r.monthlyTokenLimit,
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
      /** Required when providerId === "custom": the real model id the
       *  upstream OpenAI-compatible endpoint expects (e.g.
       *  "Qwen3.6-35B-A3B-FP8"). Stored on the bound alias as
       *  `upstreamModel` and sent as the `model` in the chat call —
       *  the synthetic `modelIdentifier` is only the picker id. */
      customModel?: string | null;
      /** Provider-specific config. Required (and validated) when
       *  providerId === "azure": endpoint + api-version + deployments. */
      config?: IntegrationConfig;
      /** When true, members of teams this key is linked into may also use
       *  it in personal scope. Defaults false on create. */
      allowPersonalUse?: boolean;
      /** Monthly token usage cap (null = no limit, 0 = paused, >0 =
       *  enforced). Omit to leave unset / unchanged. */
      monthlyTokenLimit?: number | null;
    },
  ): Promise<IntegrationView> {
    await this.assertCanManageKeys(userId);
    const isCustom = input.providerId === 'custom';
    const isAzure = input.providerId === 'azure';
    if (!isCustom && !isPredefinedProvider(input.providerId)) {
      throw new BadRequestException(`Unknown provider: ${input.providerId}`);
    }
    // Azure needs a complete config (endpoint / api-version /
    // deployments) or chat would silently fall back to OpenRouter.
    const azureConfig = isAzure ? validateAzureConfig(input.config) : {};
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
      if (!input.customModel?.trim()) {
        throw new BadRequestException(
          'Custom LLM requires the model id its endpoint expects',
        );
      }
    }

    const apiKeyEncrypted = input.apiKey?.trim()
      ? this.encryptionService.encrypt(input.apiKey.trim())
      : null;

    // Monthly token limit applies ONLY to Custom LLM (BYOK) integrations.
    // Predefined providers — whether or not the user added their own key —
    // never carry a per-key monthly limit; their usage is governed by the
    // budget tiers, not a token cap. Force null for non-custom so a stray
    // input can't re-introduce a limit.
    const monthlyTokenLimit = isCustom
      ? normalizeTokenLimit(input.monthlyTokenLimit)
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
          allowPersonalUse: input.allowPersonalUse ?? false,
          monthlyTokenLimit,
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
        upstreamModel: input.customModel!.trim(),
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
      if (input.allowPersonalUse !== undefined) {
        conflictUpdates.allowPersonalUse = input.allowPersonalUse;
      }
      if (input.monthlyTokenLimit !== undefined) {
        conflictUpdates.monthlyTokenLimit = monthlyTokenLimit;
      }
      // Azure config is validated above; persist it on conflict too so
      // re-saving from the Settings dialog updates the endpoint /
      // deployments. Non-azure providers never carry a config.
      if (isAzure) {
        conflictUpdates.config = azureConfig;
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
          config: azureConfig,
          allowPersonalUse: input.allowPersonalUse ?? false,
          monthlyTokenLimit,
        })
        .onConflictDoUpdate({
          target: [integrations.ownerId, integrations.providerId],
          targetWhere: sql`${integrations.apiUrl} IS NULL AND ${integrations.teamId} IS NULL`,
          set: conflictUpdates,
        });

      // Enabling a provider auto-provisions its whole catalog into the
      // Models tab; disabling removes those auto rows. Only act when the
      // caller explicitly set the enabled state (a toggle / first save),
      // not on unrelated edits (e.g. token-limit only) that leave
      // isEnabled untouched. Azure/custom are no-ops in the sync.
      if (input.isEnabled !== undefined) {
        await this.modelsService.syncProviderCatalogAliases(
          userId,
          input.providerId,
          input.isEnabled,
        );
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
    input: {
      isEnabled?: boolean;
      apiKey?: string | null;
      config?: IntegrationConfig;
      allowPersonalUse?: boolean;
      monthlyTokenLimit?: number | null;
    },
  ): Promise<IntegrationView> {
    await this.assertCanManageKeys(userId);
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    await this.assertCanMutateIntegrationRow(row.ownerId, userId);
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
    if (input.apiKey !== undefined) {
      updates.apiKeyEncrypted = input.apiKey
        ? this.encryptionService.encrypt(input.apiKey)
        : null;
    }
    if (input.allowPersonalUse !== undefined) {
      updates.allowPersonalUse = input.allowPersonalUse;
    }
    // Monthly token limit is a Custom-LLM-only setting (see upsert). For
    // predefined providers it's ignored so a limit can never be attached
    // to a non-custom key.
    if (input.monthlyTokenLimit !== undefined && row.providerId === 'custom') {
      updates.monthlyTokenLimit = normalizeTokenLimit(input.monthlyTokenLimit);
    }
    // Azure config edits (endpoint / api-version / deployments) come
    // through here when the Settings dialog patches an existing row.
    // Validated against the same rules as upsert; ignored for providers
    // that don't carry a config.
    if (input.config !== undefined && row.providerId === 'azure') {
      updates.config = validateAzureConfig(input.config);
    }
    await this.db
      .update(integrations)
      .set(updates)
      .where(eq(integrations.id, id));

    // Toggling a predefined provider on/off syncs its catalog into (or
    // out of) the Models tab. Custom rows are no-ops in the sync (they
    // route via their own bound alias, not a provider catalog).
    if (input.isEnabled !== undefined) {
      await this.modelsService.syncProviderCatalogAliases(
        userId,
        row.providerId,
        input.isEnabled,
      );
    }

    const all = await this.listForUser(userId);
    const view = all.find((v) => v.id === id);
    if (!view)
      throw new NotFoundException('Integration not found after update');
    return view;
  }

  /**
   * Month-to-date usage of a single key (BYOK / Custom integration),
   * broken down per user — so the owner can see who spent what on a key
   * they shared. Tokens are always present; cost ($) only where the
   * provider has catalog pricing (NULL for Custom LLMs → 0 here).
   *
   * Owner-only: a shared key's usage is the owner's to inspect. We don't
   * widen this to team admins for now (keeps it simple; the owner is the
   * one billed by the upstream provider). Throws if the caller isn't the
   * owner, mirroring `update` / `remove`.
   */
  async keyUsage(
    userId: string,
    id: string,
  ): Promise<{
    integrationId: string;
    monthlyTokenLimit: number | null;
    totalTokens: number;
    totalCostUsd: number;
    perUser: Array<{
      userId: string;
      name: string | null;
      email: string | null;
      tokens: number;
      costUsd: number;
      calls: number;
    }>;
  }> {
    const [row] = await this.db
      .select({
        ownerId: integrations.ownerId,
        monthlyTokenLimit: integrations.monthlyTokenLimit,
      })
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    await this.assertCanMutateIntegrationRow(row.ownerId, userId);

    const startOfMonth = sql`date_trunc('month', now())`;
    const rows = await this.db
      .select({
        userId: observabilityEvents.userId,
        name: users.name,
        email: users.email,
        tokens: sql<number>`coalesce(sum(${observabilityEvents.totalTokens}), 0)::int`,
        cost: sql<string>`coalesce(sum(${observabilityEvents.costUsd}), 0)::text`,
        calls: sql<number>`count(*)::int`,
      })
      .from(observabilityEvents)
      .leftJoin(users, eq(users.id, observabilityEvents.userId))
      .where(
        and(
          eq(observabilityEvents.integrationId, id),
          eq(observabilityEvents.success, true),
          gte(observabilityEvents.createdAt, startOfMonth),
        ),
      )
      .groupBy(observabilityEvents.userId, users.name, users.email)
      .orderBy(sql`sum(${observabilityEvents.totalTokens}) desc nulls last`);

    const perUser = rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      tokens: Number(r.tokens ?? 0),
      costUsd: Number(r.cost ?? 0),
      calls: Number(r.calls ?? 0),
    }));
    return {
      integrationId: id,
      monthlyTokenLimit: row.monthlyTokenLimit,
      totalTokens: perUser.reduce((s, u) => s + u.tokens, 0),
      totalCostUsd: perUser.reduce((s, u) => s + u.costUsd, 0),
      perUser,
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertCanManageKeys(userId);
    const [row] = await this.db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id));
    if (!row) throw new NotFoundException('Integration not found');
    await this.assertCanMutateIntegrationRow(row.ownerId, userId);
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
/**
 * Normalize a caller-supplied monthly token limit to the column's
 * tri-state contract: null = no limit, 0 = paused, >0 = enforced.
 * `undefined` stays `undefined` so callers can distinguish "leave
 * unchanged" from "clear" — only invoked when the field is present.
 * Non-finite / negative values clamp to null (treated as "no limit")
 * rather than throwing, so a stray FE value can't 500 the save.
 */
function normalizeTokenLimit(
  value: number | null | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  // Clamp to the Postgres `integer` max so a huge FE value saves as the
  // ceiling instead of throwing "value out of range for type integer"
  // (a 500 on the save endpoint).
  const PG_INT_MAX = 2_147_483_647;
  return Math.min(Math.floor(value), PG_INT_MAX);
}

function userCustomModelIdentifier(userId: string, customName: string): string {
  const slug = customName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const userShort = userId.slice(0, 8);
  return `user:${userShort}:${slug || 'custom'}`;
}
