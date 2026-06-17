-- AI Cron: per-schedule context text + schedule-scoped Knowledge Core files.
--
-- Adds `scheduled_prompts.context` (free-form framing prepended to the model
-- context on each run) and the `schedule_knowledge_files` link table (mirrors
-- project_knowledge_files). Files attached to a schedule are uploaded into KC
-- with visibility='schedule' and linked here, so they only surface as context
-- for that schedule's runs.
--
-- Hand-authored to match this package's style (drizzle meta snapshots aren't
-- maintained — see 0006/0016/0017). The `when` in _journal.json is set above
-- the shared dev DB's latest applied migration so drizzle-kit doesn't skip it.

ALTER TABLE "scheduled_prompts" ADD COLUMN IF NOT EXISTS "context" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_knowledge_files" (
	"scheduled_prompt_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"attached_by" uuid,
	"attached_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_knowledge_files_pk" PRIMARY KEY("scheduled_prompt_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "schedule_knowledge_files" ADD CONSTRAINT "sched_kf_prompt_fk" FOREIGN KEY ("scheduled_prompt_id") REFERENCES "scheduled_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_knowledge_files" ADD CONSTRAINT "sched_kf_file_fk" FOREIGN KEY ("file_id") REFERENCES "knowledge_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_knowledge_files" ADD CONSTRAINT "sched_kf_by_fk" FOREIGN KEY ("attached_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_knowledge_files_file_idx" ON "schedule_knowledge_files" ("file_id");
