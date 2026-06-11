-- Enforce unique project names within scope, case-insensitively.
--
-- Personal projects (team_id IS NULL) are unique per owner; team projects
-- per team. This is the race-safe backstop behind the friendly pre-check
-- in ProjectsService.assertNameAvailable — two concurrent creates that
-- both pass the SELECT can no longer both persist a duplicate. The service
-- translates the resulting 23505 back into the same 409.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

-- A unique index can't be created while duplicates already exist, so first
-- disambiguate any pre-existing collisions by appending the row id (unique
-- per row, so the suffixed names can't re-collide within their scope). The
-- oldest row in each colliding group (rn = 1) keeps its original name.

-- Personal scope: (user_id, lower(name)) where team_id IS NULL.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY created_at, id
    ) AS rn
  FROM projects
  WHERE team_id IS NULL
)
UPDATE projects p
SET name = p.name || ' (' || p.id::text || ')'
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

-- Team scope: (team_id, lower(name)) where team_id IS NOT NULL.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY team_id, lower(name)
      ORDER BY created_at, id
    ) AS rn
  FROM projects
  WHERE team_id IS NOT NULL
)
UPDATE projects p
SET name = p.name || ' (' || p.id::text || ')'
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "projects_personal_name_unique"
  ON "projects" ("user_id", lower("name"))
  WHERE "team_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "projects_team_name_unique"
  ON "projects" ("team_id", lower("name"))
  WHERE "team_id" IS NOT NULL;
