/**
 * One-off backfill: PATCH OpenRouter key limits to match monthlyBudgetCents
 * in our DB.
 *
 * Why: until the credit_limit→limit fix landed, every key we provisioned was
 * created with `limit: null` because the OpenRouter API silently ignored the
 * wrong field name. Our DB recorded the intended budget; OpenRouter did not
 * enforce it. This script backfills `limit` on each existing key so that
 * older teams and users get the budget cap they were supposed to have all
 * along.
 *
 * Idempotent: PATCH with the current limit is a no-op. Safe to re-run after
 * a partial pass; only keys that still need updating actually change.
 *
 * Pass `--dry-run` to preview the plan without calling PATCH. Recommended
 * before the live run.
 *
 * How to run (from repo root):
 *   pnpm tsx packages/database/backfill/backfill-openrouter-limits.ts --dry-run
 *   pnpm tsx packages/database/backfill/backfill-openrouter-limits.ts
 *
 * Or via ts-node (already a dep of apps/api):
 *   pnpm --filter @worken/api exec ts-node \
 *     ../../packages/database/backfill/backfill-openrouter-limits.ts --dry-run
 */
import { Pool } from 'pg';

// Mirror apps/api/src/database/database.module.ts so the script works
// out of the box against the local docker-compose Postgres.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://worken:worken@localhost:5432/worken';
const PROVISIONING_KEY = process.env.OPENROUTER_PROVISIONING_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!PROVISIONING_KEY) {
  console.error('OPENROUTER_PROVISIONING_KEY is not set. Aborting.');
  process.exit(1);
}

interface Target {
  scope: 'team' | 'user';
  id: string;
  hash: string;
  budgetCents: number;
}

interface KeyState {
  limit: number | null;
}

async function getKey(hash: string): Promise<KeyState | null> {
  const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    headers: { Authorization: `Bearer ${PROVISIONING_KEY}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { limit?: number | null } };
  return { limit: json.data?.limit ?? null };
}

async function patchLimit(
  hash: string,
  limitUsd: number,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const res = await fetch(`https://openrouter.ai/api/v1/keys/${hash}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${PROVISIONING_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: limitUsd }),
  });
  if (res.ok) return { ok: true };
  const text = await res.text().catch(() => '');
  return { ok: false, status: res.status, error: text };
}

async function main(): Promise<void> {
  // Redact credentials before logging the DB URL.
  const safeDbUrl = DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  console.log(`DB: ${safeDbUrl}`);
  if (DRY_RUN) {
    console.log('Mode: DRY RUN (no PATCH calls)');
  } else {
    console.log('Mode: LIVE (PATCH /keys/:hash will be called)');
  }
  console.log('');

  const pool = new Pool({ connectionString: DATABASE_URL });

  const { rows: teamRows } = await pool.query<{
    id: string;
    openrouter_key_id: string;
    monthly_budget_cents: number;
  }>(`
    SELECT id, openrouter_key_id, monthly_budget_cents
    FROM teams
    WHERE openrouter_key_id IS NOT NULL
      AND monthly_budget_cents > 0
  `);

  const { rows: userRows } = await pool.query<{
    id: string;
    openrouter_key_id: string;
    monthly_budget_cents: number;
  }>(`
    SELECT id, openrouter_key_id, monthly_budget_cents
    FROM users
    WHERE openrouter_key_id IS NOT NULL
      AND monthly_budget_cents > 0
  `);

  const targets: Target[] = [
    ...teamRows.map((r) => ({
      scope: 'team' as const,
      id: r.id,
      hash: r.openrouter_key_id,
      budgetCents: r.monthly_budget_cents,
    })),
    ...userRows.map((r) => ({
      scope: 'user' as const,
      id: r.id,
      hash: r.openrouter_key_id,
      budgetCents: r.monthly_budget_cents,
    })),
  ];

  console.log(
    `Found ${teamRows.length} team(s) and ${userRows.length} user(s) with provisioned keys.`,
  );
  if (DRY_RUN) {
    console.log('DRY RUN — no PATCH calls will be made.\n');
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let wouldUpdate = 0;

  for (const target of targets) {
    const limitUsd = target.budgetCents / 100;
    const state = await getKey(target.hash);
    if (state && state.limit === limitUsd) {
      skipped++;
      console.log(
        `· ${target.scope} ${target.id}: already at $${limitUsd}, skipping.`,
      );
      continue;
    }

    const before = state?.limit;
    const beforeLabel = before == null ? 'null' : `$${before}`;

    if (DRY_RUN) {
      wouldUpdate++;
      console.log(
        `[dry] ${target.scope} ${target.id}: would set limit ${beforeLabel} → $${limitUsd}`,
      );
      continue;
    }

    const result = await patchLimit(target.hash, limitUsd);
    if (result.ok) {
      updated++;
      console.log(
        `✓ ${target.scope} ${target.id}: limit ${beforeLabel} → $${limitUsd}`,
      );
    } else {
      failed++;
      console.error(
        `✗ ${target.scope} ${target.id}: PATCH ${target.hash} failed (${result.status ?? 'no status'}) — ${result.error ?? 'no body'}`,
      );
    }
  }

  if (DRY_RUN) {
    console.log(
      `\nDry-run done: ${wouldUpdate} would be updated, ${skipped} already correct.`,
    );
  } else {
    console.log(
      `\nDone: ${updated} updated, ${skipped} already correct, ${failed} failed.`,
    );
  }

  await pool.end();

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
