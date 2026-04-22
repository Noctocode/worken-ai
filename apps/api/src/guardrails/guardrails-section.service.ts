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
        activeRules:
          sql<number>`count(*) filter (where ${guardrails.isActive} = true)`,
        totalTriggers: sql<number>`coalesce(sum(${guardrails.triggers}), 0)`,
        criticalRules:
          sql<number>`count(*) filter (where ${guardrails.severity} = 'high' and ${guardrails.isActive} = true)`,
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

    const [row] = await this.db
      .insert(guardrails)
      .values({
        ownerId: userId,
        name: dto.name.trim(),
        type: dto.type || 'Custom',
        severity: dto.severity,
        validatorType: dto.validatorType || null,
        entities: dto.entities || null,
        target: dto.target || 'both',
        onFail: dto.onFail || 'fix',
      })
      .returning();

    return row;
  }

  async toggle(id: string, userId: string) {
    const [rule] = await this.db
      .select()
      .from(guardrails)
      .where(eq(guardrails.id, id));

    if (!rule) throw new NotFoundException('Guardrail not found');
    if (rule.ownerId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const [updated] = await this.db
      .update(guardrails)
      .set({ isActive: !rule.isActive, updatedAt: new Date() })
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
      ruleCount: t.ruleCount,
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
