-- Executable skills (Option #3) — foundation schema (Phase A).
--
-- All schema for the subsystem is front-loaded here so later phases need NO
-- new migration (avoids editing an already-applied migration, which drizzle
-- skips by hash). Adds:
--   - skills.scripts (jsonb)            — parsed SKILL.md scripts/resources
--   - observability_events.turn_id      — correlate a multi-call turn's N calls
--   - skill_runs / skill_run_steps / skill_artifacts — execution trace + outputs
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file. Idempotent guards so
-- re-running on an already-applied database is a no-op.

ALTER TABLE "skills" ADD COLUMN IF NOT EXISTS "scripts" jsonb;
--> statement-breakpoint
ALTER TABLE "observability_events" ADD COLUMN IF NOT EXISTS "turn_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "observability_events_turn_idx" ON "observability_events" USING btree ("turn_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"turn_id" uuid,
	"cost_usd" numeric(12, 6),
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_runs_user_idx" ON "skill_runs" USING btree ("user_id","started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_runs_skill_idx" ON "skill_runs" USING btree ("skill_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_type" text NOT NULL,
	"tool" text,
	"input_preview" text,
	"output_preview" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_run_steps" ADD CONSTRAINT "skill_run_steps_run_id_skill_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_run_steps_run_idx" ON "skill_run_steps" USING btree ("run_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_artifacts" ADD CONSTRAINT "skill_artifacts_run_id_skill_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."skill_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_artifacts_run_idx" ON "skill_artifacts" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_artifacts_expires_idx" ON "skill_artifacts" USING btree ("expires_at");
