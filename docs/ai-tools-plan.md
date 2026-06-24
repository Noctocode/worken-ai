# AI Tools (Plugins — AI-callable external APIs)

## Goal

Let **company admins** register **tools** (plugins) that wrap an external HTTP API,
so the **AI can call them itself during chat** (function calling). Canonical first
example: a **weather** tool — a user asks *"What's the weather in Paris?"*, the model
calls `get_weather({ city: "Paris" })`, the backend performs the HTTP request, hands
the result back to the model, and the model answers in natural language.

Decisions locked in (from scoping):
- **Nature:** AI-callable tool (function calling), not a manual/data-only integration.
- **Ownership:** company/admin-configured, like the **Models** and **Integration**
  tabs — keys encrypted with the existing `EncryptionService`.
- **This doc is the deliverable for step 1.** No production code yet — design first,
  then implement in phases after sign-off.

Out of scope for v1 (deferred, noted in [Later](#later--explicit-non-goals-for-v1)):
- Per-user tools, marketplace, OAuth-based tools, arbitrary scripting/sandbox
  (that's the **executable skills / Option #3** track — separate feature).
- Embedding-based tool routing (offer *all* enabled tools in v1; route later).

---

## How it fits the existing architecture

Three existing systems give us most of the machinery; the **one genuinely new piece
is a tool-call loop in chat** (today chat is single-turn, no `tool_calls`).

| Reuse | Where | What we borrow |
|---|---|---|
| **Encrypted credentials + company scoping + monthly limits** | `integrations` table (`packages/database/src/schema/index.ts:1175`), `IntegrationsService`, `EncryptionService` (AES-256-GCM, `v1:` prefix) | Store each tool's API key encrypted; admin-gated CRUD; optional per-tool monthly call cap; company-wide consistency. |
| **Visibility / scoping** | `skills` table + link tables (`schema:951`), `SkillRouterService.getAccessibleSkills()` | `all` / `admins` / `teams` / `projects` visibility, mirrored for tools. |
| **Provider-aware transport** | `ChatTransportService.resolve()` (`apps/api/src/integrations/chat-transport.service.ts`) | Decide whether the resolved model/route **supports tool calling**; disable tools otherwise. |
| **Chat stream (extension point)** | `ChatService.sendMessageStream()` (`apps/api/src/chat/chat.service.ts:148`), `chat.controller.ts` `@Post('stream')` | Add a `tools` array to the request + a dispatch loop on `tool_calls` / `tool_use`. |
| **Admin tab UI + company consistency** | `apps/web/.../management/integration-tab.tsx`, Models tab, `teams/page.tsx` PageTabs | New **Tools** tab; admin-only mutation; basic users read-only. |

**Company-wide consistency rule applies** (same as Models + Integration keys): the
Tools tab must be identical across every account in one company; only basic users get
mutation disabled. (See repo memory `company-wide-consistency`.)

---

## Data model (Drizzle — `packages/database/src/schema/index.ts`)

### `ai_tools`
One row per registered tool, company-scoped.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → companies | tenant isolation (mirror integrations) |
| `created_by` | uuid FK → users | audit |
| `name` | text | LLM-facing function name, e.g. `get_weather`; unique per company; `^[a-z0-9_]{1,48}$` |
| `display_name` | text | UI label, e.g. "Weather" |
| `description` | text | LLM routing hint — *when* to call it |
| `input_schema` | jsonb | JSON Schema for the parameters the model fills |
| `http_method` | text | `GET` / `POST` |
| `url_template` | text | e.g. `https://api.weather.example/v1/current?q={{city}}` |
| `headers_template` | jsonb | static + `{{param}}` / `{{secret}}` placeholders |
| `query_template` | jsonb | for GET params not in the URL |
| `body_template` | jsonb | for POST; `{{param}}` placeholders |
| `auth_type` | text | `none` / `api_key_query` / `api_key_header` / `bearer` |
| `auth_param_name` | text | header/query name for the key (e.g. `appid`, `X-API-Key`) |
| `api_key_encrypted` | text | AES-256-GCM via `EncryptionService`; nullable |
| `response_path` | text | optional JSONPath-ish to trim the response before returning to the model |
| `visibility` | text | `all` / `admins` / `teams` / `projects` (mirror skills) |
| `is_enabled` | boolean | |
| `monthly_call_limit` | int | null = unlimited, 0 = paused, >0 = enforced (mirror integrations limit semantics) |
| `timeout_ms` | int | default 8000, capped |
| `created_at` / `updated_at` | timestamptz | |

Link tables `ai_tool_teams` / `ai_tool_projects` for `teams`/`projects` visibility
(copy the `skill_teams` / `skill_projects` shape verbatim).

### `ai_tool_executions` (audit + usage)
`id`, `tool_id`, `company_id`, `user_id`, `conversation_id`, `arguments` (jsonb,
redacted of secrets), `status` (`ok`/`error`/`blocked`/`timeout`), `http_status`,
`latency_ms`, `created_at`. Powers the monthly cap + an admin usage view.

Migration via `pnpm db:generate` + `pnpm db:migrate` (remember the dist-rebuild
gotcha: `pnpm --filter @worken/database build` + API restart locally — repo memory
`database-dist-rebuild`).

---

## API (NestJS — new `apps/api/src/tools/`)

Mirror the `integrations` module layout.

- **`tools.controller.ts`** — admin-gated CRUD (`GET/POST/PATCH/DELETE /tools`), plus
  `POST /tools/:id/test` (dry-run with sample args, returns the raw + trimmed response
  so the admin can validate config before enabling). `@UseGuards(JwtOrApiKeyGuard)`,
  `user.role === 'admin'` for mutations; reads allowed for the company.
- **`tools.service.ts`** — CRUD, encrypt/decrypt the key, company scoping, validation
  (valid JSON Schema, URL host allowed, name regex, limit semantics).
- **`tool-registry.service.ts`** — `listCallableFor(user, conversation)` → the enabled,
  accessible tools rendered as **provider function definitions** (`{ name, description,
  parameters: input_schema }`). v1 returns *all* enabled+visible tools (bounded);
  embedding routing is a later optimization.
- **`tool-executor.service.ts`** — the core. Given `(tool, argsFromModel)`:
  1. **Validate** args against `input_schema` (ajv) — reject on mismatch.
  2. **Build** the HTTP request from the templates, interpolating args + the decrypted
     secret (secret only into header/query/body, never logged).
  3. **SSRF guard** (see Security) → `fetch` with `timeout_ms`, no redirects to private
     hosts, response size cap.
  4. **Trim** via `response_path`, truncate to a token budget, return a normalized
     `{ ok, status, data | error }`.
  5. Write an `ai_tool_executions` row; enforce `monthly_call_limit`.

Reuses: `EncryptionService`, the admin-role gate, company-scoping query pattern.

---

## The new piece: chat tool-call loop

Today `ChatService.sendMessageStream()` is single-turn and `ChatStreamEvent` has no
tool events. v1 adds an **agentic loop** around the existing call:

1. Controller resolves callable tools via `ToolRegistryService`. If the resolved
   route/model **doesn't support tool calling** (decided from `ChatTransportService` +
   a model capability flag), skip tools entirely — behaviour is unchanged.
2. Pass `tools` (function defs) into the provider request:
   - **OpenAI-SDK route** (OpenRouter/custom/Azure): `tools` + `tool_choice:auto`.
   - **Anthropic-SDK route**: `tools` in the native `tool_use` shape (adapter already
     normalizes events in `anthropic-client.service.ts`).
3. Stream: detect `tool_call` / `tool_use` deltas. Emit **new SSE events**
   (`tool_call`, `tool_result`) so the UI can show *"Calling weather…"*.
4. On a tool call: run `ToolExecutorService`, append an assistant `tool_calls` message
   + a `tool` result message, then **call the model again**. Repeat until the model
   returns a normal answer or we hit **`MAX_TOOL_ITERS` (e.g. 5)**.
5. **Budget/limit guards each iteration** (reuse `assertManagedBudgetApproved` /
   token-reservation pattern) so a tool loop can't run away on cost.
6. Persist tool calls/results in the conversation for transcript fidelity; run tool
   output through **output guardrails** like any other model-visible content.

This is the largest and riskiest change; it gets its own phase + tests.

---

## Web UI (`apps/web`)

- **New "Tools" tab** in Settings/Management next to Models / Integration / Guardrails
  (PageTabs in `teams/page.tsx`). Admin-only mutation; **company-wide consistent**;
  basic users read-only (disabled controls, same as Models).
- **List + add/edit dialog**: display name, `name`, description, parameter schema
  (raw-JSON editor in v1; visual builder later), HTTP method/URL/headers, auth type +
  **API key** (write-only, shows "key set"), visibility, enable, monthly cap. A **Test**
  button calls `POST /tools/:id/test`.
- **lib/api.ts** hooks: `fetchTools`, `upsertTool`, `updateTool`, `deleteTool`,
  `testTool`; react-query + `invalidateQueries`.
- **i18n**: new `tools` namespace in `lib/translations/{en,sl}/…`. Only translate
  user-facing copy (not `console.*` / thrown Errors — repo memory `i18n-console-errors`).
  Never expose provider plumbing names in UI (repo memory `no-openrouter-in-ui`).
- **Chat**: render `tool_call` / `tool_result` SSE events as a compact inline step
  ("Called Weather → 14°C, clear") — small polish, can land in the chat phase.

---

## The weather example (validation target)

Createable entirely through the admin UI, no special-casing:

```
display_name: Weather
name:         get_weather
description:  Get the current weather for a city. Use when the user asks about
              weather, temperature, or conditions in a place.
input_schema: { type: object, required: [city],
                properties: { city: { type: string },
                              units: { type: string, enum: [metric, imperial] } } }
http_method:  GET
url_template: https://api.openweathermap.org/data/2.5/weather?q={{city}}&units={{units}}
auth_type:    api_key_query
auth_param:   appid
api_key:      <admin pastes their key>     # stored encrypted
response_path: $.main, $.weather[0].description   # trim before returning to the model
```

Phase C wires it end-to-end: ask in chat → model calls `get_weather` → answer.

---

## Security / safety (must-haves, not polish)

- **SSRF guard** in `ToolExecutorService`: HTTPS only; resolve host and **block
  private / loopback / link-local / metadata ranges** (10/8, 172.16/12, 192.168/16,
  127/8, 169.254/16, `::1`, fc00::/7); no redirect-following to private hosts; optional
  per-company **host allowlist**.
- **Schema-validate** model-supplied args before building the request.
- **Secret isolation**: decrypted key only flows into the outbound request; never
  logged, never written to `ai_tool_executions.arguments`, never returned to the model.
- **Caps**: `timeout_ms`, response size limit, `MAX_TOOL_ITERS`, `monthly_call_limit`,
  and the existing budget/token gates per loop iteration.
- **Prompt-injection awareness**: tool responses are untrusted text → keep them in a
  clearly-delimited tool-result block and pass through output guardrails.

---

## Phasing (each = its own PR)

- **Phase A — Data + admin CRUD (no chat wiring).** `ai_tools` (+ link/exec tables) +
  migration; Tools module CRUD + encryption + validation; web Tools tab (list/add/edit)
  + i18n. A weather tool can be created and saved. *Shippable, inert.*
- **Phase B — Executor + Test.** `ToolExecutorService` (schema validation, request
  templating, SSRF guard, timeout, trimming) + `POST /tools/:id/test` + Test button.
  Admin can dry-run weather and see a real response. No model involvement yet.
- **Phase C — Chat tool-loop.** Capability gating, `tools` in the provider request,
  `tool_call`/`tool_result` SSE events, the dispatch loop with `MAX_TOOL_ITERS` +
  budget guards, persistence, output guardrails. **Weather works end-to-end in chat.**
- **Phase D — Polish.** Inline tool-call UI in chat, admin usage view from
  `ai_tool_executions`, monthly cap enforcement UI, embedding-based tool routing when
  N grows, tests across providers.

Tests each phase: service unit tests (validation, SSRF guard, executor), and a
provider matrix smoke for the loop (OpenAI-SDK route first; Anthropic next).

---

## Decisions (locked — confirmed before Phase A)

1. **Provider coverage:** support tool calling on the **OpenAI-SDK route first**
   (OpenRouter / custom / Azure), then the **Anthropic** native `tool_use` path in the
   same Phase C. Models that don't support tools → tools are **silently not offered**
   (chat behaves exactly as today). Each model carries a "supports tools" capability flag.
2. **Architecture:** **constrained-generic HTTP tool** — one generic admin-defined
   request (templates) behind strong guardrails (HTTPS-only, private-IP/SSRF block,
   optional host allowlist, schema validation, timeouts). No per-service hand-written
   connectors.
3. **UI name:** **"Tools"** (avoids clashing with the existing BYOK "Integration" tab).
4. **Entity name in code/DB:** **`ai_tools`** (aligned with the "Tools" UI + tool-calling
   concept).

---

## Later — explicit non-goals for v1

- Per-user tools / marketplace / sharing across companies.
- OAuth-authenticated tools (only static API keys in v1).
- Visual JSON-Schema builder (raw JSON in v1).
- Embedding-based tool selection (offer all enabled tools in v1).
- Arbitrary code execution / sandbox (that's the executable-skills track).

---

## PR-body template (for the eventual Phase A PR)

> ## Pregled
> Uvede **AI Tools** — company-admin nastavljive plugine, ki ovijejo zunanji HTTP API,
> da jih lahko AI sam pokliče med klepetom (function calling). Prvi primer: **weather**.
> Ta PR je **Faza A**: podatkovni model + admin CRUD + UI tab; brez chat povezave (inertno).
>
> ## Spremembe
> - DB: `ai_tools` (+ `ai_tool_teams/projects`, `ai_tool_executions`) + migracija.
> - API: `tools` modul (CRUD, šifriranje ključa, validacija, admin-gated).
> - Web: nov **Tools** tab (admin-only mutacija, company-wide konsistentno) + i18n.
>
> ## Preverjeno
> - build / lint / tests zeleno; weather tool se ustvari in shrani.
>
> ## Tests (ročno)
> - [ ] Admin ustvari weather tool, ključ shranjen (prikaže "key set", ne razkrije).
> - [ ] Basic user vidi tab read-only (brez mutacij).
> - [ ] Drug račun istega podjetja vidi identičen seznam (company-wide consistency).
