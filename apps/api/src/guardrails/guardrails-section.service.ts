import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { guardrails, teams, teamMembers } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { COMPLIANCE_TEMPLATES } from './compliance-templates.js';

interface CreateGuardrailDto {
  teamId: string;
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
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async getUserTeamIds(userId: string): Promise<string[]> {
    const ownedTeams = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.ownerId, userId));

    const memberTeams = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));

    const ids = new Set<string>();
    ownedTeams.forEach((t) => ids.add(t.id));
    memberTeams.forEach((t) => ids.add(t.teamId));
    return Array.from(ids);
  }

  async findAll(userId: string) {
    const teamIds = await this.getUserTeamIds(userId);
    if (teamIds.length === 0) return [];

    return this.db
      .select({
        id: guardrails.id,
        teamId: guardrails.teamId,
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
      .where(inArray(guardrails.teamId, teamIds))
      .orderBy(desc(guardrails.createdAt));
  }

  async getStats(userId: string) {
    const teamIds = await this.getUserTeamIds(userId);
    if (teamIds.length === 0) {
      return {
        activeRules: 0,
        totalTriggers: 0,
        criticalRules: 0,
        coverage: 0,
      };
    }

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
      .where(inArray(guardrails.teamId, teamIds));

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
    const teamIds = await this.getUserTeamIds(userId);
    if (!teamIds.includes(dto.teamId)) {
      throw new ForbiddenException('Access denied to this team');
    }

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
        teamId: dto.teamId,
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

    const teamIds = await this.getUserTeamIds(userId);
    if (!teamIds.includes(rule.teamId)) {
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

    const teamIds = await this.getUserTeamIds(userId);
    if (!teamIds.includes(rule.teamId)) {
      throw new ForbiddenException('Access denied');
    }

    await this.db.delete(guardrails).where(eq(guardrails.id, id));
  }

  async applyTemplate(templateId: string, teamId: string, userId: string) {
    const teamIds = await this.getUserTeamIds(userId);
    if (!teamIds.includes(teamId)) {
      throw new ForbiddenException('Access denied to this team');
    }

    const template = COMPLIANCE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const values = template.rules.map((r) => ({
      teamId,
      name: r.name,
      type: r.type,
      severity: r.severity,
      validatorType: r.validatorType,
      entities: r.entities || null,
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

  getTemplates() {
    return COMPLIANCE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      ruleCount: t.ruleCount,
      description: t.description,
      features: t.features,
    }));
  }
}
