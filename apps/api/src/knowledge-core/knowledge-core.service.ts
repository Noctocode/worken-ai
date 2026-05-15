import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import {
  knowledgeFolders,
  knowledgeFiles,
  knowledgeFileTeams,
  knowledgeChunks,
  projectKnowledgeFiles,
  projects,
  teamMembers,
  teams,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Stream a file from disk through SHA-256. Avoids loading the whole
 * buffer into memory — multer already wrote the file to disk so we
 * just need a hash, not the bytes. Used by the upload path to
 * detect duplicates the same user already has in their KC.
 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

@Injectable()
export class KnowledgeCoreService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
  ) {}

  async findAllFolders(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFolders.id,
        name: knowledgeFolders.name,
        ownerId: knowledgeFolders.ownerId,
        createdAt: knowledgeFolders.createdAt,
        updatedAt: knowledgeFolders.updatedAt,
        fileCount: sql<string>`count(${knowledgeFiles.id})`.as('file_count'),
        totalBytes: sql<string>`coalesce(sum(${knowledgeFiles.sizeBytes}), 0)`.as(
          'total_bytes',
        ),
      })
      .from(knowledgeFolders)
      .leftJoin(
        knowledgeFiles,
        eq(knowledgeFiles.folderId, knowledgeFolders.id),
      )
      .where(eq(knowledgeFolders.ownerId, userId))
      .groupBy(
        knowledgeFolders.id,
        knowledgeFolders.name,
        knowledgeFolders.ownerId,
        knowledgeFolders.createdAt,
        knowledgeFolders.updatedAt,
      )
      .orderBy(desc(knowledgeFolders.updatedAt));

    return rows.map((r) => ({
      ...r,
      fileCount: Number(r.fileCount),
      totalBytes: Number(r.totalBytes),
    }));
  }

  async findFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    const files = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        storagePath: knowledgeFiles.storagePath,
        uploadedById: knowledgeFiles.uploadedById,
        uploadedByName: users.name,
        // Surface ingestion status so the FE can render the per-file
        // training badge without a second round-trip.
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        // Surfaced so the row UI can render the 'Admin only' badge
        // and the action menu can flip it via PATCH.
        visibility: knowledgeFiles.visibility,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFiles.folderId, id))
      .orderBy(desc(knowledgeFiles.createdAt));

    // Hydrate team + project links so the row badge can render names
    // without an N+1. Two round-trips for the whole folder keeps
    // this O(1) regardless of file count.
    const fileIds = files.map((f) => f.id);
    const [teamLinks, projectLinks] = await Promise.all([
      this.hydrateTeamLinks(fileIds),
      this.hydrateProjectLinks(fileIds),
    ]);
    const filesWithLinks = files.map((f) => ({
      ...f,
      teams: teamLinks.get(f.id) ?? [],
      projects: projectLinks.get(f.id) ?? [],
    }));

    return { ...folder, files: filesWithLinks };
  }

  /**
   * Resolve per-file team-link maps in a single query so callers
   * (folder detail, recent list) can stamp `teams: [{id, name}]`
   * onto every file without an N+1.
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
   * Mirror of hydrateTeamLinks but for project links — used to stamp
   * `projects: [{id, name}]` onto files with visibility='project' so
   * the row badge can render names without a per-file lookup.
   */
  private async hydrateProjectLinks(
    fileIds: string[],
  ): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const out = new Map<string, Array<{ id: string; name: string }>>();
    if (fileIds.length === 0) return out;
    const links = await this.db
      .select({
        fileId: projectKnowledgeFiles.fileId,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projectKnowledgeFiles)
      .innerJoin(projects, eq(projects.id, projectKnowledgeFiles.projectId))
      .where(inArray(projectKnowledgeFiles.fileId, fileIds));
    for (const link of links) {
      const arr = out.get(link.fileId) ?? [];
      arr.push({ id: link.projectId, name: link.projectName });
      out.set(link.fileId, arr);
    }
    return out;
  }

  async createFolder(name: string, userId: string) {
    const [folder] = await this.db
      .insert(knowledgeFolders)
      .values({ name: name.trim(), ownerId: userId })
      .returning();
    return folder;
  }

  async deleteFolder(id: string, userId: string) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId)
      throw new ForbiddenException('Access denied');

    const fileRows = await this.db
      .select({ storagePath: knowledgeFiles.storagePath })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.folderId, id));

    await this.db
      .delete(knowledgeFolders)
      .where(eq(knowledgeFolders.id, id));

    await Promise.allSettled(
      fileRows.map(async ({ storagePath }) => {
        if (!storagePath) return;
        try {
          await fs.promises.unlink(
            path.resolve(process.cwd(), storagePath),
          );
        } catch {
          // File may already be removed
        }
      }),
    );
  }

  async uploadFiles(
    folderId: string,
    userId: string,
    files: Express.Multer.File[],
    visibilityInput?: string,
    teamIdsInput?: string[],
    projectIdsInput?: string[],
  ) {
    const [folder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, folderId));

    if (!folder) throw new NotFoundException('Folder not found');
    if (folder.ownerId !== userId) throw new ForbiddenException('Access denied');

    // Visibility for chat-time RAG search: company-profile uploaders
    // make their files org-wide ('company'); personal-profile keep
    // them private ('personal'). One round-trip to read profileType +
    // role is fine — uploads aren't a hot path. Role check is needed
    // a few lines below to gate the 'admins' visibility privilege.
    const [uploader] = await this.db
      .select({ profileType: users.profileType, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    const scope =
      uploader?.profileType === 'company' ? 'company' : 'personal';

    // Secondary visibility within the scope. Default 'all' keeps
    // legacy behaviour. 'admins' is a privilege — only an admin can
    // promote an upload to admin-only at creation time. Force 'all'
    // for anyone else so a basic user can't sneak in an admin-only
    // upload via crafted multipart fields. Validate the enum so any
    // typo from the client surfaces as a clear 400 instead of being
    // silently coerced to 'all'.
    const visibility = this.resolveUploadVisibility(
      visibilityInput,
      uploader?.role,
      scope,
    );

    // For 'teams' visibility: resolve the caller-supplied team IDs to
    // a validated set the caller actually belongs to (admin bypass —
    // any company team is fair game). Bail out before any file write
    // if the input is empty or contains a team the caller can't
    // assign to.
    const allowedTeamIds =
      visibility === 'teams'
        ? await this.resolveAssignableTeamIds(
            teamIdsInput ?? [],
            userId,
            uploader?.role === 'admin',
          )
        : [];

    // For 'project' visibility: same shape as teams but for projects.
    // The project link rows in project_knowledge_files double as the
    // access grant — chat-time RAG only surfaces these chunks inside
    // the linked project, never via the org-wide search.
    const allowedProjectIds =
      visibility === 'project'
        ? await this.resolveAssignableProjectIds(
            projectIdsInput ?? [],
            userId,
            uploader?.role === 'admin',
          )
        : [];

    // Hash every uploaded file up front so we can dedupe within the
    // batch and against the DB in two passes. Multer already wrote
    // each file to disk; we stream from there to keep memory flat.
    const hashed = await Promise.all(
      files.map(async (file) => ({
        file,
        hash: await sha256File(file.path),
      })),
    );

    // Look up existing rows by this user with any of the candidate
    // hashes. Scope is the uploader's whole KC (across all their
    // folders) per product decision — re-uploading the same bytes
    // anywhere surfaces the prior copy instead of creating a second
    // row. Limited to non-null hashes because legacy rows opt out.
    const candidateHashes = Array.from(new Set(hashed.map((h) => h.hash)));
    const existingRows = candidateHashes.length
      ? await this.db
          .select({
            id: knowledgeFiles.id,
            name: knowledgeFiles.name,
            folderId: knowledgeFiles.folderId,
            contentSha256: knowledgeFiles.contentSha256,
            folderName: knowledgeFolders.name,
          })
          .from(knowledgeFiles)
          .innerJoin(
            knowledgeFolders,
            eq(knowledgeFolders.id, knowledgeFiles.folderId),
          )
          .where(
            and(
              eq(knowledgeFiles.uploadedById, userId),
              inArray(knowledgeFiles.contentSha256, candidateHashes),
            ),
          )
      : [];
    const existingByHash = new Map<
      string,
      { id: string; name: string; folderId: string; folderName: string }
    >();
    for (const row of existingRows) {
      if (!row.contentSha256 || existingByHash.has(row.contentSha256)) continue;
      existingByHash.set(row.contentSha256, {
        id: row.id,
        name: row.name,
        folderId: row.folderId,
        folderName: row.folderName,
      });
    }

    // Split the batch: hashes already present in DB are duplicates;
    // remaining hashes that appear more than once within the batch
    // keep only the first occurrence (rest are flagged against the
    // first). The first occurrence is what gets inserted.
    const duplicates: Array<{
      name: string;
      existing: {
        id: string | null;
        name: string;
        folderId: string;
        folderName: string;
      };
    }> = [];
    const toInsert: Array<{
      file: Express.Multer.File;
      hash: string;
    }> = [];
    const firstInBatch = new Map<
      string,
      { name: string; folderName: string }
    >();
    for (const entry of hashed) {
      const dbHit = existingByHash.get(entry.hash);
      if (dbHit) {
        duplicates.push({
          name: entry.file.originalname,
          existing: dbHit,
        });
        continue;
      }
      const batchHit = firstInBatch.get(entry.hash);
      if (batchHit) {
        duplicates.push({
          name: entry.file.originalname,
          existing: {
            id: null,
            name: batchHit.name,
            folderId,
            folderName: batchHit.folderName,
          },
        });
        continue;
      }
      firstInBatch.set(entry.hash, {
        name: entry.file.originalname,
        folderName: folder.name,
      });
      toInsert.push(entry);
    }

    // Disk hygiene: tmp files multer wrote for duplicates won't be
    // referenced by any row, so they'd leak otherwise. Best-effort —
    // a leftover here is harmless except for disk space.
    if (duplicates.length > 0) {
      await Promise.allSettled(
        hashed
          .filter(
            (h) => !toInsert.includes(h) && h.file.path,
          )
          .map((h) => fs.promises.unlink(h.file.path)),
      );
    }

    const values = toInsert.map(({ file, hash }) => {
      const ext = path.extname(file.originalname).replace('.', '').toUpperCase();
      const fileType = ext || 'FILE';
      return {
        folderId,
        name: file.originalname,
        fileType,
        sizeBytes: file.size,
        storagePath: path.posix.join(
          'uploads/knowledge-core',
          path.basename(file.path),
        ),
        uploadedById: userId,
        scope,
        visibility,
        contentSha256: hash,
      };
    });

    try {
      const inserted = values.length
        ? await this.db.insert(knowledgeFiles).values(values).returning()
        : [];

      // Link every inserted file to the resolved team set so the
      // chat-time RAG filter (and the FE row badge) can see which
      // teams have access. Done in one INSERT regardless of how many
      // files / teams to keep the upload path fast.
      if (
        visibility === 'teams' &&
        inserted.length > 0 &&
        allowedTeamIds.length > 0
      ) {
        await this.db.insert(knowledgeFileTeams).values(
          inserted.flatMap((row) =>
            allowedTeamIds.map((teamId) => ({
              fileId: row.id,
              teamId,
            })),
          ),
        );
      }

      // 'project' visibility reuses project_knowledge_files for the
      // access grant — same table Manage Context populates when the
      // user attaches a KC file to a project. Inserting here both
      // pins the file to the chosen project's chat and surfaces it
      // in the project's Manage Context list automatically.
      if (
        visibility === 'project' &&
        inserted.length > 0 &&
        allowedProjectIds.length > 0
      ) {
        await this.db.insert(projectKnowledgeFiles).values(
          inserted.flatMap((row) =>
            allowedProjectIds.map((projectId) => ({
              projectId,
              fileId: row.id,
              attachedBy: userId,
            })),
          ),
        );
      }

      if (inserted.length > 0) {
        await this.db
          .update(knowledgeFolders)
          .set({ updatedAt: new Date() })
          .where(eq(knowledgeFolders.id, folderId));
      }

      // Kick off chunk + embed in the background. Same fire-and-
      // forget pattern as onboarding ingestion — the HTTP response
      // returns immediately while the worker processes the rows we
      // just inserted (visible to it because the INSERT above
      // committed). FE polls or refetches the file list to surface
      // the per-file status badge.
      if (inserted.length > 0) {
        this.knowledgeIngestion.ingestPendingFilesForUser(userId);
      }

      // Keep the upload response aligned with KnowledgeFile —
      // callers refetch the folder detail after upload, which
      // hydrates `teams: [{id,name}]` via hydrateTeamLinks. Adding
      // an ad-hoc `teamIds` here would break that contract for no
      // benefit.
      return { uploaded: inserted, duplicates };
    } catch (error) {
      await Promise.allSettled(
        toInsert
          .filter((entry) => entry.file.path)
          .map((entry) => fs.promises.unlink(entry.file.path)),
      );
      throw error;
    }
  }

  /**
   * Validate the visibility enum + enforce the admin-only privilege
   * for 'admins'. Shared between upload and PATCH so the same gate
   * applies regardless of how a row gets flipped.
   *
   * 'teams' / 'project' are only meaningful for company-scope uploads
   * — personal scope is owner-only already, so a teams- or project-
   * restricted personal file would just be owner-only with extra
   * steps. Rejected up front instead of silently downgraded so the FE
   * can show a clear error if it ever sends the wrong shape.
   */
  private resolveUploadVisibility(
    input: string | undefined,
    callerRole: string | null | undefined,
    scope?: 'personal' | 'company',
  ): 'all' | 'admins' | 'teams' | 'project' {
    if (input == null || input === '') return 'all';
    if (
      input !== 'all' &&
      input !== 'admins' &&
      input !== 'teams' &&
      input !== 'project'
    ) {
      throw new BadRequestException(
        `Invalid visibility "${input}". Must be 'all', 'admins', 'teams', or 'project'.`,
      );
    }
    if (input === 'admins' && callerRole !== 'admin') {
      throw new ForbiddenException(
        'Only admins can mark a knowledge file as admin-only.',
      );
    }
    if (input === 'teams' && scope === 'personal') {
      throw new BadRequestException(
        'Team visibility requires a company profile — personal-scope files are owner-only.',
      );
    }
    if (input === 'project' && scope === 'personal') {
      throw new BadRequestException(
        'Project visibility requires a company profile — personal-scope files are owner-only.',
      );
    }
    return input;
  }

  /**
   * Normalize + authorize the team-IDs array a caller sends with a
   * 'teams' visibility request. Rules:
   *
   *   - Non-empty after dedupe; otherwise 'teams' visibility is
   *     meaningless (no one can read the file). 400.
   *   - Non-admin: every supplied id must be a team the caller owns
   *     or is an accepted member of. Surfacing 403 here catches a
   *     client passing arbitrary team uuids.
   *   - Admin: bypasses membership — admins have org-wide management
   *     privilege, so any team id that exists is fair game. We still
   *     validate the rows exist so a typo doesn't silently create
   *     orphan link rows (FK would catch insert-time, but a 404-style
   *     400 is friendlier).
   *
   * Returns the deduped, validated array ready for INSERT.
   */
  private async resolveAssignableTeamIds(
    input: string[],
    callerId: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        '`teamIds` must be an array when visibility is "teams".',
      );
    }
    const unique = Array.from(new Set(input.filter((s) => typeof s === 'string' && s.length > 0)));
    if (unique.length === 0) {
      throw new BadRequestException(
        'Pick at least one team for "Teams" visibility.',
      );
    }

    if (isAdmin) {
      // Admins can target any existing team. Validate existence so a
      // stale id surfaces as a clear 400 rather than an FK error.
      const rows = await this.db
        .select({ id: teams.id })
        .from(teams)
        .where(inArray(teams.id, unique));
      const existing = new Set(rows.map((r) => r.id));
      const missing = unique.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown team id(s): ${missing.join(', ')}.`,
        );
      }
      return unique;
    }

    // Non-admin: union of owned + accepted-member team ids.
    const [ownedRows, memberRows] = await Promise.all([
      this.db
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.ownerId, callerId), inArray(teams.id, unique))),
      this.db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, callerId),
            eq(teamMembers.status, 'accepted'),
            inArray(teamMembers.teamId, unique),
          ),
        ),
    ]);
    const allowed = new Set<string>([
      ...ownedRows.map((r) => r.id),
      ...memberRows.map((r) => r.teamId),
    ]);
    const denied = unique.filter((id) => !allowed.has(id));
    if (denied.length > 0) {
      throw new ForbiddenException(
        'You can only assign teams you own or are a member of.',
      );
    }
    return unique;
  }

  /**
   * Same shape as resolveAssignableTeamIds but for project visibility.
   * A project-visibility file is one the uploader wants pinned to a
   * specific project's chat — searchable only inside that project,
   * never via the org-wide RAG path.
   *
   * Rules mirror project-knowledge.service.ts#assertProjectAccess:
   *   - admin: any project in the deployment, validate existence only
   *   - non-admin: project owner, team owner of project's team, or
   *     accepted team member
   *
   * Returns the deduped, validated array ready to insert into
   * project_knowledge_files (which doubles as the access grant).
   */
  private async resolveAssignableProjectIds(
    input: string[],
    callerId: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        '`projectIds` must be an array when visibility is "project".',
      );
    }
    const unique = Array.from(
      new Set(input.filter((s) => typeof s === 'string' && s.length > 0)),
    );
    if (unique.length === 0) {
      throw new BadRequestException(
        'Pick at least one project for "Project" visibility.',
      );
    }

    const rows = await this.db
      .select({
        id: projects.id,
        ownerId: projects.userId,
        teamId: projects.teamId,
      })
      .from(projects)
      .where(inArray(projects.id, unique));
    const existing = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !existing.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown project id(s): ${missing.join(', ')}.`,
      );
    }
    if (isAdmin) return unique;

    // Non-admin: must own the project OR be team-owner / accepted
    // member of the project's team. One round-trip to pull all team
    // memberships referenced by these projects.
    const teamIds = Array.from(
      new Set(rows.map((r) => r.teamId).filter((id): id is string => !!id)),
    );
    const [teamRows, memberRows] =
      teamIds.length > 0
        ? await Promise.all([
            this.db
              .select({ id: teams.id, ownerId: teams.ownerId })
              .from(teams)
              .where(inArray(teams.id, teamIds)),
            this.db
              .select({ teamId: teamMembers.teamId })
              .from(teamMembers)
              .where(
                and(
                  eq(teamMembers.userId, callerId),
                  eq(teamMembers.status, 'accepted'),
                  inArray(teamMembers.teamId, teamIds),
                ),
              ),
          ])
        : [
            [] as Array<{ id: string; ownerId: string }>,
            [] as Array<{ teamId: string }>,
          ];
    const teamOwners = new Map(teamRows.map((t) => [t.id, t.ownerId]));
    const memberOf = new Set(memberRows.map((r) => r.teamId));

    const denied = rows
      .filter((r) => {
        if (r.ownerId === callerId) return false;
        if (r.teamId) {
          if (teamOwners.get(r.teamId) === callerId) return false;
          if (memberOf.has(r.teamId)) return false;
        }
        return true;
      })
      .map((r) => r.id);
    if (denied.length > 0) {
      throw new ForbiddenException(
        'You can only assign projects you own or have team access to.',
      );
    }
    return unique;
  }

  /**
   * Force a fresh ingestion pass for a single file. The /knowledge-core
   * UI exposes this as a "Retrain" action on each row; useful after
   * we change the parser / chunker (or when an earlier run landed
   * with 'No extractable text' before the buffer-and-flush fix and
   * the chunks are missing). Replaces the workaround of uploading a
   * dummy file just to trigger `ingestPendingFilesForUser`.
   *
   * Semantics:
   *   - Owner only — the same gate that protects every other
   *     mutation on the file. Admin can re-train indirectly by
   *     uploading replacements; cross-owner re-train would be a
   *     privilege escalation we don't want to grant by default.
   *   - Blocked when the file is already mid-ingestion
   *     (status='processing') so we don't race the worker.
   *   - Deletes existing chunks for the file inside a transaction so
   *     RAG search never sees half-old + half-new vectors. The chunk
   *     count drop is fine — `searchAccessibleChunks` filters at
   *     query time, so an empty file briefly returns no context
   *     (acceptable; the worker re-fills within seconds).
   *   - Fire-and-forget worker kick — the HTTP response returns as
   *     soon as the row is reset; the FE polls / refetches to
   *     surface the new status badge.
   */
  async reingestFile(fileId: string, callerId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== callerId) {
      throw new ForbiddenException('Access denied');
    }
    if (file.ingestionStatus === 'processing') {
      throw new BadRequestException(
        'This file is already being trained. Try again once the current run finishes.',
      );
    }

    await this.db.transaction(async (tx) => {
      // Drop existing chunks first so RAG search doesn't briefly
      // pull stale content alongside the freshly-embedded one once
      // the worker starts inserting. Cascade isn't enough here —
      // the file row stays, only the chunks turn over.
      await tx
        .delete(knowledgeChunks)
        .where(eq(knowledgeChunks.fileId, fileId));
      await tx
        .update(knowledgeFiles)
        .set({
          ingestionStatus: 'pending',
          ingestionError: null,
          ingestionCompletedAt: null,
        })
        .where(eq(knowledgeFiles.id, fileId));
    });

    // Worker claims every pending row this user owns — if other
    // files also happen to be pending, they get re-processed too.
    // That's fine: the FE polls per-file and shows each badge
    // independently. Fire-and-forget so the HTTP response returns.
    this.knowledgeIngestion.ingestPendingFilesForUser(callerId);

    return { id: fileId, ingestionStatus: 'pending' as const };
  }

  /**
   * Wipe a file's chunks while keeping the file row + disk copy.
   * Exposed as the "Untrain" action — the inverse of "Retrain":
   *
   *   Retrain → drop chunks, requeue for ingestion
   *   Untrain → drop chunks, mark as 'untrained' so the worker
   *             (which only claims 'pending') leaves it alone
   *
   * Useful when the owner wants to take a file out of RAG without
   * deleting the underlying upload (e.g. paused content, archival).
   * Re-training via the same dialog flips it back to 'pending' and
   * the worker rehydrates the embeddings.
   *
   * Same ownership + processing-race gates as reingestFile so the
   * two paths share a coherent invariant.
   */
  async untrainFile(fileId: string, callerId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== callerId) {
      throw new ForbiddenException('Access denied');
    }
    if (file.ingestionStatus === 'processing') {
      throw new BadRequestException(
        'This file is being trained right now. Try again once the current run finishes.',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(knowledgeChunks)
        .where(eq(knowledgeChunks.fileId, fileId));
      await tx
        .update(knowledgeFiles)
        .set({
          ingestionStatus: 'untrained',
          ingestionError: null,
          ingestionCompletedAt: null,
        })
        .where(eq(knowledgeFiles.id, fileId));
    });

    return { id: fileId, ingestionStatus: 'untrained' as const };
  }

  /**
   * Flip an existing file's visibility across the four tiers
   * (all / admins / teams / project). Allowed for the file's
   * uploader (so users can re-target their own uploads post-hoc)
   * OR for admins (org-wide management). Non-admin uploaders are
   * still blocked from setting 'admins' visibility — that tier is
   * an admin privilege; the lower tiers (all / teams / project) are
   * fair game for the owner. Mirrored onto knowledge_chunks so the
   * RAG filter (which only reads chunks, never re-JOINs to the file
   * row) immediately respects the new setting.
   */
  async updateFileVisibility(
    fileId: string,
    callerId: string,
    visibilityInput: string,
    teamIdsInput?: string[],
    projectIdsInput?: string[],
  ) {
    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, callerId));
    const isAdmin = caller?.role === 'admin';
    if (
      visibilityInput !== 'all' &&
      visibilityInput !== 'admins' &&
      visibilityInput !== 'teams' &&
      visibilityInput !== 'project'
    ) {
      throw new BadRequestException(
        `Invalid visibility "${visibilityInput}". Must be 'all', 'admins', 'teams', or 'project'.`,
      );
    }

    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        scope: knowledgeFiles.scope,
        uploadedById: knowledgeFiles.uploadedById,
      })
      .from(knowledgeFiles)
      .where(eq(knowledgeFiles.id, fileId));
    if (!file) throw new NotFoundException('File not found');
    const isOwner = file.uploadedById === callerId;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        "Only the file's uploader or an admin can change its visibility.",
      );
    }
    if (visibilityInput === 'admins' && !isAdmin) {
      throw new ForbiddenException(
        "Only admins can mark a file as admin-only.",
      );
    }
    // Mirror the upload-path invariant: 'teams' / 'project' are only
    // meaningful for company-scope rows. Personal files are owner-
    // only at chat time, so a restricted personal file would just
    // leave stray link rows nobody ever reads.
    if (
      (visibilityInput === 'teams' || visibilityInput === 'project') &&
      file.scope === 'personal'
    ) {
      throw new BadRequestException(
        `${visibilityInput === 'teams' ? 'Team' : 'Project'} visibility requires a company profile — personal-scope files are owner-only.`,
      );
    }
    // Block visibility flips while the worker is mid-ingestion.
    // KnowledgeIngestionService captures `visibility` at claim time
    // and inserts chunks with that captured value — if we updated the
    // file row + (still-empty) chunks rowset here, the worker's later
    // INSERT would land chunks at the stale visibility and leave
    // file.visibility and chunks.visibility out of sync. Mirror the
    // same guard reingestFile uses; the admin retries in a second.
    if (file.ingestionStatus === 'processing') {
      throw new BadRequestException(
        'This file is being trained right now. Try again once the current run finishes.',
      );
    }

    // Resolve link sets BEFORE the transaction so validation errors
    // don't leave a half-applied state. Empty arrays for unrelated
    // visibility levels are intentional — the transaction below wipes
    // any pre-existing links regardless. isAdmin gates whether the
    // caller can target arbitrary teams/projects; non-admin owners
    // are limited to their own membership.
    const teamIds =
      visibilityInput === 'teams'
        ? await this.resolveAssignableTeamIds(
            teamIdsInput ?? [],
            callerId,
            isAdmin,
          )
        : [];
    const projectIds =
      visibilityInput === 'project'
        ? await this.resolveAssignableProjectIds(
            projectIdsInput ?? [],
            callerId,
            isAdmin,
          )
        : [];

    await this.db.transaction(async (tx) => {
      await tx
        .update(knowledgeFiles)
        .set({ visibility: visibilityInput })
        .where(eq(knowledgeFiles.id, fileId));
      await tx
        .update(knowledgeChunks)
        .set({ visibility: visibilityInput })
        .where(eq(knowledgeChunks.fileId, fileId));
      // Replace, not merge: wiping and re-inserting keeps the link
      // sets authoritative — flipping away clears the prior links;
      // flipping in replaces with the new set.
      await tx
        .delete(knowledgeFileTeams)
        .where(eq(knowledgeFileTeams.fileId, fileId));
      await tx
        .delete(projectKnowledgeFiles)
        .where(eq(projectKnowledgeFiles.fileId, fileId));
      if (visibilityInput === 'teams' && teamIds.length > 0) {
        await tx
          .insert(knowledgeFileTeams)
          .values(teamIds.map((teamId) => ({ fileId, teamId })));
      }
      if (visibilityInput === 'project' && projectIds.length > 0) {
        await tx.insert(projectKnowledgeFiles).values(
          projectIds.map((projectId) => ({
            projectId,
            fileId,
            attachedBy: callerId,
          })),
        );
      }
    });

    return { id: fileId, visibility: visibilityInput, teamIds, projectIds };
  }

  /**
   * Bulk variant of `updateFileVisibility`. Same gates (owner-or-
   * admin per row, enum validation), one transaction so a partial
   * run can't leave the user in a half-flipped state. Drops unknown
   * / invalid IDs silently (caller-side typically constructs the
   * array from rows it already rendered, so the only way IDs go
   * stale is concurrent deletes — surfacing a 404 in that race
   * would be misleading).
   *
   * Returns the affected ids so the FE knows exactly which rows to
   * optimistically update.
   */
  async updateFilesVisibility(
    fileIds: string[],
    callerId: string,
    visibilityInput: string,
    teamIdsInput?: string[],
    projectIdsInput?: string[],
  ) {
    const [caller] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, callerId));
    const isAdmin = caller?.role === 'admin';
    if (
      visibilityInput !== 'all' &&
      visibilityInput !== 'admins' &&
      visibilityInput !== 'teams' &&
      visibilityInput !== 'project'
    ) {
      throw new BadRequestException(
        `Invalid visibility "${visibilityInput}". Must be 'all', 'admins', 'teams', or 'project'.`,
      );
    }
    if (visibilityInput === 'admins' && !isAdmin) {
      throw new ForbiddenException(
        "Only admins can mark a file as admin-only.",
      );
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      throw new BadRequestException('`fileIds` must be a non-empty array.');
    }

    // Same pre-transaction link resolution as the per-file path —
    // non-admin owners can only point to teams/projects they
    // themselves can reach.
    const teamIds =
      visibilityInput === 'teams'
        ? await this.resolveAssignableTeamIds(
            teamIdsInput ?? [],
            callerId,
            isAdmin,
          )
        : [];
    const projectIds =
      visibilityInput === 'project'
        ? await this.resolveAssignableProjectIds(
            projectIdsInput ?? [],
            callerId,
            isAdmin,
          )
        : [];

    // Cheap dedupe in case the FE accidentally sends duplicates;
    // drizzle inArray would still work but we'd update twice.
    const uniqueIds = Array.from(new Set(fileIds));

    // Same race as the per-file path: a row that's mid-ingestion has
    // a worker about to insert chunks with the captured (stale)
    // visibility. Updating the file row + (still-empty) chunks set
    // here would leave them out of sync. Skip processing rows
    // entirely so the rest of the batch still flips, and return the
    // skipped ids so the FE can surface a partial-success toast.
    //
    // Also fetch scope so we can enforce the same invariant the
    // upload path does — 'teams' visibility is meaningless on a
    // personal-scope row (owner-only already). Reject the whole
    // batch up front rather than half-flipping it; in legitimate FE
    // flows a single bulk PATCH never mixes scopes anyway.
    const statuses = await this.db
      .select({
        id: knowledgeFiles.id,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        scope: knowledgeFiles.scope,
        uploadedById: knowledgeFiles.uploadedById,
      })
      .from(knowledgeFiles)
      .where(inArray(knowledgeFiles.id, uniqueIds));
    if (!isAdmin) {
      const notOwned = statuses.filter((r) => r.uploadedById !== callerId);
      if (notOwned.length > 0) {
        throw new ForbiddenException(
          "Only the file's uploader or an admin can change its visibility.",
        );
      }
    }
    if (visibilityInput === 'teams' || visibilityInput === 'project') {
      const personal = statuses.filter((r) => r.scope === 'personal');
      if (personal.length > 0) {
        throw new BadRequestException(
          `${visibilityInput === 'teams' ? 'Team' : 'Project'} visibility requires a company profile — personal-scope files are owner-only.`,
        );
      }
    }
    const eligibleIds: string[] = [];
    const skippedIds: string[] = [];
    for (const row of statuses) {
      if (row.ingestionStatus === 'processing') skippedIds.push(row.id);
      else eligibleIds.push(row.id);
    }

    // UPDATE ... RETURNING gives us the actual rows touched, in
    // case a row was deleted between the status SELECT above and
    // the UPDATE here. Returning the real affected ids keeps the
    // FE's optimistic state honest.
    let affectedIds: string[] = [];
    if (eligibleIds.length > 0) {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(knowledgeFiles)
          .set({ visibility: visibilityInput })
          .where(inArray(knowledgeFiles.id, eligibleIds))
          .returning({ id: knowledgeFiles.id });
        affectedIds = updated.map((r) => r.id);
        if (affectedIds.length > 0) {
          await tx
            .update(knowledgeChunks)
            .set({ visibility: visibilityInput })
            .where(inArray(knowledgeChunks.fileId, affectedIds));
          // Replace team/project links for every affected row. Same
          // shape as the per-file path — wipe-then-insert is cheaper
          // than diffing for the bulk case and keeps the link sets
          // authoritative regardless of prior state.
          await tx
            .delete(knowledgeFileTeams)
            .where(inArray(knowledgeFileTeams.fileId, affectedIds));
          await tx
            .delete(projectKnowledgeFiles)
            .where(inArray(projectKnowledgeFiles.fileId, affectedIds));
          if (visibilityInput === 'teams' && teamIds.length > 0) {
            await tx.insert(knowledgeFileTeams).values(
              affectedIds.flatMap((fileId) =>
                teamIds.map((teamId) => ({ fileId, teamId })),
              ),
            );
          }
          if (visibilityInput === 'project' && projectIds.length > 0) {
            await tx.insert(projectKnowledgeFiles).values(
              affectedIds.flatMap((fileId) =>
                projectIds.map((projectId) => ({
                  projectId,
                  fileId,
                  attachedBy: callerId,
                })),
              ),
            );
          }
        }
      });
    }

    return {
      visibility: visibilityInput as 'all' | 'admins' | 'teams' | 'project',
      teamIds,
      projectIds,
      affectedIds,
      skippedIds,
    };
  }

  async getFileForDownload(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        storagePath: knowledgeFiles.storagePath,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');
    if (!file.storagePath) throw new NotFoundException('File not on disk');

    return {
      name: file.name,
      storagePath: path.resolve(process.cwd(), file.storagePath),
    };
  }

  async moveFile(fileId: string, targetFolderId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    const [targetFolder] = await this.db
      .select()
      .from(knowledgeFolders)
      .where(eq(knowledgeFolders.id, targetFolderId));

    if (!targetFolder) throw new NotFoundException('Target folder not found');
    if (targetFolder.ownerId !== userId)
      throw new ForbiddenException('Access denied');

    await this.db
      .update(knowledgeFiles)
      .set({ folderId: targetFolderId })
      .where(eq(knowledgeFiles.id, fileId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, targetFolderId));

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, file.folderId));
  }

  async deleteFile(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        id: knowledgeFiles.id,
        storagePath: knowledgeFiles.storagePath,
        folderId: knowledgeFiles.folderId,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));

    if (!file) throw new NotFoundException('File not found');
    if (file.ownerId !== userId) throw new ForbiddenException('Access denied');

    if (file.storagePath) {
      try {
        await fs.promises.unlink(path.resolve(process.cwd(), file.storagePath));
      } catch {
        // File may already be removed from disk
      }
    }

    // Defense-in-depth: clear child rows explicitly inside a
    // transaction before deleting the file. FK cascade should handle
    // this, but explicit deletes guarantee chat-time RAG no longer
    // surfaces this file even if the live DB lost the CASCADE rule.
    // Order: chunks (RAG embeddings) → team links → project
    // attachments → the file row itself.
    await this.db.transaction(async (tx) => {
      await tx
        .delete(knowledgeChunks)
        .where(eq(knowledgeChunks.fileId, fileId));
      await tx
        .delete(knowledgeFileTeams)
        .where(eq(knowledgeFileTeams.fileId, fileId));
      await tx
        .delete(projectKnowledgeFiles)
        .where(eq(projectKnowledgeFiles.fileId, fileId));
      await tx.delete(knowledgeFiles).where(eq(knowledgeFiles.id, fileId));
    });

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, file.folderId));
  }

  async recentFiles(userId: string) {
    const rows = await this.db
      .select({
        id: knowledgeFiles.id,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        folderName: knowledgeFolders.name,
        uploadedByName: users.name,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        visibility: knowledgeFiles.visibility,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .leftJoin(users, eq(users.id, knowledgeFiles.uploadedById))
      .where(eq(knowledgeFolders.ownerId, userId))
      .orderBy(desc(knowledgeFiles.createdAt))
      .limit(10);

    const fileIds = rows.map((r) => r.id);
    const [teamLinks, projectLinks] = await Promise.all([
      this.hydrateTeamLinks(fileIds),
      this.hydrateProjectLinks(fileIds),
    ]);
    return rows.map((r) => ({
      ...r,
      teams: teamLinks.get(r.id) ?? [],
      projects: projectLinks.get(r.id) ?? [],
    }));
  }
}
