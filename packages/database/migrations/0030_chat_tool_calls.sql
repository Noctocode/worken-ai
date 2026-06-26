-- Tool (function) calls the assistant made while producing a message — e.g.
-- the ARSO weather/air/water tools (ARSO integration Phase C). One row per
-- call, linked to the assistant message + conversation, so reopening a chat
-- can show "called ARSO weather". Arguments stored redacted of any secrets.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

CREATE TABLE IF NOT EXISTS "chat_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "tool_name" text NOT NULL,
  "arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ok" boolean NOT NULL,
  "summary" text,
  "latency_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "chat_tool_calls"
    ADD CONSTRAINT "chat_tool_calls_message_id_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "chat_tool_calls"
    ADD CONSTRAINT "chat_tool_calls_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "chat_tool_calls_message_idx"
  ON "chat_tool_calls" ("message_id");

CREATE INDEX IF NOT EXISTS "chat_tool_calls_conversation_idx"
  ON "chat_tool_calls" ("conversation_id");
