import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, inArray, or } from 'drizzle-orm';
import { projects } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { TeamsService } from '../teams/teams.service.js';

export interface CreateProjectDto {
  name: string;
  description?: string;
  model: string;
  teamId?: string;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
  ) {}

  async findAll(userId: string, filter: 'all' | 'personal' | 'team' = 'all') {
    const teamIds = await this.teamsService.getUserTeamIds(userId);

    if (filter === 'personal') {
      return this.db
        .select()
        .from(projects)
        .where(and(eq(projects.userId, userId), isNull(projects.teamId)))
        .orderBy(desc(projects.createdAt));
    }

    if (filter === 'team') {
      if (teamIds.length === 0) return [];
      return this.db
        .select()
        .from(projects)
        .where(inArray(projects.teamId, teamIds))
        .orderBy(desc(projects.createdAt));
    }

    // 'all' — personal + team projects
    const conditions = [
      and(eq(projects.userId, userId), isNull(projects.teamId)),
    ];
    if (teamIds.length > 0) {
      conditions.push(inArray(projects.teamId, teamIds));
    }

    return this.db
      .select()
      .from(projects)
      .where(or(...conditions))
      .orderBy(desc(projects.createdAt));
  }

  async findOne(id: string, userId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    // If team project, allow any team member
    if (project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (!role) {
        throw new NotFoundException(`Project ${id} not found`);
      }
      return project;
    }

    // Personal project — owner only
    if (project.userId !== userId) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async create(dto: CreateProjectDto, userId: string, isPaid: boolean) {
    if (dto.teamId) {
      // Team project: user must be owner or advanced
      const role = await this.teamsService.getUserTeamRole(dto.teamId, userId);
      if (!role || role === 'basic') {
        throw new ForbiddenException(
          'Only team owners and advanced members can create team projects',
        );
      }
    } else {
      // Personal project: user must be paid OR have advanced role in any team
      if (!isPaid) {
        const hasAdvanced =
          await this.teamsService.userHasAdvancedRoleInAnyTeam(userId);
        if (!hasAdvanced) {
          throw new ForbiddenException(
            'You need a paid account or advanced team role to create projects',
          );
        }
      }
    }

    const [project] = await this.db
      .insert(projects)
      .values({
        name: dto.name,
        description: dto.description,
        model: dto.model,
        userId,
        teamId: dto.teamId ?? null,
      })
      .returning();
    return project;
  }
}
