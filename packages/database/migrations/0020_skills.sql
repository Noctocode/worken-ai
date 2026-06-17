-- Skills: auto-selected instructional "how we do X here" recipes.
--
-- Three tables:
--   • skills            — the recipe itself (name + description routing
--                         trigger + injected instructions), owned per user,
--                         scope/visibility mirroring knowledge_files so
--                         company/team provisioning works the same way.
--                         description_embedding is vector(384) to match the
--                         Xenova/all-MiniLM-L6-v2 space DocumentsService.embed
--                         already uses for KC chunks; NULLABLE because it's
--                         filled asynchronously after create.
--   • skill_teams       — team gating for visibility='teams' (mirrors
--                         knowledge_file_teams).
--   • conversation_skills — sticky per-conversation selection so a
--                         procedural skill stays active for the whole
--                         conversation instead of flickering per message;
--                         `pinned` marks a user-forced skill.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models, 0016). The
-- `_journal.json` entry is added alongside this file. IF NOT EXISTS keeps
-- it idempotent against dev databases already advanced via `db:push`.
--
-- NB: no ivfflat/hnsw index on description_embedding — the set of skills a
-- user can see is tiny, so the router cosine-ranks in memory. Only the
-- accessible-filter B-tree indexes are created.

CREATE TABLE IF NOT EXISTS "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instructions" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"visibility" text DEFAULT 'all' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"description_embedding" vector(384),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "skill_teams" (
	"skill_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_teams_skill_id_team_id_pk" PRIMARY KEY("skill_id","team_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_skills" (
	"conversation_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_skills_conversation_id_skill_id_pk" PRIMARY KEY("conversation_id","skill_id")
);--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_teams" ADD CONSTRAINT "skill_teams_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_teams" ADD CONSTRAINT "skill_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_skills" ADD CONSTRAINT "conversation_skills_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_skills" ADD CONSTRAINT "conversation_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_scope_visibility_idx" ON "skills" USING btree ("scope","visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skills_user_idx" ON "skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_teams_team_idx" ON "skill_teams" USING btree ("team_id");
