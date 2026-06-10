#!/usr/bin/env node
// Verify that the Drizzle schema and the SQL migrations agree on the
// set of tables that should exist on a freshly-migrated database.
//
// Background: this repo ran into a production incident where the
// schema declared `team_integration_links` but no migration created
// it (fixed by migrations/0003). The meta-snapshot directory is
// incomplete, so `drizzle-kit generate` can't catch this kind of drift
// without interactive prompts. This script is a cheap belt-and-braces
// check that runs in CI on every PR.
//
// What it checks:
//   1. Every `pgTable("name", ...)` in src/schema/index.ts has a
//      net-positive `CREATE TABLE "name"` across migrations/*.sql
//      (CREATEs minus DROPs).
//   2. No table is created by migrations but missing from the schema
//      (orphans like the old `enabled_models` we just dropped in 0004).
//   3. Every numbered `.sql` file under migrations/ has a journal
//      entry in meta/_journal.json (and vice versa) — drizzle-kit
//      migrate refuses to run unlisted files and silently skipping a
//      migration is the same class of bug as omitting it entirely.
//   4. Journal `when` timestamps are unique + strictly increasing and
//      `idx` is sequential. Drizzle applies only entries newer than the
//      last-applied one, so a colliding/out-of-order `when` (e.g. after
//      a renumber) silently skips a migration on already-migrated
//      environments — the production incident behind #199.
//
// What it does NOT check (out of scope for now):
//   - Per-column nullability / default / type drift. The spot-check
//     audit on 140-check-migrations showed all columns currently
//     match; a full structural diff would need a real SQL parser.
//   - FK ON DELETE rule drift. Same reason.
//   - Index coverage. Same reason.
//
// Exit code 0 = clean, 1 = drift found (CI fails the PR).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const schemaPath = join(pkgRoot, "src", "schema", "index.ts");
const migrationsDir = join(pkgRoot, "migrations");
const journalPath = join(migrationsDir, "meta", "_journal.json");

// ──────────────────────────────────────────────────────────────────
// Parse the schema
// ──────────────────────────────────────────────────────────────────
// We deliberately match only top-level `export const … = pgTable("…"`
// declarations so a `pgTable("foo")` string inside a comment or a
// helper builder doesn't pollute the set.
const schemaSrc = readFileSync(schemaPath, "utf8");
const schemaTables = new Set(
  [...schemaSrc.matchAll(/^export const \w+ = pgTable\(\s*"([^"]+)"/gm)].map(
    (m) => m[1],
  ),
);

// ──────────────────────────────────────────────────────────────────
// Parse migrations
// ──────────────────────────────────────────────────────────────────
const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// Per-table last-write-wins so a CREATE → DROP → CREATE sequence
// (or DROP → CREATE for a table reinstated by a later migration)
// resolves to the correct final state. We can't just diff two sets
// because that loses ordering and multiplicity. Map<name, present>:
// `true` after a CREATE, `false` after a DROP. Final present-state
// table set = entries still holding `true` at the end of the replay.
// drizzle-kit always emits double-quoted identifiers, so only
// `"name"` is matched here — bare identifiers would need a separate
// regex if we ever start mixing styles.
const tableState = new Map();

// Single combined regex so CREATE and DROP statements are visited in
// source order; alternation captures put the matched op into group 1
// (CREATE) or group 3 (DROP) with the table name in group 2 or 4.
const stmtRe =
  /(?:(CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"|(DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)")/gi;

for (const file of sqlFiles) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  for (const m of sql.matchAll(stmtRe)) {
    if (m[1]) tableState.set(m[2], true);
    else if (m[3]) tableState.set(m[4], false);
  }
}

const finalMigratedTables = new Set(
  [...tableState.entries()]
    .filter(([, present]) => present)
    .map(([name]) => name),
);

// ──────────────────────────────────────────────────────────────────
// Parse the journal
// ──────────────────────────────────────────────────────────────────
const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const journalTags = new Set(journal.entries.map((e) => e.tag));

// ──────────────────────────────────────────────────────────────────
// Compare
// ──────────────────────────────────────────────────────────────────
const errors = [];

// 1. Schema declares a table that's never been created (or has been
//    created then dropped).
for (const t of schemaTables) {
  if (!finalMigratedTables.has(t)) {
    errors.push(
      `Schema declares table "${t}" but no migration creates it ` +
        `(or it was later dropped). Add a CREATE TABLE in a new ` +
        `numbered migration under packages/database/migrations/.`,
    );
  }
}

// 2. Migration creates a table that the schema doesn't know about.
//    This is the `enabled_models` situation from before 0004.
for (const t of finalMigratedTables) {
  if (!schemaTables.has(t)) {
    errors.push(
      `Migration creates table "${t}" but no pgTable declaration ` +
        `exists in src/schema/index.ts. Either add the schema ` +
        `declaration or drop the table in a new migration.`,
    );
  }
}

// 3. Every .sql file must be listed in the journal — drizzle-kit
//    migrate uses the journal as the source of truth for what to run.
for (const file of sqlFiles) {
  const tag = file.replace(/\.sql$/, "");
  if (!journalTags.has(tag)) {
    errors.push(
      `Migration file "${file}" is not listed in meta/_journal.json. ` +
        `Add an entry { idx, tag: "${tag}" } so drizzle-kit picks it ` +
        `up.`,
    );
  }
}

// 4. Every journal entry must have a backing file — a tag without a
//    file would crash drizzle-kit migrate at run time.
const sqlTags = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, "")));
for (const tag of journalTags) {
  if (!sqlTags.has(tag)) {
    errors.push(
      `Journal entry "${tag}" has no matching .sql file under ` +
        `packages/database/migrations/. Either add the file or remove ` +
        `the entry.`,
    );
  }
}

// 5. Journal `when` timestamps must be UNIQUE and STRICTLY INCREASING in
//    entry order, and `idx` must be sequential. Drizzle's migrator
//    applies only journal entries whose `when` is strictly greater than
//    the last-applied migration's timestamp (it tracks a single
//    high-water mark, not per-file hashes). So a duplicate or
//    out-of-order `when` makes a migration silently skipped on any
//    environment that already applied one with an equal/greater
//    timestamp — no error, no re-run. That's the prod incident in #199:
//    after `0011_integration_config` was renumbered to 0012 (commit
//    9bcccef), the new `0011_conversation_context` kept the same `when`
//    (1779970000000) as the already-applied original 0011, so it was
//    skipped on prod and `conversations.context` never got created.
const orderedEntries = [...(journal.entries ?? [])].sort(
  (a, b) => a.idx - b.idx,
);
for (let i = 0; i < orderedEntries.length; i++) {
  const cur = orderedEntries[i];
  if (cur.idx !== i) {
    errors.push(
      `Journal idx is not sequential: entry "${cur.tag}" has idx ${cur.idx} ` +
        `but should be ${i} (entries sorted by idx). Renumber so idx runs ` +
        `0,1,2,… without gaps.`,
    );
  }
  if (i === 0) continue;
  const prev = orderedEntries[i - 1];
  if (!(cur.when > prev.when)) {
    errors.push(
      `Journal "when" is not strictly increasing: "${cur.tag}" ` +
        `(when=${cur.when}) is not greater than the previous entry ` +
        `"${prev.tag}" (when=${prev.when}). Drizzle skips any migration ` +
        `whose "when" isn't strictly greater than the last-applied one, so ` +
        `"${cur.tag}" would be silently skipped on environments that already ` +
        `applied "${prev.tag}". Bump "${cur.tag}"'s "when" to a unique value ` +
        `greater than every earlier entry.`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────
// Report
// ──────────────────────────────────────────────────────────────────
if (errors.length === 0) {
  console.log(
    `OK: ${schemaTables.size} schema tables, ${finalMigratedTables.size} ` +
      `migrated tables, ${journalTags.size} journal entries — all aligned.`,
  );
  process.exit(0);
}

console.error("Migration coverage check FAILED:\n");
for (const err of errors) console.error(`  • ${err}`);
console.error(
  `\n${errors.length} problem${errors.length === 1 ? "" : "s"} found.`,
);
process.exit(1);
