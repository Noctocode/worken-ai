import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type SQL, and, asc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import {
  integrations,
  modelConfigs,
  teamIntegrationLinks,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { isAnthropicNativeSupported } from '../integrations/anthropic-client.service.js';
import { providerOfModel } from '../integrations/native-endpoints.js';
import {
  ownerStillOnTeam,
  resolveUserTeamIds,
} from '../teams/team-membership.util.js';
import {
  OpenRouterCatalogService,
  type CatalogModel,
} from './openrouter-catalog.service.js';

/**
 * Marker for "the selected model isn't in the user's curated list" —
 * its alias was disabled or deleted in Management → Models (or it was
 * never enabled). Mirrors the budget/key markers in chat-transport: the
 * FE humanizer (chat-errors.ts) matches on `MODEL_UNAVAILABLE:` and
 * shows the actionable message verbatim. Used by chat, arena, and AI
 * cron so a stale model selection fails with a clear "why + how to fix"
 * instead of silently falling back to a different route.
 */
export const MODEL_UNAVAILABLE_MARKER = 'MODEL_UNAVAILABLE';

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
   * Edit / delete permissions are handled separately in `update` /
   * `remove` via `assertCanMutateModel`: the owner, or a company
   * admin acting within the same tenant, may mutate a model. Company
   * users can SEE every model_config in their tenant but basic
   * members can't mutate ones they don't own.
   */
  private async resolveAliasScopeFilter(
    callerId: string,
  ): Promise<SQL<unknown> | undefined> {
    const [caller] = await this.db
      .select({
        profileType: users.profileType,
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.id, callerId));

    const teamIds = await resolveUserTeamIds(this.db, callerId);

    // Company-tenant callers get the `teamId IS NULL` pool, but
    // ONLY rows whose owner sits in the SAME tenant (`companyId`
    // match). Without that filter, an independent Private Pro
    // account on the same deployment — or any OTHER tenant's
    // company users — would leak their teamless aliases into this
    // caller's company list. Personal / pre-onboarding / mid-
    // onboarding callers (no `companyId`) see only their own
    // teamless rows; their account is isolated by definition.
    let orgPoolFilter: SQL<unknown> | undefined;
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
   * Ids of everyone sharing the caller's company (company-profile callers
   * only; empty for personal / pre-onboarding accounts). A key any member
   * (an admin — only admins can add) configures is available company-wide,
   * so these ids drive company-wide key visibility in the picker.
   */
  private async resolveCompanyMemberIds(callerId: string): Promise<string[]> {
    const [caller] = await this.db
      .select({ profileType: users.profileType, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, callerId));
    const companyId =
      caller?.profileType === 'company' ? caller.companyId : null;
    if (!companyId) return [];
    const members = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.companyId, companyId));
    return members.map((m) => m.id);
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
   *  - Plus explicitly-configured Azure deployments (Azure has no
   *    catalog, so its deployments are the selectable entries).
   *
   * Models are admin-curated under the Models tab: there is NO BYOK
   * catalog expansion. An enabled provider key only changes how an
   * existing alias routes (BYOK vs WorkenAI default) — it does not
   * auto-surface that provider's whole catalog. To make a model
   * selectable, an admin adds an alias for it.
   */
  async listEffectiveForUser(
    userId: string,
    scope?: { teamId: string | null },
  ): Promise<EffectiveModel[]> {
    // Aliases the user can pick from. Scope rules (see
    // `resolveAliasScopeFilter` for the full breakdown):
    //   - company profile → org-wide `teamId IS NULL` pool +
    //     team-scoped rows for teams the user is in
    //   - personal profile → only own `teamId IS NULL` rows +
    //     team-scoped rows
    // The team-scope branch is what makes Custom LLMs that admin
    // shared with TEAM_X show up in a member's picker.
    //
    // When an explicit `scope` is passed (the Create Project picker),
    // narrow to exactly that scope so a personal project shows only the
    // caller's personal keys and a team project shows only what's
    // enabled at THAT team — and a Custom LLM that's both personal AND
    // team-linked doesn't appear twice. No scope = the full union used
    // by the arena / chat pickers (unchanged).
    // Resolve team membership up-front — it's needed both for the BYOK
    // branch and to authorize a team scope BEFORE running any alias /
    // provider queries, so an unauthorized scope costs nothing.
    const allTeamIds = await resolveUserTeamIds(this.db, userId);
    // Defensive authz: an explicit team scope the caller isn't a member of
    // (or owner) — including a blank / malformed team id — returns nothing
    // rather than leaking another team's pool. Checked before any pool
    // query runs.
    if (scope && scope.teamId !== null && !allTeamIds.includes(scope.teamId)) {
      return [];
    }
    // Which teams' linked BYOK/Azure keys to surface for THIS scope, and
    // whether to include the caller's personal keys:
    //   - no scope     → every team + personal (union)
    //   - personal     → personal only, no team-linked keys
    //   - team X        → team X only, no personal keys
    const teamIds = scope ? (scope.teamId ? [scope.teamId] : []) : allTeamIds;
    const includePersonalProviders = !scope || scope.teamId === null;

    // Personal-scope only: keys an admin explicitly shared for personal
    // use. A team-linked integration with allow_personal_use=true lets
    // members of that team pick it in their OWN personal projects/chats,
    // not just inside the team. We only run this for the explicit
    // personal scope (scope.teamId === null) — the no-scope union already
    // surfaces every team key via `teamIds = allTeamIds`, and a team
    // scope shows that team's keys regardless of the flag. Both the link
    // and the underlying integration must be enabled, mirroring the team
    // BYOK/custom gating below.
    const personalUseSharedRaw =
      scope?.teamId === null && allTeamIds.length > 0
        ? await this.db
            .select({
              id: integrations.id,
              providerId: integrations.providerId,
              config: integrations.config,
            })
            .from(teamIntegrationLinks)
            .innerJoin(
              integrations,
              eq(integrations.id, teamIntegrationLinks.integrationId),
            )
            .where(
              and(
                inArray(teamIntegrationLinks.teamId, allTeamIds),
                eq(teamIntegrationLinks.isEnabled, true),
                eq(integrations.isEnabled, true),
                eq(integrations.allowPersonalUse, true),
                // Hide the shared key once its owner is no longer on the
                // linked team (stale link), mirroring chat-transport.
                ownerStillOnTeam(
                  teamIntegrationLinks.teamId,
                  integrations.ownerId,
                ),
              ),
            )
        : [];
    // An integration linked into several of the caller's teams comes back
    // once per link — dedupe by integration id so it's counted once.
    const personalUseShared = Array.from(
      new Map(personalUseSharedRaw.map((r) => [r.id, r])).values(),
    );
    const sharedCustomIds = personalUseShared
      .filter((r) => r.providerId === 'custom')
      .map((r) => r.id);

    // Company-wide keys: any enabled integration owned by a company member
    // (admin-added — only admins can add) is available to EVERY member.
    // Surfaced in the personal + no-scope pickers; a team scope already
    // shows that team's keys, so we skip the lookup there.
    const companyMemberIds = includePersonalProviders
      ? await this.resolveCompanyMemberIds(userId)
      : [];
    const companyIntegrations =
      companyMemberIds.length > 0
        ? await this.db
            .select({
              id: integrations.id,
              providerId: integrations.providerId,
              config: integrations.config,
            })
            .from(integrations)
            .where(
              and(
                inArray(integrations.ownerId, companyMemberIds),
                isNull(integrations.teamId),
                eq(integrations.isEnabled, true),
              ),
            )
        : [];
    const companyCustomIds = companyIntegrations
      .filter((r) => r.providerId === 'custom')
      .map((r) => r.id);
    // Custom integration ids whose aliases must surface in the personal-scope
    // picker: team-shared (allow_personal_use) + company-wide.
    const personalCustomAliasIds = Array.from(
      new Set([...sharedCustomIds, ...companyCustomIds]),
    );

    // Aliases the user can pick from, narrowed to `scope` when given
    // (see the doc comment above). No scope = the full union. For the
    // personal scope we also pull in team-scoped aliases bound to a
    // shared custom integration so the Custom LLM shows up with its
    // proper name (predefined/BYOK providers surface via the catalog
    // loop, so they don't need this).
    const aliasScopeFilter: SQL<unknown> | undefined = scope
      ? scope.teamId === null
        ? personalCustomAliasIds.length > 0
          ? or(
              and(
                eq(modelConfigs.ownerId, userId),
                isNull(modelConfigs.teamId),
              ),
              inArray(modelConfigs.integrationId, personalCustomAliasIds),
            )
          : and(eq(modelConfigs.ownerId, userId), isNull(modelConfigs.teamId))
        : eq(modelConfigs.teamId, scope.teamId)
      : await this.resolveAliasScopeFilter(userId);
    const aliasRows = await this.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.isActive, true), aliasScopeFilter));

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
    const personalEnabledRows = includePersonalProviders
      ? await this.db
          .select({ providerId: integrations.providerId })
          .from(integrations)
          .where(
            and(
              eq(integrations.ownerId, userId),
              isNull(integrations.teamId),
              eq(integrations.isEnabled, true),
            ),
          )
      : [];
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
                // Don't surface a key whose owner has left the linked team.
                ownerStillOnTeam(
                  teamIntegrationLinks.teamId,
                  integrations.ownerId,
                ),
              ),
            )
        : [];
    const enabledProviders = new Set(
      // personalEnabledRows is already empty unless includePersonalProviders.
      // personalUseShared is already empty unless this is the personal scope.
      // companyIntegrations is already empty unless includePersonalProviders.
      [
        ...personalEnabledRows,
        ...teamEnabledRows,
        ...personalUseShared,
        ...companyIntegrations,
      ]
        .map((r) => r.providerId)
        .filter((id) => id !== 'custom'), // custom routes via aliases, not provider lookup
    );

    // Custom LLMs route via aliases (not the provider lookup above), so we
    // gate them the same way BYOK is gated: a custom alias only stays in the
    // pool if its backing integration is enabled — and for a team scope the
    // team link must be enabled too. This mirrors chat-transport's custom
    // route, so a disabled integration / paused team link removes the model
    // from the picker instead of leaving a dead entry that chat would reject.
    const enabledCustomIntegrationIds = new Set<string>();
    if (includePersonalProviders) {
      const personalCustom = await this.db
        .select({ id: integrations.id })
        .from(integrations)
        .where(
          and(
            eq(integrations.ownerId, userId),
            isNull(integrations.teamId),
            eq(integrations.providerId, 'custom'),
            eq(integrations.isEnabled, true),
          ),
        );
      personalCustom.forEach((r) => enabledCustomIntegrationIds.add(r.id));
    }
    if (teamIds.length > 0) {
      const teamCustom = await this.db
        .select({ id: integrations.id })
        .from(teamIntegrationLinks)
        .innerJoin(
          integrations,
          eq(integrations.id, teamIntegrationLinks.integrationId),
        )
        .where(
          and(
            inArray(teamIntegrationLinks.teamId, teamIds),
            eq(teamIntegrationLinks.isEnabled, true),
            eq(integrations.providerId, 'custom'),
            eq(integrations.isEnabled, true),
            ownerStillOnTeam(teamIntegrationLinks.teamId, integrations.ownerId),
          ),
        );
      teamCustom.forEach((r) => enabledCustomIntegrationIds.add(r.id));
    }
    // Custom keys shared for personal use (personal scope only).
    sharedCustomIds.forEach((id) => enabledCustomIntegrationIds.add(id));
    // Company-wide custom keys (admin-added) — available to every member.
    companyCustomIds.forEach((id) => enabledCustomIntegrationIds.add(id));

    // Azure has no OpenRouter catalog (it isn't an OpenRouter slug), so
    // its selectable models are the deployments the user configured on
    // the integration. Collect the configs from every enabled azure
    // integration (personal + team-linked) so we can synthesize one
    // `azure/<deployment>` entry per deployment below.
    const azureConfigs: {
      azureDeployments?: { deploymentName: string; label: string }[];
    }[] = [];
    if (enabledProviders.has('azure')) {
      const personalAzure = includePersonalProviders
        ? await this.db
            .select({ config: integrations.config })
            .from(integrations)
            .where(
              and(
                eq(integrations.ownerId, userId),
                isNull(integrations.teamId),
                eq(integrations.providerId, 'azure'),
                eq(integrations.isEnabled, true),
              ),
            )
        : [];
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
                  ownerStillOnTeam(
                    teamIntegrationLinks.teamId,
                    integrations.ownerId,
                  ),
                ),
              )
          : [];
      // personalAzure is already empty unless includePersonalProviders.
      // personalUseShared azure configs cover the personal-scope case
      // where the user only reaches Azure through a shared team key.
      azureConfigs.push(
        ...personalAzure.map((r) => r.config),
        ...teamAzure.map((r) => r.config),
        ...personalUseShared
          .filter((r) => r.providerId === 'azure')
          .map((r) => r.config),
        // Company-wide Azure key (admin-added) — deployments available to all.
        ...companyIntegrations
          .filter((r) => r.providerId === 'azure')
          .map((r) => r.config),
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
      // A custom alias (bound to an integration) only shows when that
      // integration — and, in a team scope, its team link — is enabled.
      // Predefined aliases (integrationId null) fall back to BYOK/OpenRouter
      // and are unaffected.
      if (
        a.integrationId &&
        !enabledCustomIntegrationIds.has(a.integrationId)
      ) {
        continue;
      }
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

    // NOTE: no BYOK "catalog expansion" here. Models are admin-curated
    // under the Models tab — the picker surfaces exactly the active
    // aliases (above) plus explicitly-configured Azure deployments
    // (below). Having an enabled provider key no longer auto-surfaces
    // that provider's entire catalog; an admin must add an alias for
    // any model they want selectable. `enabledProviders` still drives
    // the BYOK/workenai routing marker on aliases via computeRouting.

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

  /**
   * The set of model ids the user can actually use in a given scope —
   * exactly what `listEffectiveForUser` would surface in the picker.
   * Callers (chat / arena / cron) use it to reject a stale selection
   * before a request runs.
   */
  async availableModelIds(
    userId: string,
    scope?: { teamId: string | null },
  ): Promise<Set<string>> {
    const effective = await this.listEffectiveForUser(userId, scope);
    return new Set(effective.map((m) => m.id));
  }

  /** Actionable "this model can't be used" sentence, marker-prefixed so
   *  the FE humanizer (chat-errors.ts) shows it verbatim. */
  modelUnavailableMessage(modelId: string): string {
    return `${MODEL_UNAVAILABLE_MARKER}: "${modelId}" is no longer available — it was disabled or removed in Management → Models. Ask an admin to enable it there, or pick a different model.`;
  }

  /** Ready-to-throw 422 carrying {@link modelUnavailableMessage}. */
  modelUnavailableError(modelId: string): HttpException {
    return new HttpException(this.modelUnavailableMessage(modelId), 422);
  }

  /**
   * Given a primary model and its configured fallbacks (in order), return
   * the first one that's actually usable (curated/active), or null when
   * none are. This is what lets a disabled primary fall back to an enabled
   * alternate — and surfaces MODEL_UNAVAILABLE only when the primary AND
   * every fallback are unavailable. Pure: callers pass the available set.
   */
  firstAvailableModel(
    candidates: string[],
    available: Set<string>,
  ): string | null {
    return candidates.find((c) => available.has(c)) ?? null;
  }

  /**
   * Throw a clear, actionable MODEL_UNAVAILABLE error when `modelId`
   * isn't in the user's curated/effective list (alias disabled, deleted,
   * or never enabled). Returns silently when the model is usable. Pass a
   * pre-fetched id set to avoid re-querying when checking several models.
   */
  async assertModelAvailable(
    userId: string,
    modelId: string,
    scope?: { teamId: string | null },
    available?: Set<string>,
  ): Promise<void> {
    const ids = available ?? (await this.availableModelIds(userId, scope));
    if (ids.has(modelId)) return;
    throw this.modelUnavailableError(modelId);
  }

  /**
   * Gate model creation. Models are admin-managed at the company level
   * (the /teams "Models" tab is an admin surface), so a company member
   * must be an admin to add one — mirrors integrations' assertCanManageKeys
   * and the owner-or-admin rule in assertCanMutateModel. Personal / solo
   * accounts (no company tenant) manage their own models, so they're
   * always allowed.
   */
  private async assertCanCreateModel(userId: string): Promise<void> {
    const [u] = await this.db
      .select({ role: users.role, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (u?.companyId && u.role !== 'admin') {
      throw new ForbiddenException('Only an admin can add company models.');
    }
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
    await this.assertCanCreateModel(ownerId);
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

  /**
   * Sync a predefined provider's whole catalog into the Models tab when
   * its BYOK key is enabled, and remove it again when disabled. Driven
   * by the provider enable/disable toggle in integrations.
   *
   *  - enable  → insert one active alias per catalog model of `providerId`
   *              that the owner doesn't already have (auto_provisioned=true).
   *              Manually-added aliases for the same model are left as-is.
   *  - disable → delete only the auto-provisioned aliases for that
   *              provider; manual aliases (auto_provisioned=false) survive.
   *
   * Custom and Azure are skipped: 'custom' has no catalog (it routes via
   * a bound alias) and Azure's selectable models are explicit deployments,
   * not a catalog. No-ops for any provider with no catalog entries.
   */
  async syncProviderCatalogAliases(
    ownerId: string,
    providerId: string,
    enabled: boolean,
  ): Promise<void> {
    if (providerId === 'custom' || providerId === 'azure') return;

    if (!enabled) {
      await this.db
        .delete(modelConfigs)
        .where(
          and(
            eq(modelConfigs.ownerId, ownerId),
            isNull(modelConfigs.teamId),
            eq(modelConfigs.autoProvisioned, true),
            like(modelConfigs.modelIdentifier, `${providerId}/%`),
          ),
        );
      return;
    }

    const catalog = await this.catalogService.list();
    const providerModels = catalog.filter(
      (m) => providerOfModel(m.id) === providerId,
    );
    if (providerModels.length === 0) return;

    // Skip identifiers the owner already has (manual OR previously
    // auto-provisioned) so re-enabling never duplicates a row.
    const existing = await this.db
      .select({ modelIdentifier: modelConfigs.modelIdentifier })
      .from(modelConfigs)
      .where(
        and(eq(modelConfigs.ownerId, ownerId), isNull(modelConfigs.teamId)),
      );
    const existingIds = new Set(existing.map((e) => e.modelIdentifier));

    const toInsert = providerModels
      .filter((m) => !existingIds.has(m.id))
      .map((m) => ({
        ownerId,
        teamId: null,
        customName: m.name,
        modelIdentifier: m.id,
        integrationId: null,
        isActive: true,
        autoProvisioned: true,
      }));
    if (toInsert.length > 0) {
      await this.db.insert(modelConfigs).values(toInsert);
    }
  }

  /**
   * Mutation guard for a single model_config. The owner can always
   * edit/delete their own alias. Beyond that, a company admin manages
   * the whole tenant's model catalog (the /teams "Models" tab is an
   * admin surface), so an admin may mutate any model whose owner sits
   * in the SAME company tenant. Personal profiles have no tenant, so
   * they fall back to owner-only.
   */
  private async assertCanMutateModel(
    model: typeof modelConfigs.$inferSelect,
    userId: string,
    action: 'update' | 'delete',
  ): Promise<void> {
    if (model.ownerId === userId) return;

    const [caller] = await this.db
      .select({
        role: users.role,
        companyId: users.companyId,
        profileType: users.profileType,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (
      caller?.role === 'admin' &&
      caller.profileType === 'company' &&
      caller.companyId
    ) {
      const [owner] = await this.db
        .select({ companyId: users.companyId })
        .from(users)
        .where(eq(users.id, model.ownerId));
      if (owner?.companyId && owner.companyId === caller.companyId) return;
    }

    throw new ForbiddenException(
      action === 'delete'
        ? 'Only the owner or a company admin can delete this model'
        : 'Only the owner or a company admin can update this model',
    );
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
    await this.assertCanMutateModel(model, userId, 'update');

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
    await this.assertCanMutateModel(model, userId, 'delete');

    await this.db.delete(modelConfigs).where(eq(modelConfigs.id, id));
    return { success: true };
  }
}
