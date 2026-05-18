import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool);

  // pgvector is required by `documents.embedding` and `knowledge_chunks.embedding`.
  // Dev seeds it via /docker-entrypoint-initdb.d but prod uses bind-mount pgdata
  // and skips the init step, so do it here. Idempotent.
  console.log("[migrate] ensuring pgvector extension");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");

  // After tsc emit, this file lives at packages/database/dist/migrate.js,
  // and migrations live at packages/database/migrations.
  const migrationsFolder = path.resolve(__dirname, "..", "migrations");

  console.log(`[migrate] running migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("[migrate] done");
  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
