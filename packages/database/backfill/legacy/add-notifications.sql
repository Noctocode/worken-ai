-- In-app notification inbox. Mirrors the actionable subset of what
-- the mail service sends (team / org invitations) plus auto-emitted
-- info-only alerts (budget thresholds). Email keeps firing in
-- parallel so users who don't open the app don't miss invites.
--
-- One-shot, idempotent. Safe to run before `pnpm db:push`; the push
-- is a no-op afterwards.
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status     text NOT NULL DEFAULT 'pending',
  read_at    timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Bell-popover default list: filter by user + status, order newest
-- first.
CREATE INDEX IF NOT EXISTS notifications_user_status_idx
  ON notifications (user_id, status, created_at);

-- Unread badge probe.
CREATE INDEX IF NOT EXISTS notifications_user_read_idx
  ON notifications (user_id, read_at);

-- Budget-alert idempotency uses an app-side check-before-insert
-- against `data->>'thresholdKey'`; under normal load that's fine
-- since two concurrent chat calls crossing the same threshold in
-- the same millisecond is rare and the worst case is a duplicate
-- notification, not a state corruption.
