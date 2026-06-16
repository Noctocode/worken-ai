import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  skills,
  skillTeams,
  teamMembers,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';

export type SkillVisibility = 'all' | 'admins' | 'teams';

export interface CreateSkillInput {
  name: string;
  description: string;
  instructions: string;
  visibility?: string;
  teamIds?: string[];
  source?: 'manual' | 'import';
}

export type UpdateSkillInput = Partial<
  Pick<CreateSkillInput, 'name' | 'description' | 'instructions'>
>;

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documentsService: DocumentsService,
  ) {}

  /**
   * The text that gets embedded for the Stage-1 router prefilter: name +
   * description. MUST go through DocumentsService.embed so the vector lives
   * in the SAME model space (Xenova/all-MiniLM-L6-v2, 384-dim) as the KC
   * chunk + message vectors — cosine across different models is meaningless.
   */
  private embeddingInput(name: string, description: string): string {
    return `${name}\n${description}`;
  }

  /**
   * Compute + persist a skill's description embedding. Fire-and-forget from
   * the create/update paths (`void this.refreshEmbedding(id)`): a slow or
   * down embedder must NOT block skill writes. The router tolerates a null
   * embedding (skips the row) until this backfill lands, mirroring the KC
   * ingest pipeline's async-embed approach.
   */
  async refreshEmbedding(skillId: string): Promise<void> {
    try {
      const [row] = await this.db
        .select({ name: skills.name, description: skills.description })
        .from(skills)
        .where(eq(skills.id, skillId));
      if (!row) return;
      const [embedding] = await this.documentsService.embed([
        this.embeddingInput(row.name, row.description),
      ]);
      await this.db
        .update(skills)
        .set({ descriptionEmbedding: embedding })
        .where(eq(skills.id, skillId));
    } catch (err) {
      // Leave descriptionEmbedding null; the skill stays editable and the
      // router simply won't auto-select it until a later write succeeds.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to embed skill ${skillId}; leaving it unembedded: ${msg}`,
      );
    }
  }

  private async readProfile(
    userId: string,
  ): Promise<{ scope: 'personal' | 'company'; isAdmin: boolean }> {
    const [u] = await this.db
      .select({ profileType: users.profileType, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    return {
      scope: u?.profileType === 'company' ? 'company' : 'personal',
      isAdmin: u?.role === 'admin',
    };
  }

  /**
   * Validate the requested visibility against the caller's scope + role.
   * Mirrors knowledge-core's resolveUploadVisibility (minus 'project',
   * which skills don't have): 'admins' is admin-only, 'teams' needs a
   * company profile.
   */
  private resolveVisibility(
    input: string | undefined,
    scope: 'personal' | 'company',
    isAdmin: boolean,
  ): SkillVisibility {
    if (input == null || input === '') return 'all';
    if (input !== 'all' && input !== 'admins' && input !== 'teams') {
      throw new BadRequestException(
        `Invalid visibility "${input}". Must be 'all', 'admins', or 'teams'.`,
      );
    }
    if (scope === 'personal' && input !== 'all') {
      throw new BadRequestException(
        'Restricted visibility requires a company profile — personal skills are owner-only.',
      );
    }
    if (input === 'admins' && !isAdmin) {
      throw new ForbiddenException(
        'Only admins can mark a skill as admin-only.',
      );
    }
    return input;
  }

  /**
   * Normalize + authorize the team IDs for 'teams' visibility: non-empty,
   * and (non-admin) every id must be a team the caller is an accepted
   * member of. Mirrors knowledge-core's resolveAssignableTeamIds.
   */
  private async resolveAssignableTeamIds(
    input: string[] | undefined,
    callerId: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        '`teamIds` must be an array when visibility is "teams".',
      );
    }
    const unique = [
      ...new Set(input.filter((t) => typeof t === 'string' && t)),
    ];
    if (unique.length === 0) {
      throw new BadRequestException(
        'Team visibility requires at least one team — otherwise no one could see the skill.',
      );
    }
    if (isAdmin) return unique;
    const rows = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, callerId),
          eq(teamMembers.status, 'accepted'),
          inArray(teamMembers.teamId, unique),
        ),
      );
    const allowed = new Set(rows.map((r) => r.teamId));
    const denied = unique.filter((t) => !allowed.has(t));
    if (denied.length > 0) {
      throw new ForbiddenException(
        `You can only share a skill with teams you belong to. Not a member of: ${denied.join(', ')}.`,
      );
    }
    return unique;
  }

  async list(userId: string) {
    return this.db
      .select({
        id: skills.id,
        name: skills.name,
        description: skills.description,
        instructions: skills.instructions,
        scope: skills.scope,
        visibility: skills.visibility,
        isActive: skills.isActive,
        source: skills.source,
        createdAt: skills.createdAt,
        updatedAt: skills.updatedAt,
      })
      .from(skills)
      .where(eq(skills.userId, userId))
      .orderBy(desc(skills.updatedAt));
  }

  async get(id: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)));
    if (!row) throw new NotFoundException('Skill not found.');
    return row;
  }

  async create(userId: string, input: CreateSkillInput) {
    const name = input.name?.trim();
    const description = input.description?.trim();
    const instructions = input.instructions?.trim();
    if (!name) throw new BadRequestException('`name` is required.');
    if (!description)
      throw new BadRequestException('`description` is required.');
    if (!instructions)
      throw new BadRequestException('`instructions` is required.');

    const { scope, isAdmin } = await this.readProfile(userId);
    const visibility = this.resolveVisibility(input.visibility, scope, isAdmin);
    const teamIds =
      visibility === 'teams'
        ? await this.resolveAssignableTeamIds(input.teamIds, userId, isAdmin)
        : [];

    const [row] = await this.db
      .insert(skills)
      .values({
        userId,
        name,
        description,
        instructions,
        scope,
        visibility,
        source: input.source === 'import' ? 'import' : 'manual',
      })
      .returning();

    if (teamIds.length > 0) {
      await this.db
        .insert(skillTeams)
        .values(teamIds.map((teamId) => ({ skillId: row.id, teamId })));
    }

    // Async — don't block the create response on the embedder.
    void this.refreshEmbedding(row.id);
    return row;
  }

  async update(id: string, userId: string, input: UpdateSkillInput) {
    const [existing] = await this.db
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)));
    if (!existing) throw new NotFoundException('Skill not found.');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    let routingChanged = false;
    if (input.name !== undefined) {
      if (!input.name.trim())
        throw new BadRequestException('`name` cannot be empty.');
      patch.name = input.name.trim();
      routingChanged = true;
    }
    if (input.description !== undefined) {
      if (!input.description.trim())
        throw new BadRequestException('`description` cannot be empty.');
      patch.description = input.description.trim();
      routingChanged = true;
    }
    if (input.instructions !== undefined) {
      if (!input.instructions.trim())
        throw new BadRequestException('`instructions` cannot be empty.');
      patch.instructions = input.instructions.trim();
    }

    const [row] = await this.db
      .update(skills)
      .set(patch)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)))
      .returning();

    // Re-embed only when the routing text (name/description) changed.
    if (routingChanged) void this.refreshEmbedding(id);
    return row;
  }

  async updateVisibility(
    id: string,
    userId: string,
    visibilityInput: string | undefined,
    teamIds: string[] | undefined,
  ) {
    const [existing] = await this.db
      .select({ id: skills.id, scope: skills.scope })
      .from(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)));
    if (!existing) throw new NotFoundException('Skill not found.');

    const { isAdmin } = await this.readProfile(userId);
    const visibility = this.resolveVisibility(
      visibilityInput,
      existing.scope as 'personal' | 'company',
      isAdmin,
    );
    const resolvedTeamIds =
      visibility === 'teams'
        ? await this.resolveAssignableTeamIds(teamIds, userId, isAdmin)
        : [];

    // Replace the team link set wholesale — simplest correct semantics.
    await this.db.delete(skillTeams).where(eq(skillTeams.skillId, id));
    if (resolvedTeamIds.length > 0) {
      await this.db
        .insert(skillTeams)
        .values(resolvedTeamIds.map((teamId) => ({ skillId: id, teamId })));
    }

    const [row] = await this.db
      .update(skills)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(skills.id, id), eq(skills.userId, userId)))
      .returning();
    return row;
  }

  async delete(id: string, userId: string): Promise<void> {
    const deleted = await this.db
      .delete(skills)
      .where(and(eq(skills.id, id), eq(skills.userId, userId)))
      .returning({ id: skills.id });
    if (deleted.length === 0) throw new NotFoundException('Skill not found.');
  }
}
