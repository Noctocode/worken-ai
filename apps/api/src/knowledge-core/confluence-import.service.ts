import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  confluenceImportSources,
  knowledgeFileTeams,
  knowledgeFiles,
  knowledgeFolders,
  projectKnowledgeFiles,
  users,
} from '@worken/database/schema';

import { DATABASE, type Database } from '../database/database.module.js';
import {
  ConfluenceClientService,
  type ConfluencePageMeta,
} from '../confluence/confluence-client.service.js';
import { ConfluenceOAuthService } from '../confluence/confluence-oauth.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

/**
 * The KC parent folder Confluence imports nest under. Each import gets a
 * child folder named after the Confluence space, with the page tree mirrored
 * beneath it (a page that has imported children becomes a sub-folder; the
 * page's own document sits in its parent's folder). Lazily created on first
 * import.
 */
const CONFLUENCE_PARENT_FOLDER_NAME = 'Confluence';

/** Per-import cap for page-scoped (specific pages) imports. */
const MAX_PAGE_IMPORT_FILES = 1000;

/** Higher cap for whole-space imports (gated behind an explicit FE confirm). */
const MAX_SPACE_IMPORT_FILES = 10_000;

export type ConfluenceVisibility = 'all' | 'admins' | 'teams' | 'project';

export type ConfluenceImportScope = (
  | { kind: 'space'; spaceId: string }
  | { kind: 'pages'; spaceId: string; pageIds: string[] }
) & {
  visibility?: ConfluenceVisibility;
  teamIds?: string[];
  projectIds?: string[];
};

export interface ConfluenceImportResult {
  /** New knowledge_files rows created on this call. */
  added: number;
  /** Pages Confluence returned that we already had (matched by external_id). */
  skippedDuplicates: number;
  /** Source rows touched by this import (created or re-synced). */
  sources: { id: string; spaceName: string }[];
}

export interface ConfluenceSourceRow {
  id: string;
  scope: 'space' | 'page';
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  pageId: string | null;
  pageTitle: string | null;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

/** Progress snapshot returned to the FE while an async space import runs. */
export interface ConfluenceImportProgress {
  phase: 'scanning' | 'importing' | 'done' | 'cancelled' | 'error';
  /** Pages seen during the Confluence list phase. */
  scanned: number;
  /** New pages to insert after dedup. Zero until scanning completes. */
  total: number;
  /** Rows inserted into knowledge_files so far. */
  imported: number;
  error?: string;
}

interface ActiveImportJob {
  progress: ConfluenceImportProgress;
  cancelled: boolean;
  insertedFileIds: string[];
  createdSourceId: string | null;
}

@Injectable()
export class ConfluenceImportService {
  private readonly logger = new Logger(ConfluenceImportService.name);

  /** One entry per user with a background space import in progress. */
  private readonly activeJobs = new Map<string, ActiveImportJob>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly oauth: ConfluenceOAuthService,
    private readonly client: ConfluenceClientService,
    private readonly ingestion: KnowledgeIngestionService,
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // Synchronous import (both scopes) + Re-sync
  // ───────────────────────────────────────────────────────────────────

  /**
   * Import (or Re-sync) pages from the user's connected Confluence into KC.
   * Pages we already have (matched by `(uploaded_by_id, external_id)` where
   * external_id is the page id) are skipped — Re-sync is "add new pages since
   * last time", never a delete or re-ingest.
   *
   * Imported rows go under a "Confluence" > {space} folder, with the page
   * hierarchy mirrored beneath it. Page bodies are downloaded + converted to
   * Markdown lazily at ingestion time (storagePath stays NULL on insert).
   */
  async importFromConfluence(
    userId: string,
    scope: ConfluenceImportScope,
  ): Promise<ConfluenceImportResult> {
    this.validateScope(scope);
    const connection = await this.oauth.requireConnection(userId);

    const space = await this.client.getSpace(userId, scope.spaceId);
    const fileScope = await this.resolveFileScope(userId);
    const confluenceParentId = await this.ensureParentFolder(userId);
    const spaceFolderId = await this.ensureChildFolder(
      userId,
      confluenceParentId,
      space.name,
    );

    const result: ConfluenceImportResult = {
      added: 0,
      skippedDuplicates: 0,
      sources: [],
    };

    // Resolve the pages to import as one or more "source units" — each unit
    // becomes its own Re-sync row (mirrors the Drive per-folder loop).
    //   - space scope: the whole space, fetched one over the cap so an
    //     over-cap space is rejected loudly instead of silently truncated.
    //   - pages scope: each picked page's subtree, fetched directly via the
    //     children endpoint so it resolves even in spaces larger than the
    //     space-list cap. Overlapping subtrees de-dupe by external_id at
    //     insert time.
    interface Unit {
      pageId: string | null;
      pageTitle: string | null;
      selected: ConfluencePageMeta[];
    }
    const units: Unit[] = [];
    if (scope.kind === 'space') {
      const allPages = await this.client.listAllPages(
        userId,
        scope.spaceId,
        MAX_SPACE_IMPORT_FILES + 1,
      );
      this.enforceImportCountCap(allPages.length, 'space', MAX_SPACE_IMPORT_FILES);
      units.push({ pageId: null, pageTitle: null, selected: allPages });
    } else {
      for (const pageId of scope.pageIds) {
        const subtree = await this.client.listPageSubtree(
          userId,
          pageId,
          MAX_PAGE_IMPORT_FILES + 1,
        );
        if (subtree.length === 0) continue; // picked page gone / inaccessible
        this.enforceImportCountCap(subtree.length, 'pages', MAX_PAGE_IMPORT_FILES);
        units.push({
          pageId,
          pageTitle: subtree.find((p) => p.id === pageId)?.title ?? null,
          selected: subtree,
        });
      }
    }

    for (const unit of units) {
      const inserted = await this.upsertSourceUnit(userId, {
        scopeKind: scope.kind === 'space' ? 'space' : 'page',
        pageId: unit.pageId,
        pageTitle: unit.pageTitle,
        space,
        selected: unit.selected,
        connectionId: connection.id,
        spaceFolderId,
        kcFileScope: fileScope,
        visibility: scope.visibility ?? 'all',
        teamIds: scope.teamIds ?? [],
        projectIds: scope.projectIds ?? [],
      });
      result.added += inserted.added;
      result.skippedDuplicates += inserted.skippedDuplicates;
      result.sources.push({ id: inserted.sourceId, spaceName: space.name });
    }

    await this.oauth.markSynced(userId);
    if (result.added > 0) {
      this.ingestion.ingestPendingFilesForUser(userId, { fromImport: true });
    }

    return result;
  }

  /**
   * Re-sync a single existing source. Same code path as
   * importFromConfluence; idempotent (returns added: 0 if nothing new).
   */
  async resyncSource(
    userId: string,
    sourceId: string,
  ): Promise<ConfluenceImportResult> {
    const [source] = await this.db
      .select()
      .from(confluenceImportSources)
      .where(
        and(
          eq(confluenceImportSources.id, sourceId),
          eq(confluenceImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('Confluence source not found');

    const visibilityExtras = {
      visibility: (source.visibility as ConfluenceVisibility) ?? undefined,
      teamIds: source.teamIds ?? undefined,
      projectIds: source.projectIds ?? undefined,
    };

    if (source.scope === 'space') {
      return this.importFromConfluence(userId, {
        kind: 'space',
        spaceId: source.spaceId,
        ...visibilityExtras,
      });
    }
    if (!source.pageId) {
      throw new BadRequestException(
        'Page-scoped source is missing its page id; remove and re-import.',
      );
    }
    return this.importFromConfluence(userId, {
      kind: 'pages',
      spaceId: source.spaceId,
      pageIds: [source.pageId],
      ...visibilityExtras,
    });
  }

  /** List a user's imported Confluence sources for the Re-sync UI. */
  async listSources(userId: string): Promise<ConfluenceSourceRow[]> {
    const rows = await this.db
      .select()
      .from(confluenceImportSources)
      .where(eq(confluenceImportSources.ownerId, userId))
      .orderBy(sql`${confluenceImportSources.lastSyncedAt} DESC`);
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as 'space' | 'page',
      spaceId: r.spaceId,
      spaceKey: r.spaceKey,
      spaceName: r.spaceName,
      pageId: r.pageId,
      pageTitle: r.pageTitle,
      lastSyncedAt: r.lastSyncedAt.toISOString(),
      fileCountAtLastSync: r.fileCountAtLastSync,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Delete the source record. Imported files are NOT touched. */
  async deleteSource(userId: string, sourceId: string): Promise<void> {
    const [source] = await this.db
      .select()
      .from(confluenceImportSources)
      .where(
        and(
          eq(confluenceImportSources.id, sourceId),
          eq(confluenceImportSources.ownerId, userId),
        ),
      );
    if (!source) throw new NotFoundException('Confluence source not found');
    if (source.ownerId !== userId) throw new ForbiddenException();
    await this.db
      .delete(confluenceImportSources)
      .where(eq(confluenceImportSources.id, sourceId));
  }

  // ───────────────────────────────────────────────────────────────────
  // File-count estimate (powers the whole-space warning banner)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Count of importable pages in a space. Used by the FE warning banner
   * before the user confirms an "Entire space" import. `hasMore` is true
   * when the space exceeds the safety cap.
   */
  async getFileCountEstimateForSpace(
    userId: string,
    spaceId: string,
  ): Promise<{ count: number; hasMore: boolean }> {
    // Probe one over the cap so `hasMore` reflects a genuinely over-cap space
    // (the banner then shows "10,000+" and the import itself hard-errors,
    // matching the Entire-Drive behavior).
    const pages = await this.client.listAllPages(
      userId,
      spaceId,
      MAX_SPACE_IMPORT_FILES + 1,
    );
    const hasMore = pages.length > MAX_SPACE_IMPORT_FILES;
    return {
      count: hasMore ? MAX_SPACE_IMPORT_FILES : pages.length,
      hasMore,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // Async (progress-tracked) whole-space import
  // ───────────────────────────────────────────────────────────────────

  /**
   * Start a background "Entire space" import. Returns immediately with
   * `{ started: true }`; poll `getImportProgress()` to track it. Only
   * scope.kind === 'space' is supported — page-scoped imports are fast
   * enough to run synchronously.
   */
  startImportSpaceAsync(
    userId: string,
    scope: ConfluenceImportScope,
  ): Promise<{ started: true }> {
    if (scope.kind !== 'space') {
      throw new BadRequestException(
        'Async import is only supported for the whole-space scope.',
      );
    }
    this.validateScope(scope);

    const existing = this.activeJobs.get(userId);
    if (
      existing &&
      (existing.progress.phase === 'scanning' ||
        existing.progress.phase === 'importing')
    ) {
      throw new ConflictException(
        'A Confluence import is already in progress. Cancel it first or wait for it to finish.',
      );
    }
    this.activeJobs.delete(userId);

    const job: ActiveImportJob = {
      progress: { phase: 'scanning', scanned: 0, total: 0, imported: 0 },
      cancelled: false,
      insertedFileIds: [],
      createdSourceId: null,
    };
    this.activeJobs.set(userId, job);

    void this._runImportSpaceJob(userId, scope, job).catch((err) => {
      if (this.activeJobs.get(userId) === job) {
        job.progress.phase = 'error';
        job.progress.error =
          err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(
          `Confluence async import failed for user ${userId}: ${job.progress.error}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    });

    return Promise.resolve({ started: true } as const);
  }

  getImportProgress(userId: string): ConfluenceImportProgress | null {
    return this.activeJobs.get(userId)?.progress ?? null;
  }

  /** Cancel the user's running import and roll back inserted rows. */
  async cancelImport(userId: string): Promise<void> {
    const job = this.activeJobs.get(userId);
    if (!job) return;

    const isRunning =
      job.progress.phase === 'scanning' || job.progress.phase === 'importing';
    if (isRunning) {
      job.cancelled = true;
      const idsToDelete = [...job.insertedFileIds];
      job.insertedFileIds = [];
      job.progress.phase = 'cancelled';

      const CHUNK = 1000;
      for (let i = 0; i < idsToDelete.length; i += CHUNK) {
        const chunk = idsToDelete.slice(i, i + CHUNK);
        await this.db
          .delete(knowledgeFiles)
          .where(
            and(
              eq(knowledgeFiles.uploadedById, userId),
              inArray(knowledgeFiles.id, chunk),
            ),
          );
      }
      if (job.createdSourceId) {
        await this.db
          .delete(confluenceImportSources)
          .where(eq(confluenceImportSources.id, job.createdSourceId));
        job.createdSourceId = null;
      }
    }
    this.activeJobs.delete(userId);
  }

  private async _runImportSpaceJob(
    userId: string,
    scope: ConfluenceImportScope,
    job: ActiveImportJob,
  ): Promise<void> {
    try {
      const connection = await this.oauth.requireConnection(userId);
      const fileScope = await this.resolveFileScope(userId);
      const visibility = scope.visibility ?? 'all';

      // ── Phase 1: scan ────────────────────────────────────────────────
      job.progress.phase = 'scanning';
      const space = await this.client.getSpace(userId, scope.spaceId);
      const allPages = await this.client.listAllPages(
        userId,
        scope.spaceId,
        MAX_SPACE_IMPORT_FILES + 1,
      );
      job.progress.scanned = allPages.length;
      if (job.cancelled) return;

      // Fail loudly on an over-cap space rather than silently importing only
      // the first N pages. The throw is caught by startImportSpaceAsync's
      // .catch, which sets phase='error' so the FE surfaces the message.
      this.enforceImportCountCap(allPages.length, 'space', MAX_SPACE_IMPORT_FILES);
      const selected = allPages;

      // ── Phase 2: dedup ───────────────────────────────────────────────
      const candidateIds = selected.map((p) => p.id);
      const existingSet = await this.findExistingExternalIds(
        userId,
        candidateIds,
      );
      const newPages = selected.filter((p) => !existingSet.has(p.id));
      if (job.cancelled) return;

      job.progress.total = newPages.length;
      job.progress.phase = 'importing';

      const confluenceParentId = await this.ensureParentFolder(userId);
      const spaceFolderId = await this.ensureChildFolder(
        userId,
        confluenceParentId,
        space.name,
      );

      // Upsert source row before inserting files.
      const [existingSource] = await this.db
        .select({
          id: confluenceImportSources.id,
          fileCountAtLastSync: confluenceImportSources.fileCountAtLastSync,
        })
        .from(confluenceImportSources)
        .where(
          and(
            eq(confluenceImportSources.ownerId, userId),
            eq(confluenceImportSources.spaceId, scope.spaceId),
            eq(confluenceImportSources.scope, 'space'),
          ),
        );
      let sourceId: string;
      let prevCount = 0;
      if (existingSource) {
        sourceId = existingSource.id;
        prevCount = existingSource.fileCountAtLastSync;
      } else {
        const [created] = await this.db
          .insert(confluenceImportSources)
          .values({
            ownerId: userId,
            connectionId: connection.id,
            scope: 'space',
            spaceId: space.id,
            spaceKey: space.key,
            spaceName: space.name,
            pageId: null,
            pageTitle: null,
            fileCountAtLastSync: 0,
            visibility,
            teamIds: scope.teamIds ?? null,
            projectIds: scope.projectIds ?? null,
          })
          .returning({ id: confluenceImportSources.id });
        sourceId = created.id;
        job.createdSourceId = sourceId;
      }

      const folderMap = await this.buildPageFolderMap(
        userId,
        newPages,
        new Set(selected.map((p) => p.id)),
        spaceFolderId,
      );

      // ── Phase 3: insert in batches ───────────────────────────────────
      const BATCH_SIZE = 100;
      let totalInserted = 0;
      for (let i = 0; i < newPages.length; i += BATCH_SIZE) {
        if (job.cancelled) break;
        const batch = newPages.slice(i, i + BATCH_SIZE);
        const insertedRows = await this.insertPageRows(
          userId,
          batch,
          folderMap,
          spaceFolderId,
          space.id,
          fileScope,
          visibility,
          scope.teamIds ?? [],
          scope.projectIds ?? [],
        );
        for (const row of insertedRows) job.insertedFileIds.push(row.id);
        totalInserted += insertedRows.length;
        job.progress.imported = totalInserted;
      }
      if (job.cancelled) return;

      await this.db
        .update(confluenceImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync: prevCount + totalInserted,
          spaceName: space.name,
          spaceKey: space.key,
        })
        .where(eq(confluenceImportSources.id, sourceId));
      await this.db
        .update(knowledgeFolders)
        .set({ updatedAt: new Date() })
        .where(eq(knowledgeFolders.id, spaceFolderId));

      await this.oauth.markSynced(userId);
      if (totalInserted > 0) {
        this.ingestion.ingestPendingFilesForUser(userId, { fromImport: true });
      }
      job.progress.phase = 'done';
    } finally {
      setTimeout(
        () => {
          if (this.activeJobs.get(userId) === job) {
            this.activeJobs.delete(userId);
          }
        },
        5 * 60 * 1000,
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────

  /**
   * Insert new knowledge_files rows + upsert ONE source record (whole-space
   * or a single picked page's subtree). Dedups by
   * `(uploaded_by_id, external_id)` against existing rows so a Re-sync only
   * adds pages that appeared since last sync.
   */
  private async upsertSourceUnit(
    userId: string,
    args: {
      scopeKind: 'space' | 'page';
      pageId: string | null;
      pageTitle: string | null;
      space: { id: string; key: string; name: string };
      selected: ConfluencePageMeta[];
      connectionId: string;
      spaceFolderId: string;
      kcFileScope: string;
      visibility: string;
      teamIds: string[];
      projectIds: string[];
    },
  ): Promise<{
    sourceId: string;
    added: number;
    skippedDuplicates: number;
  }> {
    const { space, selected, spaceFolderId } = args;

    const candidateIds = selected.map((p) => p.id);
    const existingSet = await this.findExistingExternalIds(
      userId,
      candidateIds,
    );
    const newPages = selected.filter((p) => !existingSet.has(p.id));

    // Upsert the source row. For page scope the conflict key is
    // (owner, space, page); for space scope it's (owner, space).
    const [existingSource] = await this.db
      .select({
        id: confluenceImportSources.id,
        fileCountAtLastSync: confluenceImportSources.fileCountAtLastSync,
      })
      .from(confluenceImportSources)
      .where(
        and(
          eq(confluenceImportSources.ownerId, userId),
          eq(confluenceImportSources.spaceId, space.id),
          args.scopeKind === 'space'
            ? eq(confluenceImportSources.scope, 'space')
            : eq(confluenceImportSources.pageId, args.pageId ?? ''),
        ),
      );

    let sourceId: string;
    if (existingSource) {
      await this.db
        .update(confluenceImportSources)
        .set({
          lastSyncedAt: new Date(),
          fileCountAtLastSync:
            existingSource.fileCountAtLastSync + newPages.length,
          spaceName: space.name,
          spaceKey: space.key,
          pageTitle: args.pageTitle,
        })
        .where(eq(confluenceImportSources.id, existingSource.id));
      sourceId = existingSource.id;
    } else {
      const [created] = await this.db
        .insert(confluenceImportSources)
        .values({
          ownerId: userId,
          connectionId: args.connectionId,
          scope: args.scopeKind,
          spaceId: space.id,
          spaceKey: space.key,
          spaceName: space.name,
          pageId: args.pageId,
          pageTitle: args.pageTitle,
          fileCountAtLastSync: newPages.length,
          visibility: args.visibility,
          teamIds: args.teamIds.length ? args.teamIds : null,
          projectIds: args.projectIds.length ? args.projectIds : null,
        })
        .returning({ id: confluenceImportSources.id });
      sourceId = created.id;
    }

    if (newPages.length === 0) {
      return { sourceId, added: 0, skippedDuplicates: existingSet.size };
    }

    const folderMap = await this.buildPageFolderMap(
      userId,
      newPages,
      new Set(selected.map((p) => p.id)),
      spaceFolderId,
    );

    // Insert in one batched call (page sets are bounded by the import cap).
    await this.insertPageRows(
      userId,
      newPages,
      folderMap,
      spaceFolderId,
      space.id,
      args.kcFileScope,
      args.visibility,
      args.teamIds,
      args.projectIds,
    );

    await this.db
      .update(knowledgeFolders)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeFolders.id, spaceFolderId));

    return {
      sourceId,
      added: newPages.length,
      skippedDuplicates: existingSet.size,
    };
  }

  /**
   * Insert knowledge_files rows for a batch of pages + their team/project
   * junction rows. storagePath stays NULL — the ingestion worker downloads
   * each page body, converts it to Markdown, and writes it to disk then.
   */
  private async insertPageRows(
    userId: string,
    pages: ConfluencePageMeta[],
    folderMap: Map<string, string>,
    spaceFolderId: string,
    spaceId: string,
    fileScope: string,
    visibility: string,
    teamIds: string[],
    projectIds: string[],
  ): Promise<{ id: string }[]> {
    const insertedRows = await this.db
      .insert(knowledgeFiles)
      .values(
        pages.map((p) => ({
          folderId: (p.parentId && folderMap.get(p.parentId)) || spaceFolderId,
          name: `${this.safeTitle(p.title)}.md`,
          fileType: 'MD',
          sizeBytes: 0,
          storagePath: null,
          uploadedById: userId,
          scope: fileScope,
          visibility,
          source: 'confluence' as const,
          externalId: p.id,
          externalUrl: p.webUrl ?? null,
          // Set to the space id so Confluence rows fall OUT of the
          // Drive/OneDrive dedup index (external_drive_id IS NULL) and into
          // the Confluence-specific one — preventing a 23505 if a page id
          // ever equals a Drive file id for this user. Not used at download
          // time (the page id alone is enough).
          externalDriveId: spaceId,
        })),
      )
      .returning({ id: knowledgeFiles.id });

    if (visibility === 'teams' && teamIds.length > 0) {
      await this.db
        .insert(knowledgeFileTeams)
        .values(
          insertedRows.flatMap((row) =>
            teamIds.map((teamId) => ({ fileId: row.id, teamId })),
          ),
        );
    }
    if (visibility === 'project' && projectIds.length > 0) {
      await this.db.insert(projectKnowledgeFiles).values(
        insertedRows.flatMap((row) =>
          projectIds.map((projectId) => ({
            projectId,
            fileId: row.id,
            attachedBy: userId,
          })),
        ),
      );
    }
    return insertedRows;
  }

  /**
   * Rebuild the Confluence page hierarchy in KC. A page that is the parent of
   * an imported page becomes a KC folder (named after the page); the page's
   * own document lands in its parent's folder. Returns
   * `Map<pageId, kcFolderId>` covering every page that needs a container,
   * seeded with the space root for top-level pages. Idempotent via
   * `ensureChildFolder`, so Re-sync reuses folders from a prior import.
   */
  private async buildPageFolderMap(
    userId: string,
    newPages: ConfluencePageMeta[],
    importedIds: Set<string>,
    spaceFolderId: string,
  ): Promise<Map<string, string>> {
    const byId = new Map(newPages.map((p) => [p.id, p]));

    // A page needs a KC folder iff it is the parent of an imported page.
    const containerIds = new Set<string>();
    for (const p of newPages) {
      if (p.parentId && importedIds.has(p.parentId)) {
        containerIds.add(p.parentId);
      }
    }

    const kcByPage = new Map<string, string>();
    const resolve = async (pageId: string): Promise<string> => {
      const cached = kcByPage.get(pageId);
      if (cached) return cached;
      const page = byId.get(pageId);
      // Parent of an imported page that wasn't itself in the new-pages set
      // (e.g. already imported on a prior sync) — attach under the space root.
      if (!page) return spaceFolderId;
      const parentKc =
        page.parentId && containerIds.has(page.parentId)
          ? await resolve(page.parentId)
          : spaceFolderId;
      const kcId = await this.ensureChildFolder(userId, parentKc, page.title);
      kcByPage.set(pageId, kcId);
      return kcId;
    };

    for (const id of containerIds) await resolve(id);
    return kcByPage;
  }

  private async findExistingExternalIds(
    userId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    // Scope the probe to source='confluence' so a Drive/OneDrive file id that
    // happens to equal a Confluence page id isn't mistaken for an already-
    // imported page (which would silently skip a distinct document). Pairs
    // with the source-scoped dedup index.
    const rows = await this.db
      .select({ externalId: knowledgeFiles.externalId })
      .from(knowledgeFiles)
      .where(
        and(
          eq(knowledgeFiles.uploadedById, userId),
          eq(knowledgeFiles.source, 'confluence'),
          inArray(knowledgeFiles.externalId, candidateIds),
        ),
      );
    return new Set(
      rows.map((r) => r.externalId).filter((id): id is string => id !== null),
    );
  }

  private async resolveFileScope(userId: string): Promise<string> {
    const [uploader] = await this.db
      .select({ profileType: users.profileType })
      .from(users)
      .where(eq(users.id, userId));
    return uploader?.profileType === 'company' ? 'company' : 'personal';
  }

  private async ensureParentFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, CONFLUENCE_PARENT_FOLDER_NAME),
          sql`${knowledgeFolders.parentFolderId} IS NULL`,
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({
        name: CONFLUENCE_PARENT_FOLDER_NAME,
        ownerId: userId,
        parentFolderId: null,
      })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  private async ensureChildFolder(
    userId: string,
    parentId: string,
    name: string,
  ): Promise<string> {
    const folderName = this.safeTitle(name);
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.parentFolderId, parentId),
          eq(knowledgeFolders.name, folderName),
        ),
      );
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({ name: folderName, ownerId: userId, parentFolderId: parentId })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }

  private validateScope(scope: ConfluenceImportScope): void {
    if (!scope.spaceId || typeof scope.spaceId !== 'string') {
      throw new BadRequestException('spaceId is required.');
    }
    if (
      scope.kind === 'pages' &&
      (!Array.isArray(scope.pageIds) || scope.pageIds.length === 0)
    ) {
      throw new BadRequestException(
        'pageIds must be a non-empty array when scope is "pages".',
      );
    }
    const VALID: ConfluenceVisibility[] = ['all', 'admins', 'teams', 'project'];
    if (scope.visibility !== undefined && !VALID.includes(scope.visibility)) {
      throw new BadRequestException(
        `Invalid visibility "${scope.visibility}". Must be one of: ${VALID.join(', ')}.`,
      );
    }
    if (
      scope.visibility === 'teams' &&
      (!Array.isArray(scope.teamIds) || scope.teamIds.length === 0)
    ) {
      throw new BadRequestException(
        'teamIds must be a non-empty array when visibility is "teams".',
      );
    }
    if (
      scope.visibility === 'project' &&
      (!Array.isArray(scope.projectIds) || scope.projectIds.length === 0)
    ) {
      throw new BadRequestException(
        'projectIds must be a non-empty array when visibility is "project".',
      );
    }
  }

  private enforceImportCountCap(
    total: number,
    kind: 'space' | 'pages',
    cap: number,
  ): void {
    if (total > cap) {
      throw new BadRequestException(
        kind === 'space'
          ? `This space has more than ${cap.toLocaleString()} pages — the cap for a whole-space import is ${cap.toLocaleString()}. Import specific pages instead, or contact support to raise the limit.`
          : `This selection contains ${total} pages — the cap is ${cap.toLocaleString()} per import. Pick fewer pages or contact support to raise the limit.`,
      );
    }
  }

  /** Filesystem/display-safe page title (matches the client's basename rule). */
  private safeTitle(title: string): string {
    return (
      (title || 'Untitled')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'Untitled'
    );
  }
}
