import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  knowledgeFiles,
  knowledgeFolders,
  scheduleKnowledgeFiles,
  scheduledPrompts,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { KnowledgeCoreService } from '../knowledge-core/knowledge-core.service.js';

// KC folder schedule uploads land in (auto-created per user), mirroring the
// "Projects" folder used by Manage Context.
const DEFAULT_SCHEDULE_FOLDER_NAME = 'AI Cron';

export interface ScheduleFileView {
  fileId: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  ingestionStatus: string;
  ingestionError: string | null;
  attachedAt: string;
}

/**
 * Files attached to a specific AI Cron schedule — the schedule's equivalent of
 * a project's "Files in this chat". Uploads route through KnowledgeCoreService
 * with visibility='schedule' so they're owner-scoped to the schedule, then get
 * linked via schedule_knowledge_files. Ownership is gated by assertOwner
 * (throws 404 for non-owners).
 */
@Injectable()
export class ScheduleKnowledgeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly knowledgeCore: KnowledgeCoreService,
  ) {}

  /**
   * Ownership gate. Done with a direct query (rather than depending on
   * AiCronService) to avoid an AiCronService → CronRunnerService →
   * ScheduleKnowledgeService → AiCronService DI cycle.
   */
  private async assertOwner(scheduleId: string, userId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: scheduledPrompts.id })
      .from(scheduledPrompts)
      .where(
        and(
          eq(scheduledPrompts.id, scheduleId),
          eq(scheduledPrompts.ownerId, userId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Scheduled prompt not found.');
  }

  async listAttached(
    scheduleId: string,
    callerId: string,
  ): Promise<ScheduleFileView[]> {
    await this.assertOwner(scheduleId, callerId);
    const rows = await this.db
      .select({
        fileId: knowledgeFiles.id,
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        sizeBytes: knowledgeFiles.sizeBytes,
        ingestionStatus: knowledgeFiles.ingestionStatus,
        ingestionError: knowledgeFiles.ingestionError,
        attachedAt: scheduleKnowledgeFiles.attachedAt,
      })
      .from(scheduleKnowledgeFiles)
      .innerJoin(
        knowledgeFiles,
        eq(knowledgeFiles.id, scheduleKnowledgeFiles.fileId),
      )
      .where(eq(scheduleKnowledgeFiles.scheduledPromptId, scheduleId))
      .orderBy(desc(scheduleKnowledgeFiles.attachedAt));
    return rows.map((r) => ({ ...r, attachedAt: r.attachedAt.toISOString() }));
  }

  async getAttachedFileIds(scheduleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ fileId: scheduleKnowledgeFiles.fileId })
      .from(scheduleKnowledgeFiles)
      .where(eq(scheduleKnowledgeFiles.scheduledPromptId, scheduleId));
    return rows.map((r) => r.fileId);
  }

  /** Attach existing KC files the caller owns to the schedule (idempotent). */
  async attach(
    scheduleId: string,
    fileIds: string[],
    callerId: string,
  ): Promise<{ attached: string[] }> {
    await this.assertOwner(scheduleId, callerId);
    const unique = Array.from(
      new Set((fileIds ?? []).filter((s) => typeof s === 'string' && s)),
    );
    if (unique.length === 0) {
      throw new BadRequestException('`fileIds` must be a non-empty array.');
    }
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
    if (unique.some((id) => !ownedIds.has(id))) {
      throw new ForbiddenException(
        'You can only attach knowledge files you uploaded.',
      );
    }
    await this.db
      .insert(scheduleKnowledgeFiles)
      .values(
        unique.map((fileId) => ({
          scheduledPromptId: scheduleId,
          fileId,
          attachedBy: callerId,
        })),
      )
      .onConflictDoNothing();
    return { attached: unique };
  }

  async detach(
    scheduleId: string,
    fileId: string,
    callerId: string,
  ): Promise<{ ok: true }> {
    await this.assertOwner(scheduleId, callerId);
    await this.db
      .delete(scheduleKnowledgeFiles)
      .where(
        and(
          eq(scheduleKnowledgeFiles.scheduledPromptId, scheduleId),
          eq(scheduleKnowledgeFiles.fileId, fileId),
        ),
      );
    return { ok: true };
  }

  /**
   * Upload files from the schedule form and attach them. Files land in the
   * caller's "AI Cron" KC folder with visibility='schedule'.
   */
  async uploadAndAttach(
    scheduleId: string,
    callerId: string,
    files: Express.Multer.File[],
    nameConflictActions?: Record<string, 'overwrite' | 'keep_both' | 'skip'>,
  ): Promise<{
    uploaded: Array<{ id: string; name: string; ingestionStatus: string }>;
    duplicates: Array<{ name: string; existing: { id: string | null } }>;
    nameConflicts: Array<{ name: string; existing: { id: string } }>;
  }> {
    await this.assertOwner(scheduleId, callerId);
    if (files.length === 0) {
      throw new BadRequestException('Pick at least one file to upload.');
    }
    const folderId = await this.ensureDefaultScheduleFolder(callerId);
    const result = await this.knowledgeCore.uploadFiles(
      folderId,
      callerId,
      files,
      'schedule',
      undefined,
      undefined,
      nameConflictActions,
    );

    const attachIds = [
      ...result.uploaded.map((u) => u.id),
      ...result.duplicates
        .map((d) => d.existing.id)
        .filter((id): id is string => !!id),
    ];
    if (attachIds.length > 0) {
      await this.db
        .insert(scheduleKnowledgeFiles)
        .values(
          Array.from(new Set(attachIds)).map((fileId) => ({
            scheduledPromptId: scheduleId,
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

  private async ensureDefaultScheduleFolder(userId: string): Promise<string> {
    const [existing] = await this.db
      .select({ id: knowledgeFolders.id })
      .from(knowledgeFolders)
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, DEFAULT_SCHEDULE_FOLDER_NAME),
        ),
      )
      .limit(1);
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(knowledgeFolders)
      .values({ ownerId: userId, name: DEFAULT_SCHEDULE_FOLDER_NAME })
      .returning({ id: knowledgeFolders.id });
    return created.id;
  }
}
