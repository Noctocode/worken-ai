-- AI Cron — scheduled AI prompts.
--
-- Two tables: `scheduled_prompts` (the recurring job definition the user
-- configures on the /ai-cron page) and `scheduled_prompt_runs` (one row per
-- fire, scheduled or manual run-now, holding output + usage metrics + a
-- heartbeat for the reaper). The minute scanner uses
-- (is_enabled, next_run_at) as its hot path.
--
-- Written by hand rather than via `drizzle-kit generate`: the meta snapshot
-- is still in the broken `companies` / `enabled_models` state documented in
-- 0006, so generate prompts interactively and would fold unrelated drift into
-- this migration (see 0008, 0016 for the same note). The `_journal.json`
-- entry is added alongside this file. CREATE TABLE / INDEX statements use
-- IF NOT EXISTS to match this package's migration style (the FK ADDs run once
-- as drizzle tracks applied migrations).

CREATE TABLE IF NOT EXISTS "scheduled_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"team_id" uuid,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"model_identifier" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"use_knowledge_core" boolean DEFAULT false NOT NULL,
	"knowledge_folder_id" uuid,
	"use_web_search" boolean DEFAULT false NOT NULL,
	"deliver_in_app" boolean DEFAULT true NOT NULL,
	"deliver_email" boolean DEFAULT false NOT NULL,
	"deliver_webhook" boolean DEFAULT false NOT NULL,
	"email_recipients" jsonb,
	"webhook_url" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_prompt_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scheduled_prompt_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"triggered_by" text DEFAULT 'schedule' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_heartbeat_at" timestamp with time zone,
	"output" text,
	"error_message" text,
	"model" text,
	"provider" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"delivery_status" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompts" ADD CONSTRAINT "scheduled_prompts_knowledge_folder_id_knowledge_folders_id_fk" FOREIGN KEY ("knowledge_folder_id") REFERENCES "knowledge_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_prompt_runs" ADD CONSTRAINT "scheduled_prompt_runs_prompt_fk" FOREIGN KEY ("scheduled_prompt_id") REFERENCES "scheduled_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_prompts_enabled_next_run_idx" ON "scheduled_prompts" ("is_enabled","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_prompts_owner_idx" ON "scheduled_prompts" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_prompt_runs_prompt_created_idx" ON "scheduled_prompt_runs" ("scheduled_prompt_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_prompt_runs_status_heartbeat_idx" ON "scheduled_prompt_runs" ("status","last_heartbeat_at");
