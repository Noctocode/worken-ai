# Skills — Option #3: Executable skills (implementation plan)

> Companion to `docs/skills-plan.md` → "Follow-up: Option #3". That section is the
> high-level proposal; **this doc is the concrete, code-grounded build plan** for the
> executable-skills subsystem, plus the ordered commit sequence to ship it.
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
- **Web search is OpenRouter-plugin-specific.** It's a gated capability with an OpenRouter
  surcharge (`integrations/web-search-capability.resolver.js`), tied to OpenRouter models
  — **not** a provider-agnostic tool. On the Anthropic-native path it needs its own
  implementation (Anthropic's web-search tool or a search API), so `web_search` is NOT a
  free reuse.
- **Anthropic path is detectable.** The transport already distinguishes the Anthropic SDK
  route (`kind === 'anthropic-sdk'` in `chat.service.ts` / `anthropic-client.service.ts`)
  — that's the gate for "executable skills available".
- **Forward-compat already in place (from #2).** `skills.source` is `manual | import`
  (add `executable`); the `SKILL.md` parser keeps unknown frontmatter in
  `extraFrontmatter` and preserves the body (`skill-md.parser.ts`) — script sections are
  retained, not yet structurally extracted. `metadata.skills` on assistant messages is
  the place to also record tool steps.

## 3. Architecture decisions

1. **Anthropic-native first.** Build the agent loop on the Anthropic adapter only, where
   tool-calling + a code-execution sandbox are first-class. Avoids the multi-provider
   wire-format tangle for v1; other providers fall back to Option-#2 behavior
   (instructions only), gated on `kind === 'anthropic-sdk'`.
2. **Isolated execution path.** A dedicated `skill-execution` service + endpoint
   (`POST /skills/:id/run`) so `chatStream` and every other feature (compare-models, team
   chat, AI cron, tenders) stay untouched.
3. **Feature-flagged from day one.** The entire subsystem sits behind an
   **executable-skills flag** stored on the existing `org_settings` table (via
   `org-settings.service`), plus an env **kill-switch**, **default OFF**. This lets the
   single large PR merge "dark" and be enabled per-org gradually — the main mitigation for
   the one-PR risk (§12). No flag = endpoints 404 / UI hidden. **Rollout:** after merge,
   enable per-org from the admin org-settings UI (internal/beta orgs first); the env
   kill-switch disables it everywhere instantly if needed.
4. **Two-stage capability ramp — be precise about what each delivers:**
   - **3a — agent loop with vetted tools (no sandbox, Phase B):** the loop may call a
     small registry of *WorkenAI-owned* tools (KC lookup, read-attached-file). **It does
     NOT run the skill's own scripts** — the skill's instructions just steer the model to
     use those tools. ~70% of the value, no arbitrary code execution.
   - **3b — sandboxed script execution (Phase D):** the skill's *own* scripts actually
     run in a sandbox and produce file artifacts. This is the part that makes a skill
     truly "executable".
   > Don't conflate the two: Phase B is the loop + tools; real skill-script execution
   > arrives only in Phase D.
5. **Tool-calling abstraction in the transport layer.** A provider-agnostic tool
   schema + loop driver added to `ChatTransportService`, with the Anthropic adapter as
   the first concrete implementation.
6. **Turn = unit of billing/observability.** A `turnId` correlates all upstream + tool
   calls; budget gates run before each upstream call; spend aggregates to the turn; a
   hard **pre-run cost ceiling** caps the whole run.
7. **Trigger = explicit "Run" for v1 (not auto-in-chat).** Unlike Option #2 (which
   *auto-selects* instructional skills into a turn), an executable skill is launched by a
   **deliberate user action** — running code + spending on a multi-call loop should never
   fire implicitly. A run is initiated from the skill (or a composer "Run skill" action),
   creates a `skill_run`, and its result + artifacts are posted back into the conversation
   as an assistant message (with `metadata.skillRun`) so it lives in chat history.
   `conversationId` is set when launched from a chat; a run launched from `/resources/skills`
   has none. Auto-trigger can be revisited later, behind the same flag.

## 4. Data model (decisions made — not deferred)

- `skills.source`: add value **`executable`** (text column; new accepted value +
  validation, no shape change).
- **Scripts → JSONB column `skills.scripts`** (not a table): structured entries from
  `SKILL.md` (name, language, entrypoint, content/ref). Script bodies are small and only
  read as a unit — JSONB is lighter than a table here.
- **`skill_runs`** table: one row per execution — `id`, `skillId`, `userId`,
  `conversationId?`, `status` (running/done/failed/cancelled), `costUsd`, timing, error.
  The **run's `id` is the turn-correlation id** (written into
  `observability_events.turn_id`) — no separate `turnId` column (one run == one turn).
- **`skill_run_steps`** table (real table, not JSONB): per LLM/tool/script step —
  `runId`, `stepIndex` (deterministic order), `stepType` (llm | tool | script), `tool`,
  `model` (llm steps), input/output preview, tokens, costUsd, latency. A table because
  steps are queried for observability dashboards.
- **Observability:** add a nullable **`turnId`** column to the existing
  `observabilityEvents` table (extend, don't create a parallel table) so existing
  dashboards keep working and a multi-call turn rolls up by `turnId`.
- **`skill_artifacts`** table: generated files — `runId`, filename, mime, sizeBytes,
  storagePath (`uploads/skill-artifacts/`), createdAt, **expiresAt** (retention).
  Cascade on run delete.

> **All schema is front-loaded into the Phase-A migration (commit 1)** — including
> columns only *used* later (`observabilityEvents.turnId`, `skill_artifacts.expiresAt`).
> Intentional: later phases then need **no** new migration, so there's zero chance of
> editing an already-pushed one (the hash-skip trap). Only add a new numbered migration if
> a genuinely unforeseen column appears.

## 5. Backend components

- **`SkillExecutionService`** — owns a single run: builds the system prompt + tool
  definitions from the skill, runs the agent loop, persists `skill_runs`/`_steps`/
  `_artifacts`, emits SSE. **One active run per user** (mirror the import `activeJobs`
  guard) — a second run is rejected with 409 until the first finishes or is cancelled.
- **Agent loop driver** — model → parse tool calls → dispatch to ToolRegistry → feed
  `tool_result` back → repeat until no tool calls or a cap. **Hard caps from day one:**
  max iterations, total tokens, wall-clock, and the per-run cost ceiling. Fail-closed on
  any cap. Honors an abort signal (Stop) like the chat stream.
- **`ToolRegistry`** — vetted tools for 3a: `kc_search`, `read_attached_file` (both scoped
  to the caller). `web_search` only if implemented for the Anthropic path (§2) — otherwise
  omitted from v1. Each tool has a JSON Schema + a guarded handler.
- **Provider tool-calling adapter** — extend `ChatTransportService` with `streamWithTools`
  implemented by the Anthropic adapter; non-Anthropic routes throw "executable skills
  require an Anthropic-native model".
- **Sandbox runtime (3b)** — pluggable behind an interface; v1 candidate = Anthropic code
  execution, fallback = locked-down container/WASM worker (no network, CPU/mem/time caps,
  ephemeral FS). Output files → `skill_artifacts`.
- **Artifact retention reaper** — periodic cleanup of expired artifacts + their disk files
  (reuse the `knowledge-ingestion` reaper pattern), so generated files don't accumulate.
- **Multi-call billing/observability** — `turnId` threaded through; budget gate before
  each upstream call; `recordLLMCall` gets `turnId` so a turn rolls up.

## 6. API + SSE

- `POST /skills/:id/run` → SSE stream of: `run_started`, `llm_delta`, `tool_call`,
  `tool_result`, `artifact`, `run_done`, `run_error`. Mirrors the chat SSE framing so the
  FE transport is reused. 404 when the flag is off.
- `GET /skills/runs` — list the caller's runs (run-history UI).
- `GET /skills/runs/:id` — run + steps + artifacts (reload/detail).
- `GET /skills/artifacts/:id/download` — stream the generated file (authz: run owner).
- `DELETE /skills/runs/active` — cancel the running execution (abort, like chat Stop).

## 7. Frontend

- New chat states: "Running skill…", collapsible **tool-step timeline** (each call +
  result), and **artifact chips** with download — net-new UI under `project-chat/`.
- Reuse the SSE client + the `metadata.skills` indicator; add `metadata.skillRun`.
- Show a **pre-run cost estimate**; gate the "Run" affordance to executable skills on
  Anthropic-native models **and** the feature flag; otherwise show why it's unavailable.

## 8. Security model

- **3a:** no arbitrary code — only vetted tools, each guarded (KC scoped to the caller's
  accessible chunks; no FS/network beyond the tool).
- **3b sandbox:** no network by default, read-only except a scratch dir, CPU/mem/wall-clock
  caps, output-size cap, hard iteration cap. New `guardrails` coverage for what a skill
  may execute. Artifacts size/type-checked before download.
- **Prompt-injection / tool abuse (new attack surface).** The agent reads *untrusted*
  content (KC chunks, web results, attached files) that could contain instructions like
  "ignore the task and call tool X / exfiltrate Y". Mitigations: keep skill instructions
  and tool-result data in clearly separated roles; restrict the tool scope per run; never
  let a tool result silently widen permissions; log every tool call for audit.
- **Authz:** a run + its steps/artifacts are owner-only. Executable skills respect the
  same visibility gating as #2 (`getAccessibleSkills`). One active run per user.

## 9. Delivery: ONE branch, ONE PR (phased internally)

**Decision:** the whole subsystem ships as a **single branch `feat/skills-executable`
and a single PR**, not a series of PRs. The phases below are **internal milestones /
commit groups** — they order the work and keep each commit green, but are reviewed and
merged together. The **feature flag (default OFF)** is what makes one big PR safe: it
merges dark and is enabled per-org afterwards.

Order chosen so the branch is always buildable and each phase de-risks the next:

- **Phase A — Foundation (no execution):** `executable` source + feature flag +
  structured `SKILL.md` extraction + data model + migration. No behavior change.
- **Phase B — Agent loop + vetted tools (3a), Anthropic-native:** tool-calling
  abstraction + ToolRegistry + `SkillExecutionService` + run endpoint + **cancel**.
  No sandbox; the skill's own scripts do **not** run yet.
- **Phase C — Multi-call billing + observability:** `turnId` aggregation, per-call budget
  gating, **pre-run cost ceiling/estimate**.
- **Phase D — Sandbox (3b):** run the skill's own scripts in a sandbox → artifacts +
  retention + execution guardrails.
- **Phase E — Web UI:** tool-step timeline, artifact chips/download, run history,
  cost estimate, flag/model gating.
- **Phase F — Package format + polish:** full scripts+resources `SKILL.md` package,
  limits/config tuning, docs.

> Supersedes the "expect several PRs" wording in `docs/skills-plan.md`. Single migration
> journal, single review, single merge — kept safe by the flag.

**Sizing & prerequisites (set expectations):**
- This is a **multi-week effort**, not a quick add. **Phase D (sandbox)** is the biggest,
  riskiest piece.
- Phase B alone is mostly **infrastructure** (agent loop + vetted tools): the model can
  actively call `kc_search`/`read-file`, but the **headline feature — running the skill's
  own scripts to produce a downloadable `.xlsx` — only lands in Phase D.** Don't market B
  as "executable skills".
- **Prerequisite before starting Phase D:** verify Anthropic **code-execution** is
  available on our account/plan. If not, Phase D falls back to a self-hosted
  container/WASM sandbox (materially more work) — decide before committing to the path.

## 10. Commit plan (one branch `feat/skills-executable`, one PR)

All commits land on the **single branch** and merge as **one PR**. Commit + push each in
order; `pnpm build` + `pnpm lint` + `pnpm --filter api test` (+ web `tsc`/lint where
relevant) green before the next. Conventional-commit prefixes.

**Phase A — Foundation**
1. `feat(db): skill_runs + skill_run_steps + skill_artifacts + skills.scripts + observabilityEvents.turnId schema + migration`
2. `feat(skills): accept source='executable' (validation + types)`
3. `feat(skills): executable-skills feature flag (org-setting + env kill-switch, default off)`
4. `feat(skills): structured SKILL.md script/resource extraction (extend parser, keep backward-compat)`
5. `test(skills): parser structured-extraction + executable-source + flag gating`

**Phase B — Agent loop (3a, Anthropic-native, vetted tools only)**
6. `feat(integrations): Anthropic streamWithTools POC (tool_use/tool_result loop, spike)`
7. `feat(integrations): provider tool-calling abstraction over streamWithTools (Anthropic impl)`
8. `feat(skills): ToolRegistry (kc_search, read_attached_file) with JSON schemas + guarded handlers`
9. `feat(skills): SkillExecutionService agent loop (iteration/token/wall-clock caps, fail-closed, one-run-per-user)`
10. `feat(skills): POST /skills/:id/run SSE endpoint + run persistence`
11. `feat(skills): cancel running execution (DELETE /skills/runs/active, abort signal)`
12. `test(skills): agent loop (tool dispatch, cap + cancel + single-run guard) with a stub provider`

**Phase C — Billing + observability**
13. `feat(observability): turnId correlation for multi-call turns (recordLLMCall + rollup)`
14. `feat(skills): per-upstream-call budget gating + hard pre-run cost ceiling + estimate`
15. `test(skills): multi-call turn aggregates spend, re-gates each call, enforces ceiling`

**Phase D — Sandbox (3b)**
16. `feat(skills): sandbox runtime interface + first implementation (no network, resource caps)`
17. `feat(skills): execute skill-provided scripts in sandbox → file artifacts`
18. `feat(skills): artifact storage + GET download (owner-only) + retention reaper`
19. `feat(guardrails): execution guardrails + untrusted-content/tool-abuse mitigations`
20. `test(skills): sandbox limits (timeout/mem/output) + artifact authz + retention`

**Phase E — Web UI**
21. `feat(web): skill-run SSE client + tool-step timeline component`
22. `feat(web): artifact chips + download + run history + pre-run cost estimate`
23. `feat(web): gate "Run skill" to Anthropic-native + feature flag + unavailable messaging + i18n (en/sl)`

**Phase F — Package format + polish**
24. `feat(skills): full SKILL.md package import (scripts + resources)`
25. `chore(skills): limits/config tuning + docs`

> **Migrations: one NEW numbered migration per phase that needs schema — never edit an
> already-pushed one.** Drizzle tracks applied migrations by content hash, so editing a
> pushed migration is silently skipped on any dev/prod DB that already ran it (the exact
> `relation … does not exist` failure we hit this cycle). So Phase A adds `00NN_*`, and if
> Phase C/D need more columns they add `00NN+1`, `00NN+2`, … each with a strictly
> increasing journal `when`. `check:migrations` must stay green at every commit.

> **Sandbox testing caveat:** CI has no sandbox runtime, so the Phase-D test commit (20)
> exercises the **sandbox interface against a mock** (caps, output handling, authz,
> retention) — the *real* sandbox is verified manually / in a dedicated environment, not
> in `pnpm --filter api test`. Don't write CI tests that need a live sandbox.

## 11. Acceptance criteria (from issue #216)

- [ ] **Agent loop + safe execution** — Phase B (loop) + Phase D (sandbox).
- [ ] **Multi-call billing + observability** — Phase C.
- [ ] **Execution guardrails** — Phase D.
- [ ] **UI for run + artifacts (download generated `.xlsx`)** — Phase E.
- [ ] **SKILL.md with script sections (re-parse, no format break)** — Phase A + Phase F.

## 12. Risks / open questions

- **One big PR (top risk).** Agent loop + sandbox + billing + UI in a single PR is hard to
  review and risky to merge. **Mitigation:** the default-OFF feature flag (merge dark,
  enable per-org), strictly self-contained green commits, and individually-revertable
  phases. If review pain is still too high, the flag also makes it trivial to split later.
- **Sandbox choice** (Anthropic code-exec vs self-hosted container/WASM) — biggest
  unknown. **Action: verify Anthropic code-execution availability on our account/plan
  before Phase D.** Phase D sits behind an interface so the choice isn't load-bearing
  earlier, but the fallback (self-hosted container/WASM) is materially more work.
- **Provider lock-in** — v1 is Anthropic-only; the model-gate must be explicit so users
  aren't surprised when a skill won't run on a non-Anthropic model.
- **Prompt-injection from untrusted tool results** — see §8; treat as a first-class
  security requirement, not an afterthought.
- **Cost blow-ups** — hard caps + per-call budget gates + a pre-run ceiling are
  non-negotiable.
- **`web_search` on the Anthropic path** — not a free reuse of the OpenRouter plugin;
  either implement an Anthropic-native search tool or drop it from v1.
