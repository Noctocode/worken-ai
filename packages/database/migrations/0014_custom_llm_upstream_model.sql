-- Custom LLM upstream model id. For a Custom LLM the `model_identifier`
-- column holds a synthetic picker id (`user:<short>:<slug>`) that the
-- self-hosted / OpenAI-compatible endpoint would not recognise. This
-- column stores the actual model name to send in the upstream
-- `chat/completions` request (e.g. "Qwen3.6-35B-A3B-FP8").
--
-- NULL for predefined / catalog-bound aliases, where `model_identifier`
-- is already the real upstream model id.
--
-- Hand-authored to match this package's migration style (drizzle meta
-- snapshots aren't maintained — see 0006_drop_enabled_models). The
-- `_journal.json` entry is added alongside this file.

ALTER TABLE "model_configs" ADD COLUMN IF NOT EXISTS "upstream_model" text;
