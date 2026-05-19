import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, inArray, or } from 'drizzle-orm';
import {
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TeamsService } from '../teams/teams.service.js';

/** Compact preview shape for the avatar stack on team project cards. */
export interface ProjectMemberPreview {
  id: string;
  userId: string | null;
  userName: string | null;
  userPicture: string | null;
}

/** How many accepted members appear in the avatar stack before
 *  collapsing into a "+N" indicator on a team project card. */
const TEAM_MEMBER_PREVIEW_CAP = 4;

export interface CreateProjectDto {
  name: string;
  description?: string;
  model: string;
  teamId?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  model?: string;
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

    let rows;
    if (filter === 'personal') {
      rows = await this.selectWithTeamName()
        .where(and(eq(projects.userId, userId), isNull(projects.teamId)))
        .orderBy(desc(projects.createdAt));
    } else if (filter === 'team') {
      if (teamIds.length === 0) return [];
      rows = await this.selectWithTeamName()
        .where(inArray(projects.teamId, teamIds))
        .orderBy(desc(projects.createdAt));
    } else {
      // 'all' — personal + team projects
      const conditions = [
        and(eq(projects.userId, userId), isNull(projects.teamId)),
      ];
      if (teamIds.length > 0) {
        conditions.push(inArray(projects.teamId, teamIds));
      }
      rows = await this.selectWithTeamName()
        .where(or(...conditions))
        .orderBy(desc(projects.createdAt));
    }

    return this.enrichWithTeamMembers(rows);
  }

  /**
   * Attach `teamMembers` (preview of accepted members) and
   * `teamMembersCount` (total accepted count) to every project whose
   * `teamId` is set. Personal projects pass through untouched. One
   * extra DB round-trip regardless of project count — we fetch every
   * accepted member for every distinct teamId in a single IN query
   * and group in-memory, then cap to TEAM_MEMBER_PREVIEW_CAP per team.
   *
   * Powers the avatar stack on team project cards (dashboard). Capped
   * to keep the payload small — full member list lives at /teams/:id.
   *
   * `members.id` (team_members row id) is the React key on the FE
   * stack; `userId` may be null for pre-acceptance invites which we
   * filter out via `status='accepted'`. `userName`/`userPicture` fall
   * back to email-derived initials on the FE when null.
   */
  private async enrichWithTeamMembers<
    T extends { id: string; teamId: string | null },
  >(rows: T[]): Promise<Array<T & {
    teamMembers?: ProjectMemberPreview[];
    teamMembersCount?: number;
  }>> {
    const distinctTeamIds = Array.from(
      new Set(
        rows.map((r) => r.teamId).filter((id): id is string => id != null),
      ),
    );
    if (distinctTeamIds.length === 0) return rows;

    const memberRows = await this.db
      .select({
        id: teamMembers.id,
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        userName: users.name,
        userPicture: users.picture,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(
        and(
          inArray(teamMembers.teamId, distinctTeamIds),
          eq(teamMembers.status, 'accepted'),
        ),
      )
      .orderBy(asc(teamMembers.createdAt));

    const byTeam = new Map<
      string,
      { preview: ProjectMemberPreview[]; count: number }
    >();
    for (const m of memberRows) {
      const entry = byTeam.get(m.teamId) ?? { preview: [], count: 0 };
      entry.count += 1;
      if (entry.preview.length < TEAM_MEMBER_PREVIEW_CAP) {
        entry.preview.push({
          id: m.id,
          userId: m.userId,
          userName: m.userName,
          userPicture: m.userPicture,
        });
      }
      byTeam.set(m.teamId, entry);
    }

    return rows.map((r) => {
      if (!r.teamId) return r;
      const entry = byTeam.get(r.teamId);
      if (!entry) return r;
      return {
        ...r,
        teamMembers: entry.preview,
        teamMembersCount: entry.count,
      };
    });
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

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id));

    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    // Same edit gate as project creation: personal projects → owner
    // only; team projects → owner / admin / manager / editor of the
    // team. Viewers can read but can't mutate.
    if (project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (
        role !== 'owner' &&
        role !== 'admin' &&
        role !== 'manager' &&
        role !== 'editor'
      ) {
        throw new ForbiddenException(
          'Only team owners, admins, managers, or editors can edit team projects',
        );
      }
    } else if (project.userId !== userId) {
      throw new ForbiddenException('Only the project owner can edit it');
    }

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.model !== undefined) updates.model = dto.model;
    if (Object.keys(updates).length === 0) return project;
    updates.updatedAt = new Date();

    const [updated] = await this.db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning();

    return updated;
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
      await this.announceTeamProjectDeleted(id, projectName, teamId, userId);
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
      const creatorName = creator?.name || creator?.email || 'A team member';
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
      const actorName = deleter?.name || deleter?.email || 'A team member';
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
