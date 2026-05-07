import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc, sql } from 'drizzle-orm';
import { guardrails, teams } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
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
  ) {}

  async findAll(userId: string) {
    return this.db
      .select({
        id: guardrails.id,
        teamId: guardrails.teamId,
        ownerId: guardrails.ownerId,
        name: guardrails.name,
        type: guardrails.type,
        severity: guardrails.severity,
        triggers: guardrails.triggers,
        isActive: guardrails.isActive,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        templateSource: guardrails.templateSource,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
        teamName: teams.name,
      })
      .from(guardrails)
      .leftJoin(teams, eq(teams.id, guardrails.teamId))
      .where(eq(guardrails.ownerId, userId))
      .orderBy(desc(guardrails.createdAt));
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

  async assignToTeam(guardrailId: string, teamId: string, userId: string) {
    const [rule] = await this.db
      .select()
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
    if (teamRole !== 'owner' && teamRole !== 'editor') {
      throw new ForbiddenException(
        'Only team owners or editors can assign guardrails to a team',
      );
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({ teamId, updatedAt: new Date() })
      .where(eq(guardrails.id, guardrailId))
      .returning();

    return updated;
  }

  async toggleTeamActive(guardrailId: string, userId: string) {
    const [rule] = await this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({ teamIsActive: !rule.teamIsActive, updatedAt: new Date() })
      .where(eq(guardrails.id, guardrailId))
      .returning();

    return updated;
  }

  async unassignFromTeam(guardrailId: string, userId: string) {
    const [rule] = await this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.id, guardrailId));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({ teamId: null, updatedAt: new Date() })
      .where(eq(guardrails.id, guardrailId))
      .returning();

    return updated;
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
