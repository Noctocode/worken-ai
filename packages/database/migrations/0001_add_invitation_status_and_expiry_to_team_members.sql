-- add_invitation_status_and_expiry_to_team_members
-- Adds lifecycle columns to team_members for invitation expiry and revocation.

ALTER TABLE "team_members"
  ADD COLUMN IF NOT EXISTS "invitation_status" text,
  ADD COLUMN IF NOT EXISTS "invitation_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "invitation_revoked_at" timestamptz;

-- Backfill: rows that still have a token are pending invites — give them a 7-day window from creation.
UPDATE "team_members"
SET "invitation_status" = 'pending',
    "invitation_expires_at" = "created_at" + INTERVAL '7 days'
WHERE "invitation_token" IS NOT NULL
  AND "status" = 'pending'
  AND "invitation_status" IS NULL;

-- Backfill: rows with an attached user (already joined) get marked accepted.
UPDATE "team_members"
SET "invitation_status" = 'accepted'
WHERE "user_id" IS NOT NULL
  AND "status" = 'accepted'
  AND "invitation_status" IS NULL;
