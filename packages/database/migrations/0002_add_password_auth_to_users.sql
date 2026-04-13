-- add_password_auth_to_users
-- Allows users to register with email + password in addition to Google OAuth.
-- google_id becomes nullable so password-only users can exist; a new
-- password_hash column stores the argon2 hash for password-authenticated users.

ALTER TABLE "users"
  ALTER COLUMN "google_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "password_hash" text;
