-- Org-wide toggle for the ARSO (Slovenian environmental data) AI tools —
-- ARSO integration Phase D. Keyless integration; off by default. An admin
-- opts in from the Company tab; the chat tool-loop offers ARSO tools only
-- when this company flag is true. Replaces the temporary ARSO_TOOLS_ENABLED
-- env flag used during Phase C.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models / 0030). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "arso_enabled" boolean DEFAULT false NOT NULL;
