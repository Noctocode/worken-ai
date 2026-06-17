# Integration tests (`*.int-spec.ts`)

These run against a **real PostgreSQL + pgvector** database spun up per run via
[Testcontainers](https://node.testcontainers.org/) and migrated with the
committed `packages/database` migrations. They exist for SQL that unit mocks
can't exercise — visibility / access predicates, joins, pgvector similarity.

## Run

```bash
pnpm --filter api test:integration
```

Requires **Docker** (the harness pulls/uses `pgvector/pgvector:pg16`). The
plain unit suite (`pnpm --filter api test`, `*.spec.ts`) does **not** start a
container and needs no Docker, so it stays fast.

## Writing one

- Name the file `*.int-spec.ts` (matched only by `jest.integration.config.cjs`).
- `startTestDb()` from `db-harness.ts` gives `{ db, pool, stop }` — a migrated,
  isolated DB. Always `await t.stop()` in `afterAll`.
- Seed with the drizzle `db` + `@worken/database/schema` table objects.
- Embeddings: the access tests stub the query embedding to a constant 384-dim
  vector and call with a high `limit`, so assertions are about which rows the
  ACCESS predicate returns, not similarity ranking.

`db-harness.ts` is excluded from `nest build` (see `tsconfig.build.json`), so
the production bundle never pulls in `testcontainers`.
