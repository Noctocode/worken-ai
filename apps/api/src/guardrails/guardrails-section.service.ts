import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import {
  guardrails,
  guardrailTeams,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { COMPLIANCE_TEMPLATES } from './compliance-templates.js';

interface CreateGuardrailDto {
  name: string;
  type: string;
  severity: string;
  validatorType?: string;
  entities?: string[];
  /** Required when validatorType === 'regex_match'. Free-form regex
   *  string. Validated lazily by the evaluator (broken regexes are
   *  logged + skipped at chat time). */
  pattern?: string;
  target?: string;
  onFail?: string;
}

@Injectable()
export class GuardrailsSectionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(userId: string) {
    // Two-query approach over a single GROUP BY: keeps the rule
    // payload row-shaped (no array-of-rows join expansion) and the
    // team links small enough to fetch all-at-once even for an org
    // with hundreds of rules. The N+1 cost is bounded by total
    // guardrails × teams, both small.
    const rules = await this.db
      .select({
        id: guardrails.id,
        ownerId: guardrails.ownerId,
        name: guardrails.name,
        type: guardrails.type,
        severity: guardrails.severity,
        triggers: guardrails.triggers,
        isActive: guardrails.isActive,
        isOrgWide: guardrails.isOrgWide,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        templateSource: guardrails.templateSource,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
      })
      .from(guardrails)
      .where(eq(guardrails.ownerId, userId))
      .orderBy(desc(guardrails.createdAt));

    if (rules.length === 0) return [];

    const links = await this.db
      .select({
        guardrailId: guardrailTeams.guardrailId,
        teamId: guardrailTeams.teamId,
        teamName: teams.name,
        isActive: guardrailTeams.isActive,
      })
      .from(guardrailTeams)
      .innerJoin(teams, eq(teams.id, guardrailTeams.teamId))
      .where(
        inArray(
          guardrailTeams.guardrailId,
          rules.map((r) => r.id),
        ),
      );

    const byRule = new Map<
      string,
      Array<{ id: string; name: string; isActive: boolean }>
    >();
    for (const link of links) {
      const arr = byRule.get(link.guardrailId) ?? [];
      arr.push({
        id: link.teamId,
        name: link.teamName,
        isActive: link.isActive,
      });
      byRule.set(link.guardrailId, arr);
    }

    return rules.map((r) => ({ ...r, teams: byRule.get(r.id) ?? [] }));
  }

  async getStats(userId: string) {
    const [stats] = await this.db
      .select({
        activeRules: sql<number>`count(*) filter (where ${guardrails.isActive} = true)`,
        totalTriggers: sql<number>`coalesce(sum(${guardrails.triggers}), 0)`,
        criticalRules: sql<number>`count(*) filter (where ${guardrails.severity} = 'high' and ${guardrails.isActive} = true)`,
        totalRules: sql<number>`count(*)`,
      })
      .from(guardrails)
      .where(eq(guardrails.ownerId, userId));

    const total = Number(stats.totalRules) || 1;
    const active = Number(stats.activeRules);

    return {
      activeRules: active,
      totalTriggers: Number(stats.totalTriggers),
      criticalRules: Number(stats.criticalRules),
      coverage: Math.round((active / total) * 1000) / 10,
    };
  }

  async create(dto: CreateGuardrailDto, userId: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Name is required');
    }

    const validSeverities = ['high', 'medium', 'low'];
    if (!validSeverities.includes(dto.severity)) {
      throw new BadRequestException('Invalid severity');
    }

    // regex_match needs a pattern — block at create time so an
    // admin doesn't ship a silently-no-op rule. Other validators
    // ignore the pattern field if it's accidentally set.
    let pattern: string | null = null;
    if (dto.pattern !== undefined && dto.pattern !== null) {
      const trimmed = String(dto.pattern).trim();
      pattern = trimmed.length > 0 ? trimmed : null;
    }
    if (dto.validatorType === 'regex_match') {
      if (!pattern) {
        throw new BadRequestException(
          'regex_match guardrail requires a non-empty `pattern`.',
        );
      }
      assertSafeRegex(pattern);
    }

    const [row] = await this.db
      .insert(guardrails)
      .values({
        ownerId: userId,
        name: dto.name.trim(),
        type: dto.type || 'Custom',
        severity: dto.severity,
        validatorType: dto.validatorType ?? null,
        entities: dto.entities ?? null,
        pattern,
        target: dto.target || 'both',
        onFail: dto.onFail || 'fix',
      })
      .returning();

    return row;
  }

  /**
   * Patch an existing rule. Same validation surface as `create`:
   * name non-empty, severity in the allowlist, regex_match needs a
   * compileable pattern. Every field is optional — the caller sends
   * only what changed. Owner check matches `toggle` / `remove` so a
   * teammate can't edit a rule that doesn't belong to them.
   */
  async update(id: string, dto: Partial<CreateGuardrailDto>, userId: string) {
    const [existing] = await this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.id, id));
    if (!existing) throw new NotFoundException('Guardrail not found');
    if (existing.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException('Name cannot be empty.');
      }
      updates.name = trimmed;
    }

    if (dto.severity !== undefined) {
      const validSeverities = ['high', 'medium', 'low'];
      if (!validSeverities.includes(dto.severity)) {
        throw new BadRequestException('Invalid severity');
      }
      updates.severity = dto.severity;
    }

    if (dto.validatorType !== undefined) {
      updates.validatorType = dto.validatorType || null;
    }

    if (dto.entities !== undefined) {
      updates.entities = dto.entities;
    }

    if (dto.pattern !== undefined) {
      const trimmed = String(dto.pattern ?? '').trim();
      updates.pattern = trimmed.length > 0 ? trimmed : null;
    }

    if (dto.target !== undefined) {
      updates.target = dto.target || 'both';
    }

    if (dto.onFail !== undefined) {
      updates.onFail = dto.onFail || 'fix';
    }

    if (dto.type !== undefined) {
      updates.type = dto.type || existing.type;
    }

    // Re-validate regex when the rule is (or stays as) regex_match.
    // Use the *resulting* state — ie. dto.validatorType if present,
    // otherwise the existing one — so `PATCH { pattern }` on an
    // already-regex_match rule still validates.
    const finalValidator =
      dto.validatorType !== undefined
        ? dto.validatorType
        : existing.validatorType;
    const finalPattern =
      dto.pattern !== undefined
        ? (updates.pattern as string | null)
        : existing.pattern;
    if (finalValidator === 'regex_match') {
      if (!finalPattern) {
        throw new BadRequestException(
          'regex_match guardrail requires a non-empty `pattern`.',
        );
      }
      assertSafeRegex(finalPattern);
    }

    const [row] = await this.db
      .update(guardrails)
      .set(updates)
      .where(eq(guardrails.id, id))
      .returning();
    return row;
  }

  async toggle(id: string, userId: string) {
    const [rule] = await this.db
      .select({ ownerId: guardrails.ownerId })
      .from(guardrails)
      .where(eq(guardrails.id, id));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({
        isActive: sql`NOT ${guardrails.isActive}`,
        updatedAt: new Date(),
      })
      .where(eq(guardrails.id, id))
      .returning();

    return updated;
  }

  async remove(id: string, userId: string) {
    const [rule] = await this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.id, id));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.db.delete(guardrails).where(eq(guardrails.id, id));
  }

  async applyTemplate(templateId: string, userId: string) {
    const template = COMPLIANCE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const values = template.rules.map((r) => ({
      ownerId: userId,
      name: r.name,
      type: r.type,
      severity: r.severity,
      validatorType: r.validatorType,
      entities: r.entities ?? null,
      target: r.target,
      onFail: r.onFail,
      templateSource: template.id,
    }));

    const inserted = await this.db
      .insert(guardrails)
      .values(values)
      .returning();

    return { templateName: template.name, rulesCreated: inserted.length };
  }

  /**
   * Link a guardrail to a team. Idempotent — re-assigning a rule that
   * already belongs to the team returns the existing link rather than
   * erroring. Owner of the rule + owner/editor of the team are both
   * required (the rule's owner gates ownership of the definition; the
   * team role gates the right to attach it to that team).
   */
  async assignToTeam(guardrailId: string, teamId: string, userId: string) {
    const [rule] = await this.db
      .select({ ownerId: guardrails.ownerId })
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const teamRole = await this.teamsService.getUserTeamRole(teamId, userId);
    if (teamRole === null) {
      throw new NotFoundException('Team not found');
    }
    if (
      teamRole !== 'owner' &&
      teamRole !== 'admin' &&
      teamRole !== 'manager' &&
      teamRole !== 'editor'
    ) {
      throw new ForbiddenException(
        'Only team owners, admins, managers, or editors can assign guardrails to a team',
      );
    }

    // ON CONFLICT DO NOTHING keeps repeat clicks safe — the FE picker
    // shouldn't list already-linked teams, but a double-click race
    // shouldn't 409 either. Return the resulting link so the FE can
    // refresh its picker state.
    const linkRows = await this.db
      .insert(guardrailTeams)
      .values({ guardrailId, teamId, assignedBy: userId })
      .onConflictDoNothing()
      .returning({ guardrailId: guardrailTeams.guardrailId });

    // Only announce when the INSERT actually landed (new link).
    // Re-assignments shouldn't fire a fresh "X added a guardrail"
    // toast at every member because someone clicked twice. Pulled
    // outside the conditional helper so we can also pre-resolve
    // rule + team names once.
    if (linkRows.length > 0) {
      await this.announceGuardrailAssignedToTeam(guardrailId, teamId, userId);
    }

    return this.getRuleWithTeams(guardrailId);
  }

  /**
   * Tell every team member (minus the assigner) that a new
   * guardrail is now active for their team. Best-effort, never
   * throws. Resolves rule + team names so the title reads
   * naturally without the FE having to do another lookup.
   */
  private async announceGuardrailAssignedToTeam(
    guardrailId: string,
    teamId: string,
    callerUserId: string,
  ): Promise<void> {
    try {
      const [rule] = await this.db
        .select({ name: guardrails.name })
        .from(guardrails)
        .where(eq(guardrails.id, guardrailId))
        .limit(1);
      const [team] = await this.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      const recipients = (
        await this.notifications.getTeamMembers(teamId)
      ).filter((id) => id !== callerUserId);
      const ruleName = rule?.name ?? 'A guardrail';
      const teamName = team?.name ?? 'team';
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'guardrail_added',
            title: `Guardrail "${ruleName}" is now active for "${teamName}"`,
            body: null,
            data: {
              scope: 'team',
              guardrailId,
              guardrailName: ruleName,
              teamId,
              teamName,
              actorId: callerUserId,
            },
          }),
        ),
      );
    } catch {
      // swallow — informational
    }
  }

  /**
   * Pause / resume a specific team's link to the rule without removing
   * it. The legacy `team_is_active` lived on the rule itself; now it
   * lives on each link so one team can pause "Hide email" while
   * another keeps it firing.
   */
  async toggleTeamActive(guardrailId: string, teamId: string, userId: string) {
    const [rule] = await this.db
      .select({ ownerId: guardrails.ownerId })
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const [link] = await this.db
      .select({ isActive: guardrailTeams.isActive })
      .from(guardrailTeams)
      .where(
        and(
          eq(guardrailTeams.guardrailId, guardrailId),
          eq(guardrailTeams.teamId, teamId),
        ),
      );
    if (!link) {
      throw new NotFoundException(
        'Guardrail is not linked to this team — assign it first.',
      );
    }

    await this.db
      .update(guardrailTeams)
      .set({ isActive: !link.isActive })
      .where(
        and(
          eq(guardrailTeams.guardrailId, guardrailId),
          eq(guardrailTeams.teamId, teamId),
        ),
      );

    return this.getRuleWithTeams(guardrailId);
  }

  /**
   * Flip the org-wide flag on a rule. When ON, the evaluator applies
   * the rule to every chat by every user in the owner's company
   * regardless of team links — `guardrail_teams` rows stay in the
   * DB but are bypassed. Flipping it back OFF restores the per-team
   * configuration without any data loss.
   *
   * Permission: rule's owner, OR a company admin (`role='admin'`)
   * who shares the owner's companyName. The admin escape hatch lets
   * a company owner enforce a rule across every team even when
   * someone else originally authored it.
   */
  async toggleOrgWide(guardrailId: string, userId: string) {
    const [rule] = await this.db
      .select({ ownerId: guardrails.ownerId, isOrgWide: guardrails.isOrgWide })
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');

    if (rule.ownerId !== userId) {
      const [caller] = await this.db
        .select({ role: users.role, companyName: users.companyName })
        .from(users)
        .where(eq(users.id, userId));
      const [owner] = await this.db
        .select({ companyName: users.companyName })
        .from(users)
        .where(eq(users.id, rule.ownerId));

      const isCompanyAdmin =
        caller?.role === 'admin' &&
        !!caller.companyName &&
        caller.companyName === owner?.companyName;

      if (!isCompanyAdmin) {
        throw new ForbiddenException(
          'Only the rule owner or a company admin can toggle Org-wide scope.',
        );
      }
    }

    const nextOrgWide = !rule.isOrgWide;
    await this.db
      .update(guardrails)
      .set({ isOrgWide: nextOrgWide, updatedAt: new Date() })
      .where(eq(guardrails.id, guardrailId));

    // Only fire the company-wide transparency notif when the rule
    // becomes org-wide — not on the reverse transition (turning it
    // back off doesn't need to ping everyone).
    if (nextOrgWide) {
      await this.announceGuardrailOrgWide(guardrailId, userId);
    }

    return this.getRuleWithTeams(guardrailId);
  }

  /**
   * Fan out a 'guardrail_added' (scope='org') notification to every
   * user in the caller's company so they know a new rule applies
   * to all their chats. Best-effort.
   */
  private async announceGuardrailOrgWide(
    guardrailId: string,
    callerUserId: string,
  ): Promise<void> {
    try {
      const [rule] = await this.db
        .select({ name: guardrails.name })
        .from(guardrails)
        .where(eq(guardrails.id, guardrailId))
        .limit(1);
      const ruleName = rule?.name ?? 'A guardrail';
      const recipients =
        await this.notifications.getCompanyUsers(callerUserId);
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'guardrail_added',
            title: `Guardrail "${ruleName}" now applies company-wide`,
            body: null,
            data: {
              scope: 'org',
              guardrailId,
              guardrailName: ruleName,
              actorId: callerUserId,
            },
          }),
        ),
      );
    } catch {
      // swallow — informational
    }
  }

  /**
   * Remove a single team's link. The rule itself stays in the org —
   * other teams keep their links, and the owner can re-link the team
   * later from the team page.
   */
  async unassignFromTeam(
    guardrailId: string,
    teamId: string,
    userId: string,
  ) {
    const [rule] = await this.db
      .select({ ownerId: guardrails.ownerId })
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    await this.db
      .delete(guardrailTeams)
      .where(
        and(
          eq(guardrailTeams.guardrailId, guardrailId),
          eq(guardrailTeams.teamId, teamId),
        ),
      );

    return this.getRuleWithTeams(guardrailId);
  }

  /**
   * Fetch one rule + its team links in the same row shape `findAll`
   * returns. Used as the response payload for the assign/unassign/
   * toggleTeamActive endpoints so the FE always gets a fully-shaped
   * rule back and doesn't need a second roundtrip to refresh its
   * picker state.
   */
  private async getRuleWithTeams(guardrailId: string) {
    const [rule] = await this.db
      .select({
        id: guardrails.id,
        ownerId: guardrails.ownerId,
        name: guardrails.name,
        type: guardrails.type,
        severity: guardrails.severity,
        triggers: guardrails.triggers,
        isActive: guardrails.isActive,
        isOrgWide: guardrails.isOrgWide,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        templateSource: guardrails.templateSource,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
      })
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');

    const links = await this.db
      .select({
        teamId: guardrailTeams.teamId,
        teamName: teams.name,
        isActive: guardrailTeams.isActive,
      })
      .from(guardrailTeams)
      .innerJoin(teams, eq(teams.id, guardrailTeams.teamId))
      .where(eq(guardrailTeams.guardrailId, guardrailId));

    return {
      ...rule,
      teams: links.map((l) => ({
        id: l.teamId,
        name: l.teamName,
        isActive: l.isActive,
      })),
    };
  }

  getTemplates() {
    return COMPLIANCE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      ruleCount: t.rules.length,
      description: t.description,
      features: t.features,
    }));
  }

  async removeTemplate(templateId: string, userId: string) {
    const deleted = await this.db
      .delete(guardrails)
      .where(
        and(
          eq(guardrails.templateSource, templateId),
          eq(guardrails.ownerId, userId),
        ),
      )
      .returning();

    return { templateId, rulesRemoved: deleted.length };
  }
}

/**
 * Reject obvious ReDoS bombs at create / update time. Pure-JS,
 * conservative — catches the textbook patterns that adversarial
 * admins might paste in (nested quantifiers, alternations with
 * overlap, polynomial repetition) without false-tripping on
 * legitimate complex regexes.
 *
 * Not bulletproof — the only fully safe path is a non-backtracking
 * engine like RE2. This is the cheap defence: rejects 90% of bombs
 * with zero deps. The evaluator pairs it with an input-size cap so
 * even a regex that slipped through can't lock the chat thread.
 *
 * Three checks:
 *   1. Length cap — patterns over 500 chars are usually wrong or
 *      malicious; legit patterns are short.
 *   2. Compileability — let the JS engine parse it. Catches
 *      malformed quantifiers / unmatched groups for free.
 *   3. Heuristic bomb detection — nested quantifiers like
 *      `(a+)+`, `(a*)*`, alternations with overlap.
 */
function assertSafeRegex(pattern: string): void {
  if (pattern.length > 500) {
    throw new BadRequestException(
      'Regex pattern is too long (>500 chars). Tighten it or split into multiple rules.',
    );
  }
  try {
    new RegExp(pattern, 'gi');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BadRequestException(`Invalid regex pattern: ${msg}`);
  }
  // Bomb heuristics. Anchored at the meta-pattern level — we look
  // at the regex source, not what it matches.
  //   - nested quantifiers: `(...+)+`, `(...*)*`, `(...+)*`
  //   - polynomial alternation overlap: `(a|a)+`, `(a|ab)*`
  // We reject the textbook cases. False-positives here are OK
  // because the admin can rewrite the pattern.
  const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*[+*]/;
  if (NESTED_QUANTIFIER.test(pattern)) {
    throw new BadRequestException(
      'Regex pattern contains nested quantifiers (e.g. (a+)+) that can cause exponential matching. Rewrite to avoid them.',
    );
  }
  const REPEATED_ALTERNATION = /\(([^|)]+)\|\1[^)]*\)\s*[+*]/;
  if (REPEATED_ALTERNATION.test(pattern)) {
    throw new BadRequestException(
      'Regex pattern contains alternations with overlapping branches that can cause exponential matching.',
    );
  }
}
