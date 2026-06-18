import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { skillArtifacts, skillRuns } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import type { SandboxFile } from './skill-sandbox.js';

/** Root for generated artifact files. One subdir per run. */
const ARTIFACT_DIR = path.join(process.cwd(), 'uploads', 'skill-artifacts');
/** How long a generated artifact is kept before the reaper deletes it. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the retention reaper runs. */
const REAP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Owns the lifecycle of files produced by a sandboxed skill run (Option #3,
 * Phase D): store them on disk + index them in `skill_artifacts`, stream them
 * back to the run owner only, and reap them once `expiresAt` passes so
 * generated files don't accumulate. Runtime-agnostic — it consumes the
 * {@link SandboxFile}s any sandbox returns.
 */
@Injectable()
export class SkillArtifactService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillArtifactService.name);
  private reaperTimer?: ReturnType<typeof setInterval>;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    // Periodic (not startup-only) reaper, so files expire on a running
    // instance without a deploy. unref so it never holds the process open.
    this.reaperTimer = setInterval(() => {
      this.reapExpired().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Skill-artifact reaper failed: ${msg}`);
      });
    }, REAP_INTERVAL_MS);
    this.reaperTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
  }

  /**
   * Persist a run's produced files under uploads/skill-artifacts/<runId>/ and
   * index them with a retention deadline. Filenames are reduced to their
   * basename (untrusted code authored them) to prevent path traversal.
   * Returns the inserted artifact rows. `now` is injectable for tests.
   */
  async store(
    runId: string,
    files: SandboxFile[],
    now: Date = new Date(),
  ): Promise<(typeof skillArtifacts.$inferSelect)[]> {
    if (files.length === 0) return [];
    const dir = path.join(ARTIFACT_DIR, runId);
    await fs.mkdir(dir, { recursive: true });
    const expiresAt = new Date(now.getTime() + RETENTION_MS);

    const rows: (typeof skillArtifacts.$inferSelect)[] = [];
    for (const file of files) {
      // Never trust the producer's path — collapse to a basename.
      const safeName = path.basename(file.filename) || 'artifact';
      const storagePath = path.join(dir, safeName);
      await fs.writeFile(storagePath, file.content);
      const [row] = await this.db
        .insert(skillArtifacts)
        .values({
          runId,
          filename: safeName,
          mimeType: file.mimeType,
          sizeBytes: file.content.byteLength,
          storagePath,
          expiresAt,
        })
        .returning();
      rows.push(row);
    }
    return rows;
  }

  /** The owner's artifacts for one run (newest-irrelevant; insertion order). */
  async listForRun(
    userId: string,
    runId: string,
  ): Promise<(typeof skillArtifacts.$inferSelect)[]> {
    await this.assertRunOwner(userId, runId);
    return this.db
      .select()
      .from(skillArtifacts)
      .where(eq(skillArtifacts.runId, runId));
  }

  /**
   * Resolve an artifact for download, owner-only. Throws NotFound when it's
   * missing/expired and Forbidden when it belongs to another user's run.
   */
  async getForDownload(
    userId: string,
    artifactId: string,
    now: Date = new Date(),
  ): Promise<{ storagePath: string; filename: string; mimeType: string }> {
    const [row] = await this.db
      .select({
        filename: skillArtifacts.filename,
        mimeType: skillArtifacts.mimeType,
        storagePath: skillArtifacts.storagePath,
        expiresAt: skillArtifacts.expiresAt,
        ownerId: skillRuns.userId,
      })
      .from(skillArtifacts)
      .innerJoin(skillRuns, eq(skillArtifacts.runId, skillRuns.id))
      .where(eq(skillArtifacts.id, artifactId));

    if (!row) throw new NotFoundException('Artifact not found.');
    if (row.ownerId !== userId) {
      throw new ForbiddenException('Not your artifact.');
    }
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
      throw new NotFoundException('Artifact has expired.');
    }
    return {
      storagePath: row.storagePath,
      filename: row.filename,
      mimeType: row.mimeType,
    };
  }

  /**
   * Delete artifacts whose retention deadline has passed, plus their files.
   * Returns the count removed. File unlink failures are logged, not fatal —
   * the row is still removed so it isn't retried forever.
   */
  async reapExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.db
      .select({
        id: skillArtifacts.id,
        storagePath: skillArtifacts.storagePath,
      })
      .from(skillArtifacts)
      .where(lt(skillArtifacts.expiresAt, now));

    for (const row of expired) {
      try {
        await fs.unlink(row.storagePath);
      } catch (err) {
        // ENOENT is fine (already gone); log anything else and continue.
        const e = err as NodeJS.ErrnoException;
        if (e?.code !== 'ENOENT') {
          this.logger.warn(
            `Could not delete artifact file ${row.storagePath}: ${e?.message ?? err}`,
          );
        }
      }
      await this.db.delete(skillArtifacts).where(eq(skillArtifacts.id, row.id));
    }
    return expired.length;
  }

  private async assertRunOwner(userId: string, runId: string): Promise<void> {
    const [run] = await this.db
      .select({ userId: skillRuns.userId })
      .from(skillRuns)
      .where(and(eq(skillRuns.id, runId), eq(skillRuns.userId, userId)));
    if (!run) throw new NotFoundException('Run not found.');
  }
}
