-- add_email_verification_and_profile_type
-- Email verification for password-authenticated users + profile-type picker
-- ("Set up your WorkenAI Identity") shown after first sign-in.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "verification_token_hash" text,
  ADD COLUMN IF NOT EXISTS "verification_token_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "profile_type" text;

-- Backfill: every user that exists today got in via Google OAuth (the only
-- sign-in method before this change), so their email is implicitly verified.
-- No way to distinguish them from new unverified password users otherwise.
UPDATE "users"
SET "email_verified_at" = COALESCE("created_at", now())
WHERE "email_verified_at" IS NULL
  AND "google_id" IS NOT NULL;
