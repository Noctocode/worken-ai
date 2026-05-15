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
  knowledgeFiles,
  knowledgeFileTeams,
  knowledgeFolders,
  projectKnowledgeFiles,
  projects,
  teamMembers,
  teams,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { KnowledgeCoreService } from '../knowledge-core/knowledge-core.service.js';

/**
 * Default KC folder that Manage Context uploads land in when the
 * user doesn't pick a target. Auto-created on first upload per
 * user — kept as a name string here (not an env / config) so the
 * folder lives in the user's KC like any other folder.
 */
const DEFAULT_PROJECTS_FOLDER_NAME = 'Projects';

/**
 * Compact shape returned by the attach-list endpoint. Carries the
 * info Manage Context needs to render a row (name, type, badges,
 * status) without forcing a follow-up to /knowledge-core.
 */
export interface ProjectKnowledgeFileView {
  fileId: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  folderId: string;
  folderName: string;
  visibility: string;
  ingestionStatus: string;
  ingestionError: string | null;
  teams: Array<{ id: string; name: string }>;
  attachedAt: string;
}

@Injectable()
export class ProjectKnowledgeService {
  private readonly logger = new Logger(ProjectKnowledgeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly knowledgeCore: KnowledgeCoreService,
  ) {}

  /**
   * Project access gate shared by all the methods below. Mirrors
   * the existing rule on chat: any team member can read a team
   * project; personal projects are owner-only. Throws 404 on
   * non-existent or denied to keep info leakage minimal.
   */
  private async assertProjectAccess(
    projectId: string,
    userId: string,
  ): Promise<{ teamId: string | null; userId: string }> {
    const [project] = await this.db
      .select({ userId: projects.userId, teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (project.teamId) {
      const [membership] = await this.db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, project.teamId),
            eq(teamMembers.userId, userId),
            eq(teamMembers.status, 'accepted'),
          ),
        )
        .limit(1);
      const isOwner = project.userId === userId;
      const [team] = await this.db
        .select({ ownerId: teams.ownerId })
        .from(teams)
        .where(eq(teams.id, project.teamId))
        .limit(1);
      const isTeamOwner = team?.ownerId === userId;
      if (!isOwner && !isTeamOwner && !membership) {
        throw new NotFoundException(`Project ${projectId} not found`);
      }
    } else if (project.userId !== userId) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return { teamId: project.teamId, userId: project.userId };
  }

  /**
   * KC files currently attached to this project. Used by the Manage
   * Context dialog to render the unified document list and by the
   * chat layer to know which KC chunks to mix into RAG context.
   */
  async listAttached(
    projectId: string,
    callerId: string,
  ): Promise<ProjectKnowledgeFileView[]> {
    await this.assertProjectAccess(projectId, callerId);

    const rows = await this.db
      .select({
        fileId: knowledgeFiles.id,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        folderId: knowledgeFiles.folderId,
        folderName: knowledgeFolders.name,
        visibility: knowledgeFiles.visibility,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        attachedAt: projectKnowledgeFiles.attachedAt,
      })
      .from(projectKnowledgeFiles)
      .innerJoin(
        knowledgeFiles,
        eq(knowledgeFiles.id, projectKnowledgeFiles.fileId),
      )
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(projectKnowledgeFiles.projectId, projectId))
      .orderBy(desc(projectKnowledgeFiles.attachedAt));

    // Hydrate team links per file (only meaningful when
    // visibility='teams'; safe + empty otherwise).
    const fileIds = rows.map((r) => r.fileId);
    const teamLinks = await this.hydrateTeamLinks(fileIds);

    return rows.map((r) => ({
      ...r,
      attachedAt: r.attachedAt.toISOString(),
      teams: teamLinks.get(r.fileId) ?? [],
    }));
  }

  /**
   * Attach an existing set of KC files to the project. Validates
   * each file is owned by the caller (preventing attach of
   * someone else's KC file by id-guessing). Idempotent — the
   * composite PK + ON CONFLICT DO NOTHING swallows duplicates.
   */
  async attach(
    projectId: string,
    fileIds: string[],
    callerId: string,
  ): Promise<{ attached: string[] }> {
    await this.assertProjectAccess(projectId, callerId);
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      throw new BadRequestException('`fileIds` must be a non-empty array.');
    }
    const unique = Array.from(
      new Set(fileIds.filter((s) => typeof s === 'string' && s.length > 0)),
    );

    // Caller must own each file. We don't allow attaching someone
    // else's file via an id even if the caller can technically see
    // it via team scope — they should re-upload (which goes
    // through KC's own visibility flow) instead.
    const owned = await this.db
      .select({ id: knowledgeFiles.id })
      .from(knowledgeFiles)
      .where(
        and(
          eq(knowledgeFiles.uploadedById, callerId),
          inArray(knowledgeFiles.id, unique),
        ),
      );
    const ownedIds = new Set(owned.map((r) => r.id));
    const denied = unique.filter((id) => !ownedIds.has(id));
    if (denied.length > 0) {
      throw new ForbiddenException(
        'You can only attach knowledge files you uploaded.',
      );
    }

    const rows = unique.map((fileId) => ({
      projectId,
      fileId,
      attachedBy: callerId,
    }));
    await this.db
      .insert(projectKnowledgeFiles)
      .values(rows)
      .onConflictDoNothing();

    return { attached: unique };
  }

  /**
   * Detach a single KC file from the project. The file itself
   * stays in KC — only the link row is removed.
   */
  async detach(
    projectId: string,
    fileId: string,
    callerId: string,
  ): Promise<{ ok: true }> {
    await this.assertProjectAccess(projectId, callerId);
    await this.db
      .delete(projectKnowledgeFiles)
      .where(
        and(
          eq(projectKnowledgeFiles.projectId, projectId),
          eq(projectKnowledgeFiles.fileId, fileId),
        ),
      );
    return { ok: true };
  }

  /**
   * Upload a file from the Manage Context dialog. Routes through
   * KnowledgeCoreService.uploadFiles so dedupe + ingestion + team-
   * visibility validation all match a plain KC upload. After the
   * insert lands, the resulting file is attached to the project.
   *
   * `folderId` is optional — when omitted, we auto-create / reuse
   * the caller's "Projects" folder so users who don't want to
   * juggle KC mapping just get a sensible default. Visibility
   * defaults are decided by the controller (smart default by
   * project scope) and passed through here verbatim.
   */
  async uploadAndAttach(
    projectId: string,
    callerId: string,
    files: Express.Multer.File[],
    options: {
      folderId?: string;
      visibility?: string;
      teamIds?: string[];
      projectIds?: string[];
      nameConflictActions?: Record<
        string,
        'overwrite' | 'keep_both' | 'skip'
      >;
    },
  ): Promise<{
    uploaded: Array<{ id: string; name: string; ingestionStatus: string }>;
    duplicates: Array<{
      name: string;
      existing: { id: string | null; name: string; folderId: string; folderName: string };
    }>;
    nameConflicts: Array<{ name: string; existing: { id: string } }>;
  }> {
    await this.assertProjectAccess(projectId, callerId);
    if (files.length === 0) {
      throw new BadRequestException('Pick at least one file to upload.');
    }

    const folderId =
      options.folderId ??
      (await this.ensureDefaultProjectsFolder(callerId));

    const result = await this.knowledgeCore.uploadFiles(
      folderId,
      callerId,
      files,
      options.visibility,
      options.teamIds,
      options.projectIds,
      options.nameConflictActions,
    );

    // Auto-attach every successful upload to this project. The
    // dedupe path may flag duplicates against existing KC rows —
    // those we also attach (`existing.id`) so the user sees them
    // in Manage Context even if no new file was created.
    const attachIds: string[] = [];
    for (const row of result.uploaded) {
      attachIds.push(row.id);
    }
    for (const dup of result.duplicates) {
      if (dup.existing.id) attachIds.push(dup.existing.id);
    }
    if (attachIds.length > 0) {
      await this.db
        .insert(projectKnowledgeFiles)
        .values(
          Array.from(new Set(attachIds)).map((fileId) => ({
            projectId,
            fileId,
            attachedBy: callerId,
          })),
        )
        .onConflictDoNothing();
    }

    return {
      uploaded: result.uploaded.map((u) => ({
        id: u.id,
        name: u.name,
        ingestionStatus: u.ingestionStatus,
      })),
      duplicates: result.duplicates,
      nameConflicts: result.nameConflicts,
    };
  }

  /**
   * Look up — or lazily create — the caller's "Projects" KC folder
   * used as the default upload destination from Manage Context.
   * Per-user: each user gets their own "Projects" folder under
   * their own KC; team projects don't share a folder by design
   * (KC visibility is set per file, not per folder).
   */
  private async ensureDefaultProjectsFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, DEFAULT_PROJECTS_FOLDER_NAME),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({ ownerId: userId, name: DEFAULT_PROJECTS_FOLDER_NAME })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  /**
   * Visibility "smart default" for the Manage Context upload UI.
   * Used by the controller to pick a sensible default the user
   * can still override:
   *
   *  - Team project → 'teams' with that project's team pre-
   *    selected (only members of that team see the file in RAG).
   *  - Personal project on a company-profile user → 'all' (every
   *    company user can see it; matches the project's reach since
   *    chat-time RAG already pulls company-scope KC).
   *  - Personal project on a personal-profile user → 'all' too
   *    (no scoping option to differentiate anyway).
   *
   * Returns a hint the FE renders as the initial picker state.
   */
  async getUploadDefaults(
    projectId: string,
    callerId: string,
  ): Promise<{
    folderId: string;
    folderName: string;
    visibility: 'all' | 'teams';
    teamIds: string[];
  }> {
    const access = await this.assertProjectAccess(projectId, callerId);

    // Folder default → caller's "Projects" folder (lazy-created).
    const folderId = await this.ensureDefaultProjectsFolder(callerId);

    if (access.teamId) {
      return {
        folderId,
        folderName: DEFAULT_PROJECTS_FOLDER_NAME,
        visibility: 'teams',
        teamIds: [access.teamId],
      };
    }
    return {
      folderId,
      folderName: DEFAULT_PROJECTS_FOLDER_NAME,
      visibility: 'all',
      teamIds: [],
    };
  }

  /**
   * Resolve per-file team-link maps for a batch of file ids. One
   * round-trip regardless of list size; mirrors the same helper in
   * KnowledgeCoreService (kept private here to avoid leaking
   * internal join shape). Empty maps for files not in 'teams' mode.
   */
  private async hydrateTeamLinks(
    fileIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const out = new Map<string, Array<{ id: string; name: string }>>();
    if (fileIds.length === 0) return out;
    const links = await this.db
      .select({
        fileId: knowledgeFileTeams.fileId,
        teamId: teams.id,
        teamName: teams.name,
      })
      .from(knowledgeFileTeams)
      .innerJoin(teams, eq(teams.id, knowledgeFileTeams.teamId))
      .where(inArray(knowledgeFileTeams.fileId, fileIds));
    for (const link of links) {
      const arr = out.get(link.fileId) ?? [];
      arr.push({ id: link.teamId, name: link.teamName });
      out.set(link.fileId, arr);
    }
    return out;
  }

  /**
   * Lookup helper used by the chat-time RAG path: list KC file ids
   * currently attached to a project. Wrapped in a tiny method (vs
   * the public `listAttached`) so the chat code stays narrow and
   * doesn't ask for visibility / folder data it doesn't need.
   */
  async getAttachedFileIds(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ fileId: projectKnowledgeFiles.fileId })
      .from(projectKnowledgeFiles)
      .where(eq(projectKnowledgeFiles.projectId, projectId));
    return rows.map((r) => r.fileId);
  }
}

