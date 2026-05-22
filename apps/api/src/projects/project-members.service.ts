import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TeamsService } from '../teams/teams.service.js';

/** Same role vocabulary as the team-member table so the FE picker
 *  shape stays uniform. We deliberately do NOT model 'owner' here —
 *  ownership lives on `projects.user_id` and the direct-membership
 *  table is for non-owners only. */
const VALID_ROLES = ['admin', 'editor', 'viewer'] as const;
type DirectRole = (typeof VALID_ROLES)[number];

export interface ProjectMemberRow {
  /** For pending team invites the invitee has no user account yet,
   *  so we synthesize the id from the team_members row id (prefixed
   *  with `invite:` so it can't collide with a real user id). The
   *  FE only uses it as a React key + DELETE target — both work
   *  with the synthetic value when the row's `status` is 'pending'. */
  userId: string;
  userName: string | null;
  userEmail: string;
  userPicture: string | null;
  role: DirectRole;
  /** 'team' rows are accepted members of the project's team.
   *  'direct' rows live in `project_members` (ad-hoc additions).
   *  Pending team invites also land under 'direct' so they show up
   *  immediately in the "Other" group of the invite dialog — the
   *  FE distinguishes them by `status: 'pending'`. */
  source: 'team' | 'direct';
  status: 'pending' | 'accepted';
  addedAt: string;
}

@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
    private readonly mailService: MailService,
    private readonly notifications: NotificationsService,
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
        // Pull the org-level invite status so a project member whose
        // user is still finishing signup (inviteStatus = 'pending')
        // renders with a "Pending" badge in the dialog. Once they
        // register, users.inviteStatus flips to 'active' and the
        // dialog refreshes them to an accepted row.
        inviteStatus: users.inviteStatus,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId));

    const directIds = new Set(direct.map((r) => r.userId));

    const teamRows: ProjectMemberRow[] = [];
    const pendingRows: ProjectMemberRow[] = [];
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
      // Seed with the direct members' emails too — a pending team
      // invite (userId null, matched only by email) for someone who
      // is already a direct project member must be suppressed, or the
      // dialog renders the same person twice.
      const seenEmails = new Set<string>(
        direct.map((r) => r.userEmail.toLowerCase()),
      );
      if (owner && !seenUserIds.has(owner.userId)) {
        seenUserIds.add(owner.userId);
        seenEmails.add(owner.userEmail.toLowerCase());
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
          status: 'accepted',
          addedAt:
            owner.createdAt instanceof Date
              ? owner.createdAt.toISOString()
              : new Date(owner.createdAt).toISOString(),
        });
      }

      // 2) Every team_members row. Accepted members (userId set,
      //    status='accepted') flow into the team group. Pending
      //    invites (userId null, status='pending') land in the Other
      //    group with a 'pending' status flag so the dialog can
      //    surface the new invite the moment Send Invite returns —
      //    the FE doesn't have to wait for the invitee to accept.
      //
      //    leftJoin (not inner) because pending rows have no user yet.
      const rows = await this.db
        .select({
          rowId: teamMembers.id,
          userId: teamMembers.userId,
          role: teamMembers.role,
          email: teamMembers.email,
          addedAt: teamMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
          userPicture: users.picture,
          status: teamMembers.status,
        })
        .from(teamMembers)
        .leftJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, project.teamId));

      for (const r of rows) {
        const role: DirectRole = (VALID_ROLES as readonly string[]).includes(
          r.role,
        )
          ? (r.role as DirectRole)
          : 'editor';
        const addedAt =
          r.addedAt instanceof Date
            ? r.addedAt.toISOString()
            : new Date(r.addedAt).toISOString();

        if (r.status === 'accepted' && r.userId !== null) {
          // Dedupe across sources: a user might be in team_members
          // AND project_members (rare but legal); prefer the team row
          // so the FE groups them under the team, not "Other". Also
          // dedupe against the owner row above.
          if (seenUserIds.has(r.userId)) continue;
          seenUserIds.add(r.userId);
          if (r.userEmail) seenEmails.add(r.userEmail.toLowerCase());
          teamRows.push({
            userId: r.userId,
            userName: r.userName,
            userEmail: r.userEmail ?? r.email,
            userPicture: r.userPicture,
            role,
            source: 'team',
            status: 'accepted',
            addedAt,
          });
        } else if (r.status === 'pending') {
          // Hide a pending invite for someone who is already an
          // accepted member or an owner — happens when the team
          // resends an invite to an active user.
          if (r.userId && seenUserIds.has(r.userId)) continue;
          if (r.email && seenEmails.has(r.email.toLowerCase())) continue;
          if (r.email) seenEmails.add(r.email.toLowerCase());
          pendingRows.push({
            // Synthetic id keyed on the team_members row so the FE has
            // a stable React key + a unique target for any future
            // "cancel invite" action. `invite:` prefix can't collide
            // with a real user uuid.
            userId: `invite:${r.rowId}`,
            userName: null,
            userEmail: r.email,
            userPicture: null,
            role,
            source: 'direct',
            status: 'pending',
            addedAt,
          });
        }
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
      // Pending while the user is still completing signup
      // (users.inviteStatus = 'pending'); flips to accepted on
      // register / first login.
      status: r.inviteStatus === 'pending' ? 'pending' : 'accepted',
      addedAt:
        r.addedAt instanceof Date
          ? r.addedAt.toISOString()
          : new Date(r.addedAt).toISOString(),
    }));

    return [...teamRows, ...directRows, ...pendingRows];
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
      status: 'accepted',
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
    const project = await this.requireManage(projectId, callerId);

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

    // Tell the removed user. Mirrors team_member_removed — info-only
    // (no accept/dismiss), so the inbox doubles as an audit trail of
    // "you were dropped from X by Y". Failure is logged but doesn't
    // roll back the delete; the membership change is already done.
    try {
      const [caller] = await this.db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, callerId))
        .limit(1);
      const callerName = caller?.name ?? caller?.email ?? 'A teammate';
      await this.notifications.create({
        userId: targetUserId,
        type: 'project_removed',
        title: `${callerName} removed you from ${project.name}`,
        body: `You no longer have direct access to this project.`,
        data: {
          projectId: project.id,
          projectName: project.name,
          removedBy: callerId,
          removedByName: callerName,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to notify ${targetUserId} of project removal: ${msg}`,
      );
    }

    return { removed: true };
  }

  /**
   * Invite by email — adds the invitee to *this project only* and to
   * the org (`users` table), but NOT to the project's team. This is
   * the path the InviteMembersDialog uses so people end up under the
   * "Other" group in the dialog without becoming full team members.
   *
   * For genuinely new emails: pre-create the user row with the
   * caller's company tenancy inherited (so they land in the org
   * users list under /teams?tab=users). For existing emails — same
   * company or different — just add them to project_members. We do
   * NOT mutate an existing user's company affiliation; cross-tenant
   * profile rewrites are a separate, manual operation.
   *
   * For team projects we inherit from the team owner so the
   * invitee's company matches the team's workspace. For personal
   * projects we inherit from the project owner.
   */
  async inviteByEmail(
    projectId: string,
    callerId: string,
    body: { email: string; role?: DirectRole },
  ): Promise<ProjectMemberRow> {
    const project = await this.requireManage(projectId, callerId);

    const rawEmail = (body?.email ?? '').trim().toLowerCase();
    if (!rawEmail) {
      throw new BadRequestException('email is required');
    }
    const role: DirectRole =
      body.role && (VALID_ROLES as readonly string[]).includes(body.role)
        ? body.role
        : 'editor';

    // 1) Find or create the org user.
    const [existing] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        picture: users.picture,
      })
      .from(users)
      .where(eq(users.email, rawEmail))
      .limit(1);

    let target: {
      id: string;
      email: string;
      name: string | null;
      picture: string | null;
    };
    const isNewUser = !existing;
    if (existing) {
      target = existing;
    } else {
      // Inherit company tenancy from the project's team owner (team
      // projects) or the project's own owner (personal projects), so
      // the invitee lands in the same company on /teams?tab=users.
      const inheritFromUserId = project.teamId
        ? await this.getTeamOwnerId(project.teamId)
        : project.userId;
      const inheritedFields =
        await this.companyInheritFields(inheritFromUserId);

      const [created] = await this.db
        .insert(users)
        .values({
          email: rawEmail,
          role: 'basic',
          inviteStatus: 'pending',
          ...inheritedFields,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          picture: users.picture,
        });
      target = created;
    }

    // 2) Add to project_members (upsert so a repeat invite just
    //    refreshes the role, mirroring the team-invite UX).
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

    // 3) Notify the invitee. The team-invite path sends a dedicated
    //    project-invitation email; ours piggy-backs on the org-
    //    invitation template for new users (signup link) and an in-
    //    app notification for existing users. Failure here is logged
    //    but doesn't fail the mutation — the row is already in place
    //    and the inviter can resend manually if needed.
    const [inviter] = await this.db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, callerId))
      .limit(1);
    const inviterName = inviter?.name ?? inviter?.email ?? 'A teammate';

    try {
      if (isNewUser) {
        await this.mailService.sendOrgInvitation({
          to: rawEmail,
          inviterName,
          role: 'basic',
        });
      } else {
        await this.notifications.create({
          userId: target.id,
          type: 'project_invite',
          title: `${inviterName} added you to ${project.name}`,
          body: `Open the project to start chatting.`,
          data: {
            projectId: project.id,
            projectName: project.name,
            inviterName,
            role,
          },
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to notify ${rawEmail} of project invite: ${msg}`,
      );
    }

    return {
      userId: target.id,
      userName: target.name,
      userEmail: target.email,
      userPicture: target.picture,
      role,
      source: 'direct',
      status: 'accepted',
      addedAt: new Date().toISOString(),
    };
  }

  private async getTeamOwnerId(teamId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    return row?.ownerId ?? null;
  }

  private async companyInheritFields(
    inheritFromUserId: string | null,
  ): Promise<Record<string, unknown>> {
    if (!inheritFromUserId) return {};
    const [owner] = await this.db
      .select({
        profileType: users.profileType,
        // `companyId` is the authoritative tenant key — companyName &
        // friends are just display caches on the user row. The
        // invitee MUST inherit it or they'd be created with
        // companyId = NULL and drop out of every tenant-scoped query
        // (e.g. the /teams?tab=users org-users list).
        companyId: users.companyId,
        companyName: users.companyName,
        industry: users.industry,
        teamSize: users.teamSize,
        infraChoice: users.infraChoice,
      })
      .from(users)
      .where(eq(users.id, inheritFromUserId))
      .limit(1);
    if (
      !owner ||
      owner.profileType !== 'company' ||
      !owner.companyId ||
      !owner.companyName?.trim()
    ) {
      return {};
    }
    // Stamp onboardingCompletedAt so /setup-profile bounces the
    // invitee straight to the dashboard — they're joining an
    // existing workspace, not seeing the wizard fresh.
    return {
      profileType: 'company',
      companyId: owner.companyId,
      companyName: owner.companyName,
      industry: owner.industry,
      teamSize: owner.teamSize,
      infraChoice: owner.infraChoice,
      onboardingCompletedAt: new Date(),
    };
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
