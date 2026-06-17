-- Project gating for skills (visibility='project').
--
-- Mirrors project_knowledge_files / skill_teams: a row grants one project
-- access to a skill, so a project-scoped skill applies when someone with
-- access to that project chats IN it (the chat carries projectId). The
-- skills.visibility column already exists (text) — no enum change needed,
-- 'project' is just a new accepted value.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file. Idempotent guards so
-- re-running on an already-applied database is a no-op.

CREATE TABLE IF NOT EXISTS "skill_projects" (
	"skill_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_projects_skill_id_project_id_pk" PRIMARY KEY("skill_id","project_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_projects" ADD CONSTRAINT "skill_projects_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "skill_projects" ADD CONSTRAINT "skill_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_projects_project_idx" ON "skill_projects" USING btree ("project_id");
