# Skills — Option #3: Executable skills (implementation plan)

> Companion to `docs/skills-plan.md` → "Follow-up: Option #3". That section is the
> high-level proposal; **this doc is the concrete, code-grounded build plan** for the
> executable-skills subsystem, plus the ordered commit/PR sequence to ship it.
>
> Tracking issue: **#216** (Skills Opcija #3 — izvršljive veščine). Predecessor:
> **#213** (Option #2, auto-selected instructional skills, already merged).

---

## 1. Context & goal

Option #2 skills inject Markdown **instructions** into the model's context. Option #3
adds skills that **run code** — e.g. a "build Excel report" skill that executes a script
and returns a real `.xlsx`. This needs two capabilities WorkenAI does **not** have today:

1. an **agent loop** (model → tool call → execute → feed result back → repeat), and
2. a **sandbox** to run skill code safely.

This is a **new subsystem on an isolated path**, not an increment on the chat stream.

## 2. Current-state findings (grounded in code, 2026-06-17)

Verified before planning so the plan reflects reality, not assumptions:

- **No tool-calling anywhere.** `grep` for `tool_use` / `tools:` / `tool_result` /
  `tool_calls` / `input_schema` across `apps/api/src/integrations/` and
  `apps/api/src/chat/` returns nothing. Neither the Anthropic adapter
  (`integrations/anthropic-client.service.ts`) nor the OpenAI/OpenRouter path sends or
  parses tool calls. → **The agent loop + provider tool-calling are built from scratch.**
- **Single-shot turn today.** `chat.controller.ts` does one upstream completion per user
  message; budget gates (`assertManagedBudgetApproved`,
  `assertTeamMemberCapNotExceeded`, `assertTeamBudgetNotExceeded`,
  `assertOrgBudgetNotExceeded` on `ChatTransportService`) run **once per turn**.
  → multi-call turns must re-gate per upstream call + aggregate spend.
- **Observability is per-call.** `ObservabilityService.recordLLMCall()` inserts **one row
  per LLM call** (`observability.service.ts:564`). → a multi-call turn needs a
  correlation id so the N rows roll up to one turn.
- **Existing "capability" precedent.** Web search is already a gated capability
  (`integrations/web-search-capability.resolver.js`, OpenRouter surcharge) — the model
  for "let a turn use an existing WorkenAI tool" before arbitrary code exists.
- **Forward-compat already in place (from #2).** `skills.source` is `manual | import`
  (add `executable`); the `SKILL.md` parser keeps unknown frontmatter in
  `extraFrontmatter` and preserves the body (`skill-md.parser.ts`) — script sections are
  retained, not yet structurally extracted. `metadata.skills` on assistant messages is
  the place to also record tool steps.

## 3. Architecture decisions

1. **Anthropic-native first.** Build the agent loop on the Anthropic adapter only
   (`integrations/anthropic-client.service.ts`), where tool-calling + a code-execution
   sandbox are first-class. Avoids the multi-provider wire-format tangle for v1; other
   providers fall back to Option-#2 behavior (instructions only).
2. **Isolated execution path.** A dedicated `skill-execution` service + endpoint
   (`POST /skills/:id/run` or an opt-in flag on the chat turn) so `chatStream` and every
   other feature (compare-models, team chat, AI cron, tenders) stay untouched.
3. **Two-stage capability ramp.**
   - **3a — existing tools only (no sandbox):** the agent loop may call a small registry
     of *vetted WorkenAI tools* (KC lookup, web search, document/embedding ops). ~70% of
     the value, **no arbitrary code execution**, dramatically smaller risk surface.
   - **3b — sandboxed script execution:** run skill-provided scripts in a real sandbox
     (container/WASM/Anthropic code-exec) producing file artifacts.
4. **Tool-calling abstraction in the transport layer.** A provider-agnostic tool
   schema + loop driver added to `ChatTransportService`, with the Anthropic adapter as
   the first concrete implementation.
5. **Turn = unit of billing/observability.** A `turnId` correlates all upstream + tool
   calls; budget gates run before each upstream call; spend aggregates to the turn.

## 4. Data model (incremental, additive)

- `skills.source`: add value **`executable`** (no migration shape change — it's a text
  column; just a new accepted value + validation).
- New **`skill_scripts`** (or reuse a JSONB column on `skills`): structured script /
  resource entries extracted from `SKILL.md` (name, language, entrypoint, content/ref).
  Decide table vs JSONB during PR A; JSONB is lighter if scripts stay small.
- New **`skill_runs`** table: one row per execution turn — `id`, `skillId`, `userId`,
  `conversationId?`, `status` (running/done/failed/cancelled), `turnId`, timing, error.
- New **`skill_run_steps`** table: per tool/LLM step within a run — `runId`, `stepType`
  (llm | tool | script), `tool`, input/output preview, tokens, costUsd, latency.
  (Mirrors `observabilityEvents`; or extend that table with a `turnId`/`parentId` instead
  of a new table — decide in PR C.)
- New **`skill_artifacts`** table: generated files — `runId`, filename, mime, sizeBytes,
  storagePath (under `uploads/skill-artifacts/`), createdAt. Cascade on run delete.

## 5. Backend components

- **`SkillExecutionService`** — owns a single run: builds the system prompt from the
  skill, runs the agent loop, persists `skill_runs`/`_steps`/`_artifacts`, emits SSE.
- **Agent loop driver** — model → parse tool calls → dispatch to ToolRegistry → feed
  `tool_result` back → repeat until no tool calls or a step cap (hard max iterations +
  wall-clock + token budget). Fail-closed on cap.
- **`ToolRegistry`** — vetted tools for 3a: `kc_search`, `web_search`,
  `read_attached_file`, `generate_embedding`. Each has a JSON Schema + a guarded handler.
- **Provider tool-calling adapter** — extend `ChatTransportService` with a
  `streamWithTools(...)` that the Anthropic adapter implements (tool_use / tool_result
  blocks); other providers throw "executable skills require an Anthropic-native model".
- **Sandbox runtime (3b)** — pluggable; v1 candidate = Anthropic code execution, fallback
  = a locked-down container/WASM worker with no network, CPU/mem/time limits, ephemeral
  FS. Output files copied to `skill_artifacts`.
- **Multi-call billing/observability** — `turnId` threaded through; budget gate before
  each upstream call; `recordLLMCall` gets `turnId` (+ step index) so a turn rolls up.

## 6. API + SSE

- `POST /skills/:id/run` (or `chat` with `executeSkillId`) → SSE stream of:
  `run_started`, `llm_delta`, `tool_call`, `tool_result`, `artifact`, `run_done`,
  `run_error`. Mirrors the existing chat SSE framing so the FE transport is reused.
- `GET /skills/runs/:id` — run + steps + artifacts (for reload/history).
- `GET /skills/artifacts/:id/download` — stream the generated file (authz: run owner).
- `DELETE /skills/runs/active` — cancel a running execution (abort signal, like chat Stop).

## 7. Frontend

- New chat states: "Running skill…", collapsible **tool-step timeline** (each call +
  result), and **artifact chips** with download — net-new UI under `project-chat/`.
- Reuse the SSE client + the `metadata.skills` indicator; add `metadata.skillRun`.
- Gate the "Run" affordance to executable skills on Anthropic-native models; otherwise
  show why it's unavailable.

## 8. Security model

- 3a: no arbitrary code — only vetted tools, each guarded (KC scoped to the caller's
  accessible chunks, web search via the existing capability gate, no FS/network beyond
  the tool).
- 3b sandbox: no network by default, read-only except a scratch dir, CPU/mem/wall-clock
  caps, output size cap, hard iteration cap on the loop. New `guardrails` coverage for
  what a skill may execute. Artifacts virus/size-checked before download.
- Authz: a run is owned by the caller; artifacts/steps are owner-only. Executable skills
  respect the same visibility gating as #2 (`getAccessibleSkills`).

## 9. Phased delivery (sub-PRs)

Each is its own PR; expect several. Order chosen so each ships value and de-risks the
next.

- **PR A — Foundation (no execution):** `executable` source + structured `SKILL.md`
  script extraction (parse-and-preserve → parse-and-structure) + data model
  (`skill_runs`/`_steps`/`_artifacts` or JSONB) + migration. Builds, no behavior change.
- **PR B — Agent loop, existing tools only (3a), Anthropic-native:** ToolRegistry +
  `streamWithTools` on the Anthropic adapter + `SkillExecutionService` + `POST /run` SSE.
  No sandbox; tools = KC/web-search/read-file.
- **PR C — Multi-call billing + observability:** `turnId` aggregation, per-call budget
  gating across the loop, run/step persistence wired to `ObservabilityService`.
- **PR D — Sandbox runtime (3b):** sandboxed script execution + execution guardrails +
  artifact storage/download.
- **PR E — Web UI:** tool-step timeline, artifact chips/download, run history, model-gate
  messaging.
- **PR F — Full SKILL.md package import + polish:** scripts + resources package format,
  cancel/resume, limits tuning.

## 10. Commit plan (ordered; commit + push each, build/lint green before next)

> Mirrors the #2 branch discipline: small, self-contained commits, `pnpm build` +
> `pnpm lint` + `pnpm --filter api test` green at each step. Conventional-commit
> prefixes. Branch: `feat/skills-executable` (per sub-PR, or one long-lived branch with
> these commits grouped by the PRs above).

**PR A — Foundation**
1. `feat(db): skill_runs + skill_run_steps + skill_artifacts schema + migration`
2. `feat(skills): accept source='executable' (validation + types)`
3. `feat(skills): structured SKILL.md script/resource extraction (extend parser, keep backward-compat)`
4. `test(skills): parser structured-extraction + executable-source validation`

**PR B — Agent loop (3a, Anthropic-native, existing tools only)**
5. `feat(integrations): provider tool-calling abstraction (streamWithTools) + Anthropic impl`
6. `feat(skills): ToolRegistry (kc_search, web_search, read_attached_file) with JSON schemas + guarded handlers`
7. `feat(skills): SkillExecutionService agent loop (step/iteration/token caps, fail-closed)`
8. `feat(skills): POST /skills/:id/run SSE endpoint + run persistence`
9. `test(skills): agent loop (tool dispatch, cap enforcement, no-tool short-circuit) with a stub provider`

**PR C — Billing + observability**
10. `feat(observability): turnId correlation for multi-call turns (recordLLMCall + rollup)`
11. `feat(skills): per-upstream-call budget gating across the loop`
12. `test(skills): multi-call turn aggregates spend + re-gates each call`

**PR D — Sandbox (3b)**
13. `feat(skills): sandbox runtime interface + first implementation (no network, resource caps)`
14. `feat(skills): skill_artifacts storage + GET /artifacts/:id/download (owner-only)`
15. `feat(guardrails): execution guardrails for sandboxed skills`
16. `test(skills): sandbox limits (timeout/mem/output cap) + artifact authz`

**PR E — Web UI**
17. `feat(web): skill-run SSE client + tool-step timeline component`
18. `feat(web): artifact chips + download + run history`
19. `feat(web): gate "Run skill" to Anthropic-native models + unavailable messaging + i18n (en/sl)`

**PR F — Package format + polish**
20. `feat(skills): full SKILL.md package import (scripts + resources)`
21. `feat(skills): cancel running execution (DELETE /skills/runs/active)`
22. `chore(skills): limits/config tuning + docs`

## 11. Acceptance criteria (from issue #216)

- [ ] **Agent loop + safe execution** — PR B (loop) + PR D (sandbox).
- [ ] **Multi-call billing + observability** — PR C.
- [ ] **Execution guardrails** — PR D.
- [ ] **UI for run + artifacts (download generated `.xlsx`)** — PR E.
- [ ] **SKILL.md with script sections (re-parse, no format break)** — PR A + PR F.

## 12. Risks / open questions

- **Sandbox choice** (Anthropic code-exec vs self-hosted container/WASM) — biggest
  unknown; PR D can start behind an interface so the choice isn't load-bearing earlier.
- **Provider lock-in** — v1 is Anthropic-only; document the model-gate clearly so users
  aren't surprised when a skill won't run on a non-Anthropic model.
- **Cost blow-ups** — hard caps (iterations, tokens, wall-clock) + per-call budget gates
  are non-negotiable; surface estimated cost before a run if feasible.
- **JSONB vs tables** for scripts/steps — decide in PR A/C; lean tables for steps
  (queryable observability), JSONB for small script bodies.
