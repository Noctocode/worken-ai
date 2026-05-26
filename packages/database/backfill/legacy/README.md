# Legacy backfill scripts

Hand-written SQL scripts from the pre-migration era. **None of these
need to run on a database built from the current migration set
(`migrations/0000`+).** They are kept here for historical reference
only — to explain how production databases that predate the migration
pipeline were brought to the current shape.

## When were these run?

Before `0000_worried_maverick.sql` was finalised, schema changes
landed via `pnpm db:push` against early environments and the SQL
scripts in this folder were applied manually as one-shot upgrades.
Once `0000_worried_maverick.sql` captured the consolidated end-state,
the scripts became no-ops on any DB built from migrations — every
table, column, and index they create is already created by 0000 (or
later numbered migrations).

## Why kept, not deleted?

- Some legacy production databases pre-date the migration pipeline
  and may still benefit from the upgrade order documented in these
  comments if anyone has to recover an old snapshot.
- The migrate-* scripts document the *intent* of data transformations
  that the corresponding numbered migration relies on (e.g.,
  `migrate-team-integrations-to-links.sql` was inlined into
  `migrations/0003_team_integration_links.sql` verbatim — the legacy
  copy here is the unembedded original for reference).

## What is NOT here

Runtime maintenance utilities live one directory up in `backfill/`:

- `backfill-openrouter-limits.ts` — one-off API call that PATCHes
  OpenRouter key limits to match `users.monthly_budget_cents`. Still
  relevant if keys provisioned before the credit_limit→limit fix are
  found in the wild.
- `reencrypt-legacy-secrets.ts` — encryption-key rotation utility that
  lifts pre-versioned ciphertexts to the v1 format. Run whenever the
  encryption master key is rotated.

These are NOT legacy schema patches — they operate on data that the
current migrations already accommodate.

## Adding new backfills

Don't add new scripts here. New schema changes go in numbered
migrations under `packages/database/migrations/`. Data-only backfills
that need to run alongside a schema change should be embedded into
the same migration's `.sql` file (the migration runner wraps each
file in a transaction). Standalone runtime utilities — anything that
hits an external API, runs over time, or needs operator supervision —
go in the parent `backfill/` directory as `.ts` files.
