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
//      entry in meta/_journal.json — drizzle-kit migrate refuses to
//      run unlisted files and silently skipping a migration is the
//      same class of bug as omitting it entirely.
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
