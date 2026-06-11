import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  inArray,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  projectMembers,
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TeamsService } from '../teams/teams.service.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';
import { resolveWebSearchCapability } from '../integrations/web-search-capability.resolver.js';

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
  /** Active agent preset on create. Defaults to general-assistant. */
  agent?: string;
  /** Pool of agent presets picked for the project. Defaults to [agent]. */
  agents?: string[];
  teamId?: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  model?: string;
  agent?: string;
  agents?: string[];
  /** Per-project web search switch. Setting true requires the org/team
   *  capability to be enabled, else the update is rejected. */
  webSearch?: boolean;
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly teamsService: TeamsService,
    private readonly notifications: NotificationsService,
    private readonly chatTransport: ChatTransportService,
  ) {}

  private selectWithTeamName() {
    return this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        model: projects.model,
        agent: projects.agent,
        agents: projects.agents,
        webSearch: projects.webSearch,
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
      // Personal projects are owner-only and team-less; direct
      // project_members rows never apply here, so we skip the
      // direct-membership lookup entirely rather than querying for
      // IDs we'd immediately discard.
      rows = await this.selectWithTeamName()
        .where(and(eq(projects.userId, userId), isNull(projects.teamId)))
        .orderBy(desc(projects.createdAt));
    } else {
      // Projects the user has *direct* access to via `project_members`
      // (the "Other" group in the invite dialog). These are projects
      // they were pulled into individually — not via team membership.
      // The chat surface should treat them as first-class so the
      // invitee actually sees the project they were invited to.
      //   - 'team': include — the project IS team-bound in the data
      //     model, the user just got there through a different gate.
      //   - 'all': include.
      //   - 'personal': omitted (handled above) — these are typically
      //     team-bound projects, so the 'all' tab is their home.
      const directProjectIdRows = await this.db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, userId));
      const directProjectIds = directProjectIdRows.map((r) => r.projectId);

      if (filter === 'team') {
        const conditions: SQL[] = [];
        if (teamIds.length > 0) {
          conditions.push(inArray(projects.teamId, teamIds));
        }
        if (directProjectIds.length > 0) {
          conditions.push(inArray(projects.id, directProjectIds));
        }
        if (conditions.length === 0) return [];
        rows = await this.selectWithTeamName()
          .where(or(...conditions))
          .orderBy(desc(projects.createdAt));
      } else {
        // 'all' — personal + team projects + direct-invite projects.
        const conditions = [
          and(eq(projects.userId, userId), isNull(projects.teamId)),
        ];
        if (teamIds.length > 0) {
          conditions.push(inArray(projects.teamId, teamIds));
        }
        if (directProjectIds.length > 0) {
          conditions.push(inArray(projects.id, directProjectIds));
        }
        rows = await this.selectWithTeamName()
          .where(or(...conditions))
          .orderBy(desc(projects.createdAt));
      }
    }

    const withMembers = await this.enrichWithTeamMembers(rows);
    return this.enrichWithPermissions(withMembers, userId);
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
    T extends { id: string; teamId: string | null; userId: string },
  >(
    rows: T[],
  ): Promise<
    Array<
      T & {
        teamMembers?: ProjectMemberPreview[];
        teamMembersCount?: number;
      }
    >
  > {
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

  /**
   * Attach `canManage` (may edit: rename, change model, web search) and
   * `canDelete` (owner-only) to every row, so the FE can disable actions
   * the caller can't perform instead of letting them fail with a 403.
   * Mirrors the gates in `update()` / `remove()`:
   *   - personal project → manage & delete both require ownership
   *   - team project → manage requires owner|admin|manager|editor in the
   *     team; delete still requires being the project's owner row.
   * Batched: one query for owned teams + one for the caller's memberships
   * across every distinct team in the result (no per-project round-trip).
   */
  private async enrichWithPermissions<
    T extends { id: string; teamId: string | null; userId: string },
  >(
    rows: T[],
    userId: string,
  ): Promise<Array<T & { canManage: boolean; canDelete: boolean }>> {
    const distinctTeamIds = Array.from(
      new Set(
        rows.map((r) => r.teamId).filter((id): id is string => id != null),
      ),
    );

    const manageableTeamIds = new Set<string>();
    if (distinctTeamIds.length > 0) {
      const owned = await this.db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, distinctTeamIds), eq(teams.ownerId, userId)));
      owned.forEach((t) => manageableTeamIds.add(t.id));

      // Owner-equivalent + editor roles may manage projects; viewers (and
      // legacy `basic`) may not. `advanced` is the legacy editor label.
      const MANAGE_ROLES = ['owner', 'admin', 'manager', 'editor', 'advanced'];
      const memberRows = await this.db
        .select({ teamId: teamMembers.teamId, role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            inArray(teamMembers.teamId, distinctTeamIds),
            eq(teamMembers.userId, userId),
            eq(teamMembers.status, 'accepted'),
          ),
        );
      for (const m of memberRows) {
        if (MANAGE_ROLES.includes(m.role)) manageableTeamIds.add(m.teamId);
      }
    }

    return rows.map((r) => ({
      ...r,
      canManage: r.teamId
        ? manageableTeamIds.has(r.teamId)
        : r.userId === userId,
      canDelete: r.userId === userId,
    }));
  }

  async findOne(id: string, userId: string) {
    // selectWithTeamName left-joins teams so the response carries the
    // team's display name. The simpler .select().from(projects) call
    // we used before only returned the FK and the FE then rendered
    // "Team" as a hard-coded fallback in the Invite Members dialog.
    const [project] = await this.selectWithTeamName().where(
      eq(projects.id, id),
    );

    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    // Access sources (any one is sufficient), strictly additive over
    // the legacy model so a row in `project_members` widens the gate
    // but never narrows it: owner, team membership, direct invite.
    let hasAccess = project.userId === userId;

    if (!hasAccess && project.teamId) {
      const role = await this.teamsService.getUserTeamRole(
        project.teamId,
        userId,
      );
      if (role) hasAccess = true;
    }

    if (!hasAccess) {
      const [direct] = await this.db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, id),
            eq(projectMembers.userId, userId),
          ),
        )
        .limit(1);
      if (direct) hasAccess = true;
    }

    if (!hasAccess) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    // Tell the FE whether the org/team allows web search so it can
    // show/hide the per-project toggle.
    const webSearchAllowed = await resolveWebSearchCapability(
      this.db,
      userId,
      project.teamId,
    );

    // Web search rides on the OpenRouter web plugin, which is
    // OpenRouter-specific — it does NOT work on BYOK / custom
    // OpenAI-compatible routes even though those also use the openai-sdk
    // transport kind. Resolve the transport so the FE can disable the toggle
    // instead of silently no-op-ing. Only computed when allowed (the toggle
    // is hidden otherwise) to avoid the extra lookup on every project open.
    // Fail open to the OpenRouter assumption on any resolve error.
    let webSearchSupported = false;
    if (webSearchAllowed) {
      try {
        const transport = await this.chatTransport.resolve({
          userId,
          modelIdentifier: project.model,
          projectId: project.id,
        });
        webSearchSupported = transport.source === 'openrouter';
      } catch {
        webSearchSupported = true;
      }
    }
    return { ...project, webSearchAllowed, webSearchSupported };
  }

  /**
   * Keep the active agent and its pool consistent so the header switcher
   * always has something to render: the pool is never empty and always
   * contains the active agent (added to the front when missing). Callers
   * pass a concrete active agent (resolved from the DTO / existing row).
   *
   * Exception — a "direct model" project (no agent AND no pool): the project
   * is pinned to `model` and the header shows the model name instead of an
   * agent switcher, so we keep the pool genuinely empty.
   */
  private static normalizeAgents(
    agent: string,
    agents: string[],
  ): { agent: string; agents: string[] } {
    if (!agent && agents.length === 0) return { agent: '', agents: [] };
    const pool = agents.length > 0 ? [...agents] : [agent];
    if (!pool.includes(agent)) pool.unshift(agent);
    return { agent, agents: pool };
  }

  /**
   * Project names must be unique within their scope: personal projects are
   * scoped to the owner (their non-team projects), team projects to the team.
   * The compare is trimmed and case-insensitive so " Foo " and "foo" collide.
   * `excludeId` lets a rename skip the row being updated. Throws 409 on clash.
   */
  private async assertNameAvailable(
    name: string,
    scope: { userId: string; teamId: string | null },
    excludeId?: string,
  ) {
    const conditions: SQL[] = [
      scope.teamId
        ? eq(projects.teamId, scope.teamId)
        : (and(
            eq(projects.userId, scope.userId),
            isNull(projects.teamId),
          ) as SQL),
      sql`lower(trim(${projects.name})) = lower(${name.trim()})`,
    ];
    if (excludeId) conditions.push(ne(projects.id, excludeId));

    const [existing] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      throw new ConflictException('A project with this name already exists');
    }
  }

  /**
   * The DB-level backstop for {@link assertNameAvailable}: a unique-violation
   * (Postgres 23505) on one of the scoped project-name indexes. Two concurrent
   * inserts can both pass the SELECT pre-check, but only one survives the
   * index — translate the loser's error into the same friendly 409 instead of
   * a 500. Scoped to our two indexes so an unrelated unique clash isn't masked.
   */
  private static isProjectNameConflict(error: unknown): boolean {
    // node-postgres throws the pg DatabaseError directly (code + constraint
    // on the error itself); also check `.cause` in case a layer wraps it.
    const candidates = [
      error,
      (error as { cause?: unknown } | null)?.cause,
    ] as Array<{ code?: string; constraint?: string } | null | undefined>;
    return candidates.some(
      (e) =>
        e?.code === '23505' &&
        (e.constraint === 'projects_personal_name_unique' ||
          e.constraint === 'projects_team_name_unique'),
    );
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

    // Reject a duplicate name in the same scope before inserting, so the
    // FE can surface a clear "name already taken" form error.
    await this.assertNameAvailable(dto.name, {
      userId,
      teamId: dto.teamId ?? null,
    });

    // Active agent + the picked pool, normalized so the pool is never
    // empty and always contains the active agent. Default the active agent
    // to the general assistant (also the active when only a pool is given).
    const { agent, agents } = ProjectsService.normalizeAgents(
      dto.agent ?? dto.agents?.[0] ?? 'general-assistant',
      dto.agents ?? [],
    );
    let project;
    try {
      [project] = await this.db
        .insert(projects)
        .values({
          name: dto.name,
          description: dto.description,
          model: dto.model,
          agent,
          agents,
          userId,
          teamId: dto.teamId ?? null,
        })
        .returning();
    } catch (error) {
      // Race-safe backstop: a concurrent create slipped past the pre-check
      // and the unique index rejected this one. Same friendly 409.
      if (ProjectsService.isProjectNameConflict(error)) {
        throw new ConflictException('A project with this name already exists');
      }
      throw error;
    }

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

    // A rename must not collide with another project in the same scope.
    // Skip the check when the name is unchanged (ignoring case/whitespace).
    if (
      dto.name !== undefined &&
      dto.name.trim().toLowerCase() !== project.name.trim().toLowerCase()
    ) {
      await this.assertNameAvailable(
        dto.name,
        { userId: project.userId, teamId: project.teamId },
        project.id,
      );
    }

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.model !== undefined) updates.model = dto.model;
    // Normalize agent + pool together whenever either changes, merging with
    // the existing row, so we never persist an active agent outside its pool
    // (or an empty pool). A header switch sends only `agent`; the change-model
    // dialog sends both.
    if (dto.agent !== undefined || dto.agents !== undefined) {
      const { agent, agents } = ProjectsService.normalizeAgents(
        dto.agent ?? project.agent,
        dto.agents ?? project.agents,
      );
      updates.agent = agent;
      updates.agents = agents;
    }
    if (dto.webSearch !== undefined) {
      // Turning web search ON requires the org/team capability. Turning
      // it OFF is always allowed (so a project can be cleaned up even
      // after the capability is revoked).
      if (dto.webSearch) {
        const allowed = await resolveWebSearchCapability(
          this.db,
          userId,
          project.teamId,
        );
        if (!allowed) {
          throw new ForbiddenException(
            'Web search is not enabled for this organization or team.',
          );
        }
      }
      updates.webSearch = dto.webSearch;
    }
    if (Object.keys(updates).length === 0) return project;
    updates.updatedAt = new Date();

    let updated;
    try {
      [updated] = await this.db
        .update(projects)
        .set(updates)
        .where(eq(projects.id, id))
        .returning();
    } catch (error) {
      // Race-safe backstop for a concurrent rename — see create().
      if (ProjectsService.isProjectNameConflict(error)) {
        throw new ConflictException('A project with this name already exists');
      }
      throw error;
    }

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
