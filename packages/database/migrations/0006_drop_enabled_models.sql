-- Drop the legacy `enabled_models` table.
--
-- The table was created in 0000_worried_maverick but was removed from
-- the Drizzle schema in a later refactor without a corresponding DROP
-- TABLE migration. No application code has referenced it since
-- (confirmed via grep across apps/ and packages/), so on prod the
-- table sits empty taking up no meaningful resources.
--
-- Keeping it around was also actively harmful: `drizzle-kit generate`
-- couldn't tell whether `companies` was a fresh table or a rename of
-- `enabled_models` and prompted interactively, which is part of why
-- the broken meta snapshot state went unnoticed and the
-- `team_integration_links` migration gap (fixed in 0003) slipped
-- through review.
--
-- CASCADE drops the table's own FK constraint
-- (`enabled_models_enabled_by_id_users_id_fk`) automatically; no
-- other object depends on this table.

DROP TABLE IF EXISTS "enabled_models" CASCADE;
