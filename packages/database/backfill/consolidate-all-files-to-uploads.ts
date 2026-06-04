/**
 * One-off cleanup: consolidate the legacy top-level "All Files" folder
 * into "Uploads".
 *
 * Why: the Knowledge Core root dropzone used to dump uploads into a real
 * folder named "All Files" (created on demand by the old
 * getAllFilesFolderId helper). "All Files" is now a *virtual* aggregate
 * view (sentinel id "__all__"), and root uploads land in a real
 * "Uploads" folder instead. Any workspace that used the old dropzone
 * therefore still has a real "All Files" folder that now renders right
 * next to the virtual "All Files" card — two identically-named entries,
 * with the user's older uploads stranded in the real one.
 *
 * What it does, per owner that has a TOP-LEVEL folder named "All Files":
 *   - No "Uploads" folder yet → rename "All Files" → "Uploads".
 *   - "Uploads" already exists → move every file (and reparent any child
 *     folder) from "All Files" into "Uploads", then delete the now-empty
 *     "All Files" folder. Files are moved first so the ON DELETE CASCADE
 *     on folder_id/parent_folder_id never takes any rows.
 *
 * Scope/caveat: it targets TOP-LEVEL folders named exactly "All Files".
 * A user who deliberately created their own top-level folder with that
 * name is indistinguishable from the legacy one — ALWAYS review the
 * --dry-run output before the live run.
 *
 * Idempotent: after a live run no top-level "All Files" folders remain,
 * so re-running is a no-op.
 *
 * Pass `--dry-run` to preview the plan without writing.
 *
 * How to run (from repo root):
 *   pnpm tsx packages/database/backfill/consolidate-all-files-to-uploads.ts --dry-run
 *   pnpm tsx packages/database/backfill/consolidate-all-files-to-uploads.ts
 */
import { Pool } from 'pg';

// Mirror apps/api/src/database/database.module.ts so the script works
// out of the box against the local docker-compose Postgres.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://worken:worken@localhost:5432/worken';
const DRY_RUN = process.argv.includes('--dry-run');

const LEGACY_NAME = 'All Files';
const TARGET_NAME = 'Uploads';

interface AllFilesFolder {
  id: string;
  owner_id: string;
  file_count: number;
  child_count: number;
}

async function main(): Promise<void> {
  const safeDbUrl = DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log(`DB: ${safeDbUrl}`);
  console.log(DRY_RUN ? 'Mode: DRY RUN (no writes)' : 'Mode: LIVE');
  console.log('');

  const pool = new Pool({ connectionString: DATABASE_URL });

  // Every legacy top-level "All Files" folder, with its direct file +
  // child-folder counts for the plan output.
  const { rows: legacy } = await pool.query<AllFilesFolder>(
    `
    SELECT f.id,
           f.owner_id,
           (SELECT count(*)::int FROM knowledge_files kf
              WHERE kf.folder_id = f.id) AS file_count,
           (SELECT count(*)::int FROM knowledge_folders kc
              WHERE kc.parent_folder_id = f.id) AS child_count
    FROM knowledge_folders f
    WHERE f.parent_folder_id IS NULL
      AND f.name = $1
    `,
    [LEGACY_NAME],
  );

  console.log(`Found ${legacy.length} legacy "${LEGACY_NAME}" folder(s).\n`);

  let renamed = 0;
  let merged = 0;
  let movedFiles = 0;
  let failed = 0;

  for (const folder of legacy) {
    // Does this owner already have a top-level "Uploads" folder?
    const { rows: uploads } = await pool.query<{ id: string }>(
      `
      SELECT id FROM knowledge_folders
      WHERE parent_folder_id IS NULL AND owner_id = $1 AND name = $2
      LIMIT 1
      `,
      [folder.owner_id, TARGET_NAME],
    );
    const uploadsId = uploads[0]?.id ?? null;
    const plan = uploadsId ? 'merge→Uploads' : 'rename→Uploads';

    console.log(
      `· owner ${folder.owner_id}: "${LEGACY_NAME}" (${folder.file_count} file(s), ${folder.child_count} subfolder(s)) → ${plan}`,
    );

    if (DRY_RUN) {
      if (uploadsId) {
        merged++;
        movedFiles += folder.file_count;
      } else {
        renamed++;
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (uploadsId) {
        // Move files + reparent children BEFORE deleting, so the
        // ON DELETE CASCADE on the folder never removes any rows.
        const moved = await client.query(
          `UPDATE knowledge_files SET folder_id = $1 WHERE folder_id = $2`,
          [uploadsId, folder.id],
        );
        await client.query(
          `UPDATE knowledge_folders SET parent_folder_id = $1 WHERE parent_folder_id = $2`,
          [uploadsId, folder.id],
        );
        await client.query(`DELETE FROM knowledge_folders WHERE id = $1`, [
          folder.id,
        ]);
        await client.query('COMMIT');
        merged++;
        movedFiles += moved.rowCount ?? 0;
        console.log(
          `  ✓ merged: moved ${moved.rowCount ?? 0} file(s) into existing "${TARGET_NAME}", deleted legacy folder.`,
        );
      } else {
        await client.query(
          `UPDATE knowledge_folders SET name = $1, updated_at = now() WHERE id = $2`,
          [TARGET_NAME, folder.id],
        );
        await client.query('COMMIT');
        renamed++;
        console.log(`  ✓ renamed to "${TARGET_NAME}".`);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      failed++;
      console.error(
        `  ✗ owner ${folder.owner_id}: failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }

  console.log('');
  if (DRY_RUN) {
    console.log(
      `Dry-run done: ${renamed} would be renamed, ${merged} would be merged (${movedFiles} file(s) moved).`,
    );
  } else {
    console.log(
      `Done: ${renamed} renamed, ${merged} merged (${movedFiles} file(s) moved), ${failed} failed.`,
    );
  }

  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Cleanup crashed:', err);
  process.exit(1);
});
