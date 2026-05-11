/**
 * One-off backfill: migrate legacy onboarding uploads from
 * `knowledge_documents` into `knowledge_files` so they appear in the
 * /knowledge-core UI.
 *
 * Background: before this migration, onboarding uploads went into a
 * separate table (`knowledge_documents`) and storage directory
 * (`uploads/knowledge/<userId>/`), invisible to the Knowledge Core UI
 * which reads `knowledge_folders` + `knowledge_files`. The runtime
 * code now writes onboarding uploads straight into `knowledge_files`
 * under a per-user "Onboarding" folder; this script does the same for
 * pre-existing rows.
 *
 * What it does, per row in `knowledge_documents`:
 *   1. Find-or-create the per-user `Onboarding` folder in
 *      `knowledge_folders`.
 *   2. Copy the file from `uploads/knowledge/<userId>/<basename>` to
 *      `uploads/knowledge-core/<basename>` (copy, not move — leaves a
 *      fallback on disk in case the script needs re-running).
 *   3. Insert a `knowledge_files` row pointing at the new path,
 *      carrying over scope, ingestion_status, ingestion_error,
 *      ingestion_completed_at, and created_at so badges + RAG behave
 *      identically post-migration.
 *   4. Re-link `knowledge_chunks` (UPDATE …SET file_id=new,
 *      document_id=NULL WHERE document_id=old) so the existing
 *      embeddings keep working without re-embedding. Saves API cost
 *      and keeps RAG continuous through the migration.
 *
 * What it does NOT do (deliberately, kept for a follow-up PR):
 *   • Drop `knowledge_documents` rows or the `uploads/knowledge/`
 *     directory tree. Both stay on disk / in the DB as a fallback.
 *     Once the new path is verified on prod, a separate cleanup
 *     script can sweep them.
 *
 * Idempotency: the script detects an already-migrated row by
 * matching the destination `storage_path` (`uploads/knowledge-core/
 * <basename>`) — re-running after a partial run is safe.
 * Steps 1-4 for each row run inside one DB transaction; if the
 * chunk relink fails the file insert is rolled back too, so a half-
 * migrated state isn't possible.
 *
 * How to run (from repo root):
 *   pnpm tsx packages/database/backfill/backfill-onboarding-to-kc.ts --dry-run
 *   pnpm tsx packages/database/backfill/backfill-onboarding-to-kc.ts
 *
 * `--dry-run` previews the plan without touching the DB or disk.
 * Recommended before the live run.
 */
import { Pool, type PoolClient } from 'pg';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, extname, posix as pathPosix, resolve } from 'node:path';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://worken:worken@localhost:5432/worken';
const DRY_RUN = process.argv.includes('--dry-run');

const ONBOARDING_FOLDER_NAME = 'Onboarding';
const KC_STORAGE_PREFIX = 'uploads/knowledge-core';

interface LegacyDocRow {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  scope: string;
  ingestion_status: string;
  ingestion_error: string | null;
  ingestion_completed_at: Date | null;
  created_at: Date;
}

async function findOrCreateOnboardingFolder(
  client: PoolClient,
  userId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM knowledge_folders
     WHERE owner_id = $1 AND name = $2
     LIMIT 1`,
    [userId, ONBOARDING_FOLDER_NAME],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO knowledge_folders (owner_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, ONBOARDING_FOLDER_NAME],
  );
  return inserted.rows[0].id;
}

function fileTypeFromName(name: string): string {
  const ext = extname(name).replace('.', '').toUpperCase();
  return ext || 'FILE';
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const safeDbUrl = DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log(`DB: ${safeDbUrl}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('');

  const pool = new Pool({ connectionString: DATABASE_URL });

  const { rows: docs } = await pool.query<LegacyDocRow>(`
    SELECT
      id,
      user_id,
      filename,
      storage_path,
      size_bytes,
      scope,
      ingestion_status,
      ingestion_error,
      ingestion_completed_at,
      created_at
    FROM knowledge_documents
    ORDER BY created_at ASC
  `);

  console.log(`Found ${docs.length} legacy onboarding document(s).`);
  if (docs.length === 0) {
    await pool.end();
    return;
  }

  let migrated = 0;
  let skippedAlreadyMigrated = 0;
  let skippedMissingFile = 0;
  let failed = 0;

  for (const doc of docs) {
    // basename is the UUID-prefixed name written by the legacy
    // onboarding service. We reuse it verbatim in the new location so
    // a partial / re-run is detectable via the destination path.
    const basename = pathPosix.basename(doc.storage_path);
    const newStoragePath = pathPosix.join(KC_STORAGE_PREFIX, basename);

    // Idempotency check: a previous run may have created the
    // knowledge_files row already. Detect by destination path.
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM knowledge_files WHERE storage_path = $1 LIMIT 1`,
      [newStoragePath],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      skippedAlreadyMigrated++;
      console.log(
        `· doc ${doc.id} (${doc.filename}): already migrated → file ${existing.rows[0].id}, skipping.`,
      );
      continue;
    }

    const srcAbsolute = resolve(process.cwd(), doc.storage_path);
    const dstAbsolute = resolve(process.cwd(), newStoragePath);

    if (!(await pathExists(srcAbsolute))) {
      skippedMissingFile++;
      console.warn(
        `! doc ${doc.id} (${doc.filename}): source file missing at ${srcAbsolute} — skipping (no row inserted, chunks left as-is).`,
      );
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[dry] doc ${doc.id} (${doc.filename}): would copy ${srcAbsolute} → ${dstAbsolute}, insert into Onboarding folder for user ${doc.user_id}, re-link chunks.`,
      );
      migrated++;
      continue;
    }

    const client = await pool.connect();
    try {
      // Copy first, outside the txn. copyFile is atomic-enough for
      // our purposes (interrupted copies leave a truncated dst that
      // the next idempotent run will overwrite via copyFile again).
      // Keeping it outside the txn avoids holding a DB connection
      // open during disk I/O for many files.
      await mkdir(dirname(dstAbsolute), { recursive: true });
      await copyFile(srcAbsolute, dstAbsolute);

      await client.query('BEGIN');

      const folderId = await findOrCreateOnboardingFolder(client, doc.user_id);

      // Insert the knowledge_files row, carrying ingestion state over
      // verbatim. file_type derived from filename extension (matches
      // KnowledgeCoreService.uploadFiles convention).
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO knowledge_files (
           folder_id,
           name,
           file_type,
           size_bytes,
           storage_path,
           uploaded_by_id,
           scope,
           ingestion_status,
           ingestion_error,
           ingestion_completed_at,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          folderId,
          doc.filename,
          fileTypeFromName(doc.filename),
          doc.size_bytes,
          newStoragePath,
          doc.user_id,
          doc.scope,
          doc.ingestion_status,
          doc.ingestion_error,
          doc.ingestion_completed_at,
          doc.created_at,
        ],
      );
      const newFileId = inserted.rows[0].id;

      // Re-link chunks: the same embeddings keep working, no
      // re-embed cost. The knowledge_chunks table allows either
      // documentId or fileId (both nullable, no CHECK), so flipping
      // the pointer is safe.
      const relinked = await client.query(
        `UPDATE knowledge_chunks
         SET file_id = $1, document_id = NULL
         WHERE document_id = $2`,
        [newFileId, doc.id],
      );

      // Bump the folder's updatedAt so /knowledge-core sorts it
      // sensibly on the user's first visit post-migration.
      await client.query(
        `UPDATE knowledge_folders SET updated_at = NOW() WHERE id = $1`,
        [folderId],
      );

      await client.query('COMMIT');
      migrated++;
      console.log(
        `✓ doc ${doc.id} (${doc.filename}): → file ${newFileId} in folder ${folderId} (${relinked.rowCount ?? 0} chunk(s) re-linked).`,
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      failed++;
      console.error(
        `✗ doc ${doc.id} (${doc.filename}): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }

  console.log('');
  if (DRY_RUN) {
    console.log(
      `Dry-run done: ${migrated} would migrate, ${skippedAlreadyMigrated} already migrated, ${skippedMissingFile} missing on disk.`,
    );
  } else {
    console.log(
      `Done: ${migrated} migrated, ${skippedAlreadyMigrated} already migrated, ${skippedMissingFile} missing on disk, ${failed} failed.`,
    );
  }

  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
