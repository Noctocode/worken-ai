-- Add is_org_wide flag to guardrails.
--
-- One-shot, idempotent. Safe before `pnpm db:push`; that push is a
-- no-op afterwards. When true, the rule applies to every chat by
-- every user in the owner's company (companyName match) and the
-- per-team links in guardrail_teams are ignored by the evaluator.
ALTER TABLE guardrails
  ADD COLUMN IF NOT EXISTS is_org_wide boolean NOT NULL DEFAULT false;
