import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  teamIntegrationLinks,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { isAnthropicNativeSupported } from '../integrations/anthropic-client.service.js';
import { providerOfModel } from '../integrations/native-endpoints.js';
import {
  OpenRouterCatalogService,
  type CatalogModel,
} from './openrouter-catalog.service.js';

/**
 * What a model picker (arena, project chat, …) should show for a user.
 * Aliases first (preserve their custom name), then any catalog model
 * for a provider where the user has an enabled BYOK key — those are
 * implicitly unlocked because chat-transport routes them through the
 * user's own provider account.
 */
export interface EffectiveModel {
  id: string;
  name: string;
  /** "alias" = backed by a model_configs row; "byok" = unlocked via a
   *  BYOK key on the model's provider; "custom" = bound to a Custom LLM
   *  integration (alias with integrationId set). */
  source: 'alias' | 'byok' | 'custom';
  /** Where chat-transport will actually route a chat call for this
   *  model. Independent of `source`: an alias on a provider the user
   *  has BYOK for routes via 'byok', and a 'byok' catalog entry for
   *  an Anthropic slug not supported on native routes via 'workenai'
   *  (falls through to the OpenRouter default key). Drives the
   *  "(BYOK)" / "(Custom)" marker in pickers so users can tell whose
   *  tokens get billed. */
  routing: 'workenai' | 'byok' | 'custom';
  /** Set when source === "alias" or "custom". Lets the FE deep-link to
   *  Models tab edit. */
  aliasId?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

@Injectable()
export class ModelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly catalogService: OpenRouterCatalogService,
  ) {}

  /**
   * Build the scope filter shared by `findAll` (Manage Models tab)
   * and `listEffectiveForUser` (pickers / arena), so what a user
   * sees in management matches what they can actually pick.
   *
   * Visibility model — mirrors how `knowledge_files.scope` works,
   * keyed on the caller's tenant (`users.company_id` UUID):
   *   - company-profile caller with a resolved `companyId`: every
   *     `teamId IS NULL` alias owned by a tenant member is the
   *     company-wide model pool, plus team-scoped rows for any
   *     team the caller is an accepted member of / owns.
   *   - personal / pre-onboarding / mid-onboarding caller (no
   *     `companyId`): only the caller's own `teamId IS NULL`
   *     aliases, plus their team-scoped rows. Personal accounts
   *     don't share with anyone.
   *
   * Tenant key is `companyId` (UUID), not `profileType` alone —
   * the prior code surfaced every `profileType='company' OR NULL`
   * user across the whole deployment, which leaked model aliases
   * across distinct tenants.
   *
   * Edit / delete permissions are not relaxed by this — they
   * still gate on `ownerId === caller` in `update` / `remove`.
   * Company users can SEE every model_config in their tenant, but
   * only the owner (or admin in a follow-up PR) can mutate it.
   */
  private async resolveAliasScopeFilter(callerId: string) {
    const [caller] = await this.db
      .select({
        profileType: users.profileType,
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.id, callerId));

    const memberRows = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, callerId),
          eq(teamMembers.status, 'accepted'),
        ),
      );
    const ownedRows = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, callerId));
    const teamIds = Array.from(
      new Set([
        ...memberRows.map((r) => r.teamId),
        ...ownedRows.map((r) => r.id),
      ]),
    );

    // Company-tenant callers get the `teamId IS NULL` pool, but
    // ONLY rows whose owner sits in the SAME tenant (`companyId`
    // match). Without that filter, an independent Private Pro
    // account on the same deployment — or any OTHER tenant's
    // company users — would leak their teamless aliases into this
    // caller's company list. Personal / pre-onboarding / mid-
    // onboarding callers (no `companyId`) see only their own
    // teamless rows; their account is isolated by definition.
    let orgPoolFilter;
    const callerCompanyId =
      caller?.profileType === 'company' ? caller.companyId : null;
    if (callerCompanyId) {
      const tenantMembers = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.companyId, callerCompanyId));
      const tenantMemberIds = tenantMembers.map((u) => u.id);
      // Defensive: if for some reason the tenant has no resolved
      // members (shouldn't happen — the caller themselves is one),
      // short-circuit to the personal filter so we never accidentally
      // pass an empty inArray (Postgres treats `IN ()` as always-
      // false but Drizzle's inArray rejects empty arrays loudly).
      orgPoolFilter =
        tenantMemberIds.length > 0
          ? and(
              inArray(modelConfigs.ownerId, tenantMemberIds),
              isNull(modelConfigs.teamId),
            )
          : and(
              eq(modelConfigs.ownerId, callerId),
              isNull(modelConfigs.teamId),
            );
    } else {
      orgPoolFilter = and(
        eq(modelConfigs.ownerId, callerId),
        isNull(modelConfigs.teamId),
      );
    }

    return teamIds.length > 0
      ? or(orgPoolFilter, inArray(modelConfigs.teamId, teamIds))
      : orgPoolFilter;
  }

  /**
   * Models the caller can see in the /teams "Models" management tab.
   * Same scope as `listEffectiveForUser`, except inactive rows are
   * included so the user can toggle them back on.
   */
  async findAll(callerId: string) {
    const scopeFilter = await this.resolveAliasScopeFilter(callerId);

    // Stable ORDER so the FE table doesn't jump rows around when a
    // user toggles isActive (or anything else). Postgres returns
    // rows in arbitrary heap order without ORDER BY, and the order
    // can shift after each UPDATE — the user perceives the table as
    // "jumping". `createdAt ASC` is stable per row, doesn't change
    // on update, and matches what the user-facing list typically
    // shows (oldest first). `id` as a secondary key handles the
    // tiebreak when two rows share a createdAt.
    return this.db
      .select()
      .from(modelConfigs)
      .where(scopeFilter)
      .orderBy(asc(modelConfigs.createdAt), asc(modelConfigs.id));
  }

  /**
   * Models the FE should surface in pickers (arena, project create, …)
   * for a given user.
   *
   *  - Active model_configs aliases (one entry each, custom name as label).
   *  - Plus every catalog model whose provider has an enabled BYOK row
   *    with an api key in `integrations`. The user has explicitly opted
   *    in to using their own provider account for that whole vendor;
   *    surfacing the full catalog there saves them from manually
   *    aliasing every model they want to try.
   *
   * Aliases dedupe over catalog entries on the same modelIdentifier —
   * the user's custom name and (if present) Custom LLM binding take
   * precedence.
   */
  async listEffectiveForUser(userId: string): Promise<EffectiveModel[]> {
    // Aliases the user can pick from. Scope rules (see
    // `resolveAliasScopeFilter` for the full breakdown):
    //   - company profile → org-wide `teamId IS NULL` pool +
    //     team-scoped rows for teams the user is in
    //   - personal profile → only own `teamId IS NULL` rows +
    //     team-scoped rows
    // The team-scope branch is what makes Custom LLMs that admin
    // shared with TEAM_X show up in a member's picker.
    const scopeFilter = await this.resolveAliasScopeFilter(userId);
    const aliasRows = await this.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.isActive, true), scopeFilter));

    // Team list still needed below for the BYOK branch — pull it
    // here rather than reaching into the helper internals.
    const teamMemberships = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'accepted')),
      );
    const ownedTeams = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, userId));
    const teamIds = Array.from(
      new Set([
        ...teamMemberships.map((r) => r.teamId),
        ...ownedTeams.map((t) => t.id),
      ]),
    );

    // Every predefined provider that's enabled either personally OR
    // at the scope of any team the user is in. Without the team
    // branch, a member of TEAM_X (admin set up Anthropic) couldn't
    // see Claude in their picker unless they ALSO toggled Anthropic
    // personally — defeats the point of team-shared keys.
    //
    // We enable on isEnabled regardless of whether a key is set:
    // an enabled row without a BYOK key falls back to the WorkenAI
    // default route in chat-transport (OpenRouter), which is a
    // first-class option the user opted into via the "Use WORKENAI
    // API" path. chat-transport picks the right key per call based
    // on the chat's team scope.
    const personalEnabledRows = await this.db
      .select({ providerId: integrations.providerId })
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          isNull(integrations.teamId),
          eq(integrations.isEnabled, true),
        ),
      );
    // Team enabled providers come through the link table now: an
    // admin's personal integration linked to one of the caller's
    // teams counts only if both the link's is_enabled and the
    // integration's is_enabled are true. Mirrors the chat-transport
    // BYOK lookup so this surface stays in sync with what chat
    // would actually use at request time.
    const teamEnabledRows =
      teamIds.length > 0
        ? await this.db
            .select({ providerId: integrations.providerId })
            .from(teamIntegrationLinks)
            .innerJoin(
              integrations,
              eq(integrations.id, teamIntegrationLinks.integrationId),
            )
            .where(
              and(
                inArray(teamIntegrationLinks.teamId, teamIds),
                eq(teamIntegrationLinks.isEnabled, true),
                eq(integrations.isEnabled, true),
              ),
            )
        : [];
    const enabledProviders = new Set(
      [...personalEnabledRows, ...teamEnabledRows]
        .map((r) => r.providerId)
        .filter((id) => id !== 'custom'), // custom routes via aliases, not provider lookup
    );

    // Azure has no OpenRouter catalog (it isn't an OpenRouter slug), so
    // its selectable models are the deployments the user configured on
    // the integration. Collect the configs from every enabled azure
    // integration (personal + team-linked) so we can synthesize one
    // `azure/<deployment>` entry per deployment below.
    const azureConfigs: {
      azureDeployments?: { deploymentName: string; label: string }[];
    }[] = [];
    if (enabledProviders.has('azure')) {
      const personalAzure = await this.db
        .select({ config: integrations.config })
        .from(integrations)
        .where(
          and(
            eq(integrations.ownerId, userId),
            isNull(integrations.teamId),
            eq(integrations.providerId, 'azure'),
            eq(integrations.isEnabled, true),
          ),
        );
      const teamAzure =
        teamIds.length > 0
          ? await this.db
              .select({ config: integrations.config })
              .from(teamIntegrationLinks)
              .innerJoin(
                integrations,
                eq(integrations.id, teamIntegrationLinks.integrationId),
              )
              .where(
                and(
                  inArray(teamIntegrationLinks.teamId, teamIds),
                  eq(teamIntegrationLinks.isEnabled, true),
                  eq(integrations.providerId, 'azure'),
                  eq(integrations.isEnabled, true),
                ),
              )
          : [];
      azureConfigs.push(
        ...personalAzure.map((r) => r.config),
        ...teamAzure.map((r) => r.config),
      );
    }

    // Mirror chat-transport's routing decision so the picker marker
    // matches what a chat call will actually do. Returns:
    //   - 'custom'   for aliases bound to a Custom LLM integration
    //   - 'byok'     when chat-transport will honour the user's BYOK key
    //   - 'workenai' for fallback to the OpenRouter default route
    // The Anthropic native shim has a blocklist (-fast, Opus 4.6, bare
    // family ids) that falls back to OpenRouter even with a BYOK key
    // set — we apply isAnthropicNativeSupported here so the picker
    // doesn't promise "(BYOK)" for slugs we'd actually route via
    // OpenRouter.
    const computeRouting = (
      modelId: string,
      hasCustomIntegration: boolean,
    ): EffectiveModel['routing'] => {
      if (hasCustomIntegration) return 'custom';
      const provider = providerOfModel(modelId);
      if (!provider || !enabledProviders.has(provider)) return 'workenai';
      if (provider === 'anthropic' && !isAnthropicNativeSupported(modelId)) {
        return 'workenai';
      }
      return 'byok';
    };

    const out: EffectiveModel[] = [];
    const seen = new Set<string>();

    for (const a of aliasRows) {
      if (seen.has(a.modelIdentifier)) continue;
      seen.add(a.modelIdentifier);
      out.push({
        id: a.modelIdentifier,
        name: a.customName,
        source: a.integrationId ? 'custom' : 'alias',
        routing: computeRouting(a.modelIdentifier, !!a.integrationId),
        aliasId: a.id,
      });
    }

    if (enabledProviders.size > 0) {
      const catalog = await this.catalogService.list();
      for (const m of catalog) {
        if (seen.has(m.id)) continue;
        const slash = m.id.indexOf('/');
        if (slash === -1) continue;
        const provider = m.id.slice(0, slash);
        if (!enabledProviders.has(provider)) continue;
        seen.add(m.id);
        out.push({
          id: m.id,
          name: m.name,
          source: 'byok',
          routing: computeRouting(m.id, false),
          description: m.description,
          context_length: m.context_length,
          pricing: m.pricing,
        });
      }
    }

    // Synthesize Azure deployments as selectable models. Id is
    // `azure/<deploymentName>` so providerOfModel() resolves "azure" and
    // chat-transport routes the call through the AzureOpenAI client with
    // the deployment as the model. Deduped against aliases/catalog above.
    for (const cfg of azureConfigs) {
      for (const dep of cfg?.azureDeployments ?? []) {
        const name = dep?.deploymentName?.trim();
        if (!name) continue;
        const id = `azure/${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name: dep.label?.trim() || name,
          source: 'byok',
          routing: computeRouting(id, false),
        });
      }
    }

    return out;
  }

  /**
   * End-user view: the full OpenRouter catalog. Drives the FE model
   * pickers (AddModelDialog, arena, project create). No admin curation
   * layer — every catalog entry is always selectable.
   */
  async listAvailable(): Promise<CatalogModel[]> {
    return this.catalogService.list();
  }

  async create(
    ownerId: string,
    data: {
      customName: string;
      modelIdentifier: string;
      fallbackModels?: string[];
      integrationId?: string | null;
    },
  ) {
    const [model] = await this.db
      .insert(modelConfigs)
      .values({
        ownerId,
        customName: data.customName,
        modelIdentifier: data.modelIdentifier,
        fallbackModels: data.fallbackModels ?? [],
        integrationId: data.integrationId ?? null,
      })
      .returning();

    return model;
  }

  async update(
    id: string,
    userId: string,
    data: {
      customName?: string;
      modelIdentifier?: string;
      isActive?: boolean;
      fallbackModels?: string[];
      integrationId?: string | null;
    },
  ) {
    const [model] = await this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, id));

    if (!model) throw new NotFoundException('Model config not found');
    if (model.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can update this model');
    }

    const updates: Record<string, unknown> = {};
    if (data.customName !== undefined) updates.customName = data.customName;
    if (data.modelIdentifier !== undefined)
      updates.modelIdentifier = data.modelIdentifier;
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.fallbackModels !== undefined)
      updates.fallbackModels = data.fallbackModels;
    if (data.integrationId !== undefined)
      updates.integrationId = data.integrationId;

    if (Object.keys(updates).length === 0) return model;

    const [updated] = await this.db
      .update(modelConfigs)
      .set(updates)
      .where(eq(modelConfigs.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    const [model] = await this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.id, id));

    if (!model) throw new NotFoundException('Model config not found');
    if (model.ownerId !== userId) {
      throw new ForbiddenException('Only the owner can delete this model');
    }

    await this.db.delete(modelConfigs).where(eq(modelConfigs.id, id));
    return { success: true };
  }
}
