-- AI Tools (plugins) — company-admin-registered external HTTP APIs the AI
-- can CALL during chat (function calling), e.g. a weather API.
--
-- Company-scoped registry (every member of a company sees the same catalog,
-- like the Models + Integration tabs; only admins mutate). Credentials are
-- AES-256-GCM encrypted in `api_key_encrypted`, same scheme as
-- `integrations.api_key_encrypted`. `ai_tool_teams` / `ai_tool_projects` gate
-- visibility='teams'/'project' (mirror skill_teams/skill_projects);
-- `ai_tool_executions` is the usage/audit ledger. The chat tool-call loop that
-- consumes this registry is a later phase — see docs/ai-tools-plan.md.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

CREATE TABLE IF NOT EXISTS "ai_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "created_by" uuid,
  "name" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text NOT NULL,
  "input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "http_method" text DEFAULT 'GET' NOT NULL,
  "url_template" text NOT NULL,
  "headers_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "query_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "body_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "auth_type" text DEFAULT 'none' NOT NULL,
  "auth_param_name" text,
  "api_key_encrypted" text,
  "response_path" text,
  "visibility" text DEFAULT 'all' NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "monthly_call_limit" integer,
  "timeout_ms" integer DEFAULT 8000 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "ai_tools"
    ADD CONSTRAINT "ai_tools_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tools"
    ADD CONSTRAINT "ai_tools_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ai_tools_company_idx"
  ON "ai_tools" ("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_tools_company_name_unique"
  ON "ai_tools" ("company_id", "name");

CREATE TABLE IF NOT EXISTS "ai_tool_teams" (
  "tool_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_tool_teams_tool_id_team_id_pk" PRIMARY KEY ("tool_id", "team_id")
);

DO $$ BEGIN
  ALTER TABLE "ai_tool_teams"
    ADD CONSTRAINT "ai_tool_teams_tool_id_ai_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "ai_tools"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tool_teams"
    ADD CONSTRAINT "ai_tool_teams_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ai_tool_teams_team_idx"
  ON "ai_tool_teams" ("team_id");

CREATE TABLE IF NOT EXISTS "ai_tool_projects" (
  "tool_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_tool_projects_tool_id_project_id_pk" PRIMARY KEY ("tool_id", "project_id")
);

DO $$ BEGIN
  ALTER TABLE "ai_tool_projects"
    ADD CONSTRAINT "ai_tool_projects_tool_id_ai_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "ai_tools"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tool_projects"
    ADD CONSTRAINT "ai_tool_projects_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ai_tool_projects_project_idx"
  ON "ai_tool_projects" ("project_id");

CREATE TABLE IF NOT EXISTS "ai_tool_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tool_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid,
  "conversation_id" uuid,
  "arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text NOT NULL,
  "http_status" integer,
  "latency_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "ai_tool_executions"
    ADD CONSTRAINT "ai_tool_executions_tool_id_ai_tools_id_fk"
    FOREIGN KEY ("tool_id") REFERENCES "ai_tools"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tool_executions"
    ADD CONSTRAINT "ai_tool_executions_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tool_executions"
    ADD CONSTRAINT "ai_tool_executions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_tool_executions"
    ADD CONSTRAINT "ai_tool_executions_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ai_tool_executions_tool_idx"
  ON "ai_tool_executions" ("tool_id");

CREATE INDEX IF NOT EXISTS "ai_tool_executions_company_created_idx"
  ON "ai_tool_executions" ("company_id", "created_at");
