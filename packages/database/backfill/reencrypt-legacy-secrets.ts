/**
 * Encryption-key rotation migration.
 *
 * Walks every column we encrypt at rest and lifts rows still in the
 * legacy (pre-versioned) ciphertext format to the v1 format under the
 * current OPENROUTER_ENCRYPTION_KEY. Idempotent: rows already starting
 * with `v1:` are skipped.
 *
 * Tables/columns covered:
 *   users.openrouter_key_encrypted
 *   teams.openrouter_key_encrypted
 *   integrations.api_key_encrypted
 *
 * How to run (from repo root):
 *   pnpm tsx packages/database/backfill/reencrypt-legacy-secrets.ts --dry-run
 *   pnpm tsx packages/database/backfill/reencrypt-legacy-secrets.ts
 *
 * Required env (typically already in .env):
 *   DATABASE_URL                    Postgres connection string
 *   OPENROUTER_ENCRYPTION_KEY       64-hex current key (target)
 *
 * Optional env (only when rotating):
 *   OPENROUTER_ENCRYPTION_KEY_PREVIOUS  64-hex old key — set when the
 *                                       legacy rows were encrypted with
 *                                       a different key than the current
 *                                       one. Without this env, decrypt
 *                                       falls back to the current key.
 */
import { Pool } from 'pg';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://worken:worken@localhost:5432/worken';
const CURRENT_KEY_HEX = process.env.OPENROUTER_ENCRYPTION_KEY;
const PREVIOUS_KEY_HEX = process.env.OPENROUTER_ENCRYPTION_KEY_PREVIOUS;
const DRY_RUN = process.argv.includes('--dry-run');

if (!CURRENT_KEY_HEX || CURRENT_KEY_HEX.length !== 64) {
  console.error(
    'OPENROUTER_ENCRYPTION_KEY must be 64 hex characters. Aborting.',
  );
  process.exit(1);
}

const currentKey = Buffer.from(CURRENT_KEY_HEX, 'hex');
const previousKey =
  PREVIOUS_KEY_HEX && PREVIOUS_KEY_HEX.length === 64
    ? Buffer.from(PREVIOUS_KEY_HEX, 'hex')
    : null;

function isLegacy(stored: string): boolean {
  return !stored.startsWith('v1:') && !stored.startsWith('v2:');
}

function decryptLegacy(stored: string): string {
  const [ivHex, ctHex, authTagHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const tryWith = (key: Buffer): string => {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(authTag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  };
  if (previousKey) {
    try {
      return tryWith(previousKey);
    } catch {
      return tryWith(currentKey);
    }
  }
  return tryWith(currentKey);
}

function encryptV1(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', currentKey, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('hex'),
    ct.toString('hex'),
    authTag.toString('hex'),
  ].join(':');
}

interface Target {
  table: string;
  column: string;
}

const TARGETS: Target[] = [
  { table: 'users', column: 'openrouter_key_encrypted' },
  { table: 'teams', column: 'openrouter_key_encrypted' },
  { table: 'integrations', column: 'api_key_encrypted' },
];

async function main(): Promise<void> {
  const safeUrl = DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log(`DB:   ${safeUrl}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Previous key set: ${previousKey ? 'yes' : 'no'}`);
  console.log('');

  const pool = new Pool({ connectionString: DATABASE_URL });

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const t of TARGETS) {
    console.log(`── ${t.table}.${t.column} ──`);
    const { rows } = await pool.query<{ id: string; value: string | null }>(
      `SELECT id, ${t.column} AS value FROM ${t.table} WHERE ${t.column} IS NOT NULL`,
    );
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const r of rows) {
      if (!r.value) continue;
      if (!isLegacy(r.value)) {
        skipped++;
        continue;
      }
      try {
        const plain = decryptLegacy(r.value);
        const v1 = encryptV1(plain);
        if (!DRY_RUN) {
          await pool.query(
            `UPDATE ${t.table} SET ${t.column} = $1 WHERE id = $2`,
            [v1, r.id],
          );
        }
        updated++;
        console.log(
          `  ${DRY_RUN ? '[dry] would update' : '✓ updated'} ${t.table}/${r.id}`,
        );
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${t.table}/${r.id} decrypt failed: ${msg}`);
      }
    }
    console.log(
      `  → ${updated} updated, ${skipped} already v1, ${failed} failed\n`,
    );
    totalUpdated += updated;
    totalSkipped += skipped;
    totalFailed += failed;
  }

  console.log('');
  console.log(
    `Done: ${totalUpdated} re-encrypted, ${totalSkipped} skipped, ${totalFailed} failed.`,
  );
  await pool.end();
  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Migration crashed:', err);
  process.exit(1);
});
