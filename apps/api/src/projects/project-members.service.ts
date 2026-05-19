import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  projectMembers,
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { TeamsService } from '../teams/teams.service.js';

/** Same role vocabulary as the team-member table so the FE picker
 *  shape stays uniform. We deliberately do NOT model 'owner' here —
 *  ownership lives on `projects.user_id` and the direct-membership
 *  table is for non-owners only. */
const VALID_ROLES = ['admin', 'editor', 'viewer'] as const;
type DirectRole = (typeof VALID_ROLES)[number];

export interface ProjectMemberRow {
  userId: string;
  userName: string | null;
  userEmail: string;
  userPicture: string | null;
  role: DirectRole;
  source: 'team' | 'direct';
  addedAt: string;
}

@Injectable()
export class ProjectMembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
  ) {}

  /**
   * "Members with access to this project" view used by the
   * InviteMembersDialog (Figma 179:16073). Combines two sources into
   * a single list and tags each row with `source` so the FE can group
   * them under "Marketing Team" (or whichever team owns the project)
   * and "Other".
   *
   * Read-only call — only the project owner or an admin/manager on
   * the project's team can mutate. Anyone with access can SEE the
   * roster, mirroring the dialog's behavior in Figma.
   */
  async list(projectId: string, callerId: string): Promise<ProjectMemberRow[]> {
    const project = await this.requireAccess(projectId, callerId);

    const direct = await this.db
      .select({
        userId: projectMembers.userId,
        role: projectMembers.role,
        addedAt: projectMembers.addedAt,
        userName: users.name,
        userEmail: users.email,
        userPicture: users.picture,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId));

    const directIds = new Set(direct.map((r) => r.userId));

    const teamRows: ProjectMemberRow[] = [];
    if (project.teamId) {
      // 1) The team's owner. NOT duplicated into team_members — owner
      //    is identified via `teams.ownerId` only — so a pure
      //    team_members query would silently drop them and the Members
      //    section would underreport (and feel buggy on a team where
      //    only the owner has joined).
      const [owner] = await this.db
        .select({
          userId: teams.ownerId,
          userName: users.name,
          userEmail: users.email,
          userPicture: users.picture,
          createdAt: teams.createdAt,
        })
        .from(teams)
        .innerJoin(users, eq(teams.ownerId, users.id))
        .where(eq(teams.id, project.teamId))
        .limit(1);

      const seenUserIds = new Set<string>(directIds);
      if (owner && !seenUserIds.has(owner.userId)) {
        seenUserIds.add(owner.userId);
        teamRows.push({
          userId: owner.userId,
          userName: owner.userName,
          userEmail: owner.userEmail,
          userPicture: owner.userPicture,
          // Display the owner as admin in the dialog — the BE still
          // treats them as owner everywhere else, this is just the
          // FE label since the Figma comp only exposes admin/editor.
          role: 'admin',
          source: 'team',
          addedAt:
            owner.createdAt instanceof Date
              ? owner.createdAt.toISOString()
              : new Date(owner.createdAt).toISOString(),
        });
      }

      // 2) Accepted non-owner members.
      const rows = await this.db
        .select({
          userId: teamMembers.userId,
          role: teamMembers.role,
          addedAt: teamMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
          userPicture: users.picture,
          status: teamMembers.status,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, project.teamId));

      for (const r of rows) {
        if (r.status !== 'accepted' || r.userId === null) continue;
        // Dedupe across sources: a user might be in team_members AND
        // project_members (rare but legal); prefer the team row so
        // the FE groups them under the team, not "Other". Also dedupe
        // against the owner row above in case team_members has an
        // explicit entry for the owner.
        if (seenUserIds.has(r.userId)) continue;
        seenUserIds.add(r.userId);
        teamRows.push({
          userId: r.userId,
          userName: r.userName,
          userEmail: r.userEmail,
          userPicture: r.userPicture,
          role: (VALID_ROLES as readonly string[]).includes(r.role)
            ? (r.role as DirectRole)
            : 'editor',
          source: 'team',
          addedAt:
            r.addedAt instanceof Date
              ? r.addedAt.toISOString()
              : new Date(r.addedAt).toISOString(),
        });
      }
    }

    const directRows: ProjectMemberRow[] = direct.map((r) => ({
      userId: r.userId,
      userName: r.userName,
      userEmail: r.userEmail,
      userPicture: r.userPicture,
      role: (VALID_ROLES as readonly string[]).includes(r.role)
        ? (r.role as DirectRole)
        : 'editor',
      source: 'direct',
      addedAt:
        r.addedAt instanceof Date
          ? r.addedAt.toISOString()
          : new Date(r.addedAt).toISOString(),
    }));

    return [...teamRows, ...directRows];
  }

  /**
   * Add a user to a project directly (the "Other" group of the
   * invite modal). Requires the caller to be either the project
   * owner or admin/manager on the project's team — same gate the
   * team-invite dialog uses, so the UX stays consistent.
   */
  async add(
    projectId: string,
    callerId: string,
    body: { userId: string; role?: DirectRole },
  ): Promise<ProjectMemberRow> {
    await this.requireManage(projectId, callerId);

    if (!body?.userId) {
      throw new BadRequestException('userId is required');
    }
    const role: DirectRole =
      body.role && (VALID_ROLES as readonly string[]).includes(body.role)
        ? body.role
        : 'editor';

    const [target] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        picture: users.picture,
      })
      .from(users)
      .where(eq(users.id, body.userId))
      .limit(1);
    if (!target) {
      throw new NotFoundException(`User ${body.userId} not found`);
    }

    // Upsert by primary key — if the user was already added we just
    // update the role rather than 409'ing. Mirrors the team-invite
    // "resend with updated role" UX.
    await this.db
      .insert(projectMembers)
      .values({
        projectId,
        userId: target.id,
        role,
        addedBy: callerId,
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      });

    return {
      userId: target.id,
      userName: target.name,
      userEmail: target.email,
      userPicture: target.picture,
      role,
      source: 'direct',
      addedAt: new Date().toISOString(),
    };
  }

  async updateRole(
    projectId: string,
    targetUserId: string,
    callerId: string,
    role: DirectRole,
  ) {
    await this.requireManage(projectId, callerId);
    if (!(VALID_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }

    const [updated] = await this.db
      .update(projectMembers)
      .set({ role })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, targetUserId),
        ),
      )
      .returning();
    if (!updated) {
      throw new NotFoundException('Project membership not found');
    }
    return { updated: true, role };
  }

  async remove(projectId: string, targetUserId: string, callerId: string) {
    await this.requireManage(projectId, callerId);

    const [deleted] = await this.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, targetUserId),
        ),
      )
      .returning();
    if (!deleted) {
      throw new NotFoundException('Project membership not found');
    }
    return { removed: true };
  }

  /* ─── Auth helpers ──────────────────────────────────────────── */

  /** Read access — owner, team member, or direct project member. */
  private async requireAccess(projectId: string, userId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (project.userId === userId) return project;
    if (project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (role) return project;
    }
    const [direct] = await this.db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!direct) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  /**
   * Manage access — owner, or admin/manager on the project's team.
   * Direct project members can't add/remove others; the chat header
   * Invite CTA is gated server-side here regardless of what the FE
   * shows. (FE has no permission gate today; ForbiddenException is
   * humanised by the toast handler.)
   */
  private async requireManage(projectId: string, userId: string) {
    const project = await this.requireAccess(projectId, userId);
    if (project.userId === userId) return project;
    if (project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (role === 'owner' || role === 'admin' || role === 'manager') {
        return project;
      }
    }
    throw new ForbiddenException(
      'Only the project owner or a team admin/manager can change project members.',
    );
  }
}
