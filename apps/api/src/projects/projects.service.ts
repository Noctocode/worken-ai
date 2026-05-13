import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, inArray, or } from 'drizzle-orm';
import { projects, teams, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
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
    private readonly notifications: NotificationsService,
  ) {}

  private selectWithTeamName() {
    return this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        model: projects.model,
        status: projects.status,
        teamId: projects.teamId,
        teamName: teams.name,
        userId: projects.userId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(teams, eq(projects.teamId, teams.id));
  }

  async findAll(userId: string, filter: 'all' | 'personal' | 'team' = 'all') {
    const teamIds = await this.teamsService.getUserTeamIds(userId);

    if (filter === 'personal') {
      return this.selectWithTeamName()
        .where(and(eq(projects.userId, userId), isNull(projects.teamId)))
        .orderBy(desc(projects.createdAt));
    }

    if (filter === 'team') {
      if (teamIds.length === 0) return [];
      return this.selectWithTeamName()
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

    return this.selectWithTeamName()
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

  async create(dto: CreateProjectDto, userId: string) {
    if (dto.teamId) {
      const role = await this.teamsService.getUserTeamRole(dto.teamId, userId);
      if (
        role !== 'owner' &&
        role !== 'admin' &&
        role !== 'manager' &&
        role !== 'editor'
      ) {
        throw new ForbiddenException(
          'Only team owners, admins, managers, or editors can create team projects',
        );
      }
    } else {
      const [caller] = await this.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId));
      if (!caller || caller.role === 'basic') {
        throw new ForbiddenException(
          'Only admin or advanced users can create projects',
        );
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

    // Team transparency: tell every other team member a new project
    // landed in their workspace. Personal projects have no audience
    // to ping. Best-effort.
    if (project.teamId) {
      await this.announceTeamProjectCreated(
        project.id,
        project.name,
        project.teamId,
        userId,
      );
    }

    return project;
  }

  async remove(id: string, userId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    if (project.userId !== userId) {
      throw new ForbiddenException('Only the project owner can delete it');
    }

    // Snapshot team scope + name BEFORE the delete so we can resolve
    // recipients and render the title even after the row is gone.
    const teamId = project.teamId;
    const projectName = project.name;

    await this.db.delete(projects).where(eq(projects.id, id));

    if (teamId) {
      await this.announceTeamProjectDeleted(
        id,
        projectName,
        teamId,
        userId,
      );
    }
    return { success: true };
  }

  /**
   * Notify every team member (minus the creator) that a new
   * team-scoped project exists. Best-effort, never throws.
   */
  private async announceTeamProjectCreated(
    projectId: string,
    projectName: string,
    teamId: string,
    creatorUserId: string,
  ): Promise<void> {
    try {
      const [team] = await this.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      if (!team) return;
      const [creator] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, creatorUserId))
        .limit(1);
      const creatorName =
        creator?.name || creator?.email || 'A team member';
      const recipients = (
        await this.notifications.getTeamMembers(teamId)
      ).filter((id) => id !== creatorUserId);
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'project_created',
            title: `${creatorName} created project "${projectName}" in "${team.name}"`,
            body: null,
            data: {
              projectId,
              projectName,
              teamId,
              teamName: team.name,
              actorId: creatorUserId,
              actorName: creatorName,
            },
          }),
        ),
      );
    } catch {
      // swallow — never abort the project insert
    }
  }

  /**
   * Notify every team member (minus the deleter) that a project is
   * gone. Best-effort.
   */
  private async announceTeamProjectDeleted(
    projectId: string,
    projectName: string,
    teamId: string,
    deleterUserId: string,
  ): Promise<void> {
    try {
      const [team] = await this.db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      const teamName = team?.name ?? 'team';
      const [deleter] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, deleterUserId))
        .limit(1);
      const actorName =
        deleter?.name || deleter?.email || 'A team member';
      const recipients = (
        await this.notifications.getTeamMembers(teamId)
      ).filter((id) => id !== deleterUserId);
      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications.create({
            userId,
            type: 'project_deleted',
            title: `Project "${projectName}" was deleted from "${teamName}"`,
            body: `Deleted by ${actorName}.`,
            data: {
              projectId,
              projectName,
              teamId,
              teamName,
              actorId: deleterUserId,
              actorName,
            },
          }),
        ),
      );
    } catch {
      // swallow
    }
  }
}
