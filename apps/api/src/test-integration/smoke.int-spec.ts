import { sql } from 'drizzle-orm';
import { startTestDb, type TestDb } from './db-harness.js';

// Sanity check that the harness boots a pgvector container and the real
// migrations apply cleanly. If this fails, every other *.int-spec is moot.
describe('integration harness', () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await startTestDb();
  });

  afterAll(async () => {
    await t?.stop();
  });

  it('runs migrations — core KC tables + pgvector exist', async () => {
    const ext = await t.pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`,
    );
    expect(ext.rowCount).toBe(1);

    const tables = await t.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('knowledge_files','knowledge_chunks',
           'knowledge_file_teams','project_knowledge_files','users')`,
    );
    expect(tables.rowCount).toBe(5);
  });

  it('drizzle client can query', async () => {
    const rows = await t.db.execute(sql`SELECT 1 AS ok`);
    const out = (rows as { rows?: Array<{ ok: number }> }).rows ?? rows;
    expect(Array.isArray(out)).toBe(true);
  });
});
