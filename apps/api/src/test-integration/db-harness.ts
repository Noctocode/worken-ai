import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * Ephemeral PostgreSQL+pgvector test database, spun up via Testcontainers and
 * migrated with the real `packages/database` migrations. Gives integration
 * tests a true DB to exercise SQL that mocks can't (visibility/access
 * predicates, joins, pgvector similarity) without touching the dev DB.
 *
 * `pnpm --filter api test:integration` runs every `*.int-spec.ts`; the unit
 * suite (`*.spec.ts`) never starts a container, so plain `pnpm test` stays
 * fast and Docker-free.
 */
export interface TestDb {
  db: NodePgDatabase;
  pool: Pool;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

// pgvector image so `CREATE EXTENSION vector` in migration 0000 succeeds.
const PG_IMAGE = 'pgvector/pgvector:pg16';

function migrationsDir(): string {
  // cwd is apps/api under `pnpm --filter api`; the migrations live in the
  // database package two levels up.
  return path.resolve(process.cwd(), '../../packages/database/migrations');
}

/**
 * Apply every committed migration in journal order. We run each file's raw
 * SQL through node-postgres' simple-query protocol (which accepts multiple
 * `;`-separated statements), rather than drizzle's migrator, so the harness
 * has no dependency on the migrator's bookkeeping table.
 */
async function runMigrations(pool: Pool): Promise<void> {
  // The pgvector image ships the extension but doesn't auto-create it; the
  // committed migrations assume it already exists (the dev/prod DBs created
  // it once out-of-band), so enable it before applying any migration.
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  const dir = migrationsDir();
  const journal = JSON.parse(
    fs.readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  for (const entry of ordered) {
    const sql = fs.readFileSync(path.join(dir, `${entry.tag}.sql`), 'utf8');
    // Strip drizzle's statement-breakpoint markers — pg runs the whole file
    // as one multi-statement query.
    const cleaned = sql.replace(/-->\s*statement-breakpoint/g, '');
    await pool.query(cleaned);
  }
}

export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer(PG_IMAGE).start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  const db = drizzle(pool);
  return {
    db,
    pool,
    container,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
