# Skills (Option #2 — Auto-selected instructional skills)

## Goal

Let users author reusable **instructional skills** — Markdown "how we do X here"
recipes (e.g. "how we write client proposals") — that the system **auto-selects**
per chat turn via progressive disclosure and injects into the model's context.
No manual picking, no executable scripts, no sandbox.

This is provider-agnostic: it rides the existing `context` → system-message path,
so it works on every route (OpenRouter / BYOK / Custom / Azure / Anthropic) with
zero changes to `ChatTransportService`.

Scope explicitly **excludes** (deferred to later phases):
- **Executable scripts / sandbox / agent loop (Option #3)** — this is a separate,
  much larger follow-up PR. **Not implemented here.** See
  [Follow-up: Option #3](#follow-up-option-3--executable-skills-separate-large-pr--not-in-this-pr)
  below, and the PR-body template at the end of this doc.
- Manual skill selection UI in the composer (Option #1) — though the data model
  below supports adding it cheaply later.

---

## How it fits the existing architecture

The chat stream assembles `contextChunks[]` (RAG docs, attached files, KC chunks)
and joins them into a single `context` string
(`apps/api/src/chat/chat.controller.ts:226-280`). That string becomes a `system`
message (`apps/api/src/chat/chat.service.ts:175-183`, and the Anthropic adapter's
`context` arg).

**Skills plug in here**: after the existing context is assembled, a new
`SkillRouterService` picks 0–N relevant skills and appends their instructions as a
clearly-delimited block. One extra entry in `contextChunks` (or its own system
message) — nothing downstream changes.

Visibility/scoping mirrors `knowledge_files` exactly (personal vs company, and
within company: `all` / `admins` / `teams` via a link table), so org-provisioning
through Teams/Company admin comes for free.

---

## Phase 0 — Embedding verification (CONFIRMED in code)

Verified before writing the schema (the cosine-similarity blocker):

- **Model:** `Xenova/all-MiniLM-L6-v2`, run **locally in-process** via
  `@huggingface/transformers` (`apps/api/src/documents/documents.service.ts:34-42`),
  `pooling: 'mean', normalize: true`.
- **Dimension:** **384** (`knowledge_chunks.embedding` and `documents.embedding` are
  both `vector(384)`, schema lines 288 / 544).
- **Entry point:** `DocumentsService.embed(texts: string[]): Promise<number[][]>`
  (`documents.service.ts:109`). KC + project RAG both go through it
  (`knowledge-ingestion.service.ts:574`, `documents.service.ts:241`).

**Consequences for the plan (the gaps you flagged, resolved with what's in the repo):**

1. **Same model, not just same dim.** Skill descriptions are embedded by calling the
   **same `DocumentsService.embed()`** — identical model + space — so cosine between a
   message vector and a skill-description vector is meaningful. The schema column is
   `vector("description_embedding", { dimensions: 384 })`.
2. **"Reuse the RAG vector" — refined.** The message **is** embedded on every turn today:
   `searchAccessibleChunks` runs *unconditionally* (chat `chat.controller.ts:258`, arena
   `compare-models.controller.ts:286`) and embeds the query internally
   (`knowledge-ingestion.service.ts:574`) — even with no KC attached, the SQL just
   returns 0 rows. BUT that vector is **local to the method, not reused**. Two facts make
   this cheap to fix:
   - The embedder is **local/in-process — no network, no per-token billing.** A second
     `embed()` call costs a few ms of CPU, **not money.** So "not free" here means
     latency, not spend.
   - **Recommended small refactor:** hoist the single `embed()` call into the controller,
     pass the resulting vector into both `searchAccessibleChunks` (add an optional
     `queryEmbedding` param) and `SkillRouterService.selectForMessage`. → exactly **one
     embed per turn**, no duplication, no new cost. If we skip the refactor, the router
     just calls `embed()` itself — still local, still cheap.
3. **Async-embedding resilience (mirror KC ingest).** Skill create/update must **not
   block** on the embed call. Embed asynchronously / backfill (like the KC chunk
   pipeline), and the router **skips skills with `description_embedding IS NULL`** rather
   than crashing — they become routable once embedded.
4. **Small N → no ANN index.** A user sees a handful of skills, not millions. **No
   ivfflat/hnsw** on `description_embedding`; pull the accessible set and cosine-rank in
   memory (or a plain `ORDER BY`). The only indexes needed are for the accessible-filter:
   `skills(scope, visibility)`, `skill_teams(skill_id)`, `skill_teams(team_id)`.

---

## Two-stage progressive disclosure (the only genuinely new mechanism)

The point of skills vs. just stuffing everything into the system prompt: with N
skills we must **not** inject all of them. Two stages:

**Stage 1 — Catalog + select (cheap).** Gather the skills the user can see, build a
catalog of `name + description` only, and choose which apply to the current message.

**Stage 2 — Inject (full).** For the selected skill ids, pull the full
`instructions` body and inject it.

### Selection strategy — recommended: embedding prefilter, optional LLM confirm

We already run pgvector + an embedding pipeline for KC chunks, so reuse it:

1. On skill create/update, embed `name + "\n" + description` → store
   `description_embedding vector(N)` on the skill row (same model/dim as KC chunks).
2. At chat time, embed the user message (already done for RAG — reuse that vector),
   cosine-rank accessible skills, take top-K above a threshold `T`.
3. Take top-K above a **conservative** threshold (K small, e.g. ≤2).
4. **LLM-confirm is default-ON, not optional.** A single cheap classifier call (smallest
   catalog model) over just the top-K candidates' descriptions returns the subset that
   *truly* applies. Rationale (your point): **a false positive is the costlier error** —
   a wrongly-injected skill silently rewrites the answer in the wrong style and the user
   has no idea why. So the confirm step is the default guard, conservative threshold, and
   the "Skill applied" chip stays prominent. It runs only when ≥1 candidate clears the
   threshold, so quiet turns still cost nothing.

Why not LLM-classify the whole catalog every turn: cost + latency scale with skill
count. Embedding prefilter keeps it O(1) at chat time.

**Guards (avoid silent cost/latency creep):**
- Skip the whole router when the user has 0 accessible skills (common case → no-op).
- Cap injected skills (`MAX_ACTIVE_SKILLS`, e.g. 2) and total injected chars
  (`MAX_SKILL_CHARS`) — log when truncated.
- **Pin vs cap precedence:** pinned skills are **always** included; `MAX_ACTIVE_SKILLS`
  bounds only the *auto-selected* set (pins don't eat the cap).
- Cache the per-user accessible-skill catalog (id/name/description/embedding) briefly
  to avoid a query every turn.

### Sticky vs per-message selection (DECISION)

`selectForMessage` runs on every message, but procedural skills must not flicker: a
"how we write proposals" skill might trigger on message 1, then fall under the threshold
on message 3 — and the model "forgets" the format mid-task.

**Decision: sticky per conversation.** Once a skill is auto-selected (or pinned) in a
conversation, it stays active for the rest of that conversation until the user unpins /
clears it. Implementation: persist active skill ids per conversation (a
`conversation_skills` link table, or `conversations.metadata.activeSkills`). Each turn =
union of (already-sticky for this conversation) + (newly cleared the threshold this
turn) + (pinned), then de-dup and apply the cap (pins/sticky first).

**Arena is exempt** — a comparison is a single stateless question with no conversation
thread, so per-question selection is correct there (compute once, see Phase 2).

---

## Phase 1 — Data model

New table `skills` in `packages/database/src/schema/index.ts` (mirrors `prompts`
for ownership + `knowledge_files` for scope/visibility):

```ts
export const skills = pgTable("skills", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),                 // short, e.g. "Client proposal"
  description: text("description").notNull(),    // ROUTING TRIGGER — "use when…"
  instructions: text("instructions").notNull(),  // the SKILL.md body (injected)
  // Same semantics as knowledge_files.scope / visibility.
  scope: text("scope").notNull().default("personal"),       // personal | company
  visibility: text("visibility").notNull().default("all"),  // all | admins | teams
  isActive: boolean("is_active").notNull().default(true),
  source: text("source").notNull().default("manual"),       // manual | import
  // pgvector embedding of name+description for the Stage-1 prefilter.
  // Dim 384 = Xenova/all-MiniLM-L6-v2 (Phase 0). NULLABLE: filled async
  // after create (like KC ingest) — router skips rows where it's null.
  descriptionEmbedding: vector("description_embedding", { dimensions: 384 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Accessible-filter probe (NOT a vector index — small N, cosine in memory).
  index("skills_scope_visibility_idx").on(table.scope, table.visibility),
]);

// Team gating for visibility='teams' — mirrors knowledge_file_teams.
// Index both directions: by skill (render a skill's teams) and by team
// (the accessible-filter EXISTS probe).
export const skillTeams = pgTable("skill_teams", { ... skillId, teamId ... },
  (t) => [index("skill_teams_skill_idx").on(t.skillId),
          index("skill_teams_team_idx").on(t.teamId)]);
```

- **No ivfflat/hnsw on `description_embedding`** — small N, cosine-rank in memory.
- `pnpm db:generate` → `pnpm db:migrate`.
- **Gotcha (from memory):** rebuild `@worken/database` (`pnpm --filter @worken/database build`)
  and restart the API, or Drizzle silently drops the new columns locally.

Embeddings via the **same** `DocumentsService.embed()` (Phase 0) — never a different
model. Compute on create/update **asynchronously** (don't block the write); the router
tolerates `description_embedding IS NULL`.

---

## Phase 2 — API

New `skills` module under `apps/api/src/skills/`:

- `skills.controller.ts` — CRUD, mirroring `prompts.controller.ts`:
  `GET /skills`, `GET /skills/:id`, `POST`, `PATCH`, `DELETE`.
  Plus `PATCH /skills/:id/visibility` (mirror `knowledge-core` visibility patch).
  On create/update, (re)compute `descriptionEmbedding`.
- `skill-router.service.ts` — the two-stage selector:
  - `getAccessibleSkills(userId, teamId)` — scope/visibility filter (lift the
    predicate logic from KC's accessible-chunk query).
  - `selectForMessage(userId, teamId, messageVector | messageText)` → `Skill[]`
    (embedding rank → top-K → optional LLM confirm → cap).
  - `renderContextBlock(skills)` → a delimited string for `contextChunks`.
- `skills.module.ts` — exports `SkillRouterService`; imports DB + embedding service.
- `skill-md.parser.ts` — parse agentskills.io `SKILL.md` (YAML frontmatter
  `name`/`description` + Markdown body) for import; used by an import endpoint and
  future partner-skill ingestion.

**Wire into chat** (`apps/api/src/chat/chat.controller.ts`, ~line 279, just before
`const context = …`):

```ts
const activeSkills = await this.skillRouter.selectForMessage(
  user.id, teamId, safePrompt,           // reuse the RAG query vector if available
  body.pinnedSkillIds,                   // optional: force-include (composer "pin")
);
if (activeSkills.length > 0) {
  contextChunks.unshift(this.skillRouter.renderContextBlock(activeSkills));
}
```

`pinnedSkillIds` is an optional field on the chat/arena request body, set when the user
pins a skill in the composer `SkillsDialog`. The router force-includes pinned ids
(bypassing the embedding threshold) and auto-selects the rest.

**Skills apply in both chat and Model Arena** (per product decision). The arena backend
(`apps/api/src/compare-models/compare-models.controller.ts`) already builds
`composedContext` **once** (line ~297) and fans it out to every model panel
(`Promise.allSettled`). So inject skills **once** there — append
`renderContextBlock(activeSkills)` to `composedContext` before the fan-out — and all
panels get the identical block. Apples-to-apples is automatic; do **not** compute
per-panel.

**One embed per turn (Phase 0 refactor).** Both `chat.controller.ts:258` and
`compare-models.controller.ts:286` call `searchAccessibleChunks`, which embeds the query
internally. Hoist that single `embed()` to the controller and pass the vector into both
`searchAccessibleChunks` (new optional `queryEmbedding` param) and `selectForMessage`, so
adding skills doesn't add a second embed. Embedding is local/in-process, so even if we
don't refactor, the cost is CPU-only — but the refactor is clean and cheap.

**Observability:** if the optional LLM-confirm call runs, record it via
`ObservabilityService.recordLLMCall({ eventType: 'skill_routing', … })` so the extra
call is visible and billable — keeps the "multi-call accounting" honest even at this
small scale. Also stamp applied skill ids into the assistant message `metadata`
(`metadata.skills = [...]`) for transparency + the chat indicator.

---

## Phase 3 — Web UI

Skills live in the **Resources hub** (`/resources`), alongside Prompt Library,
Prompt Builder, Prompt Improver, Shortcuts, Learn Academy, How It Works. This is the
agreed placement and also resolves the UX-overlap question (Risk #1): the card copy
must state the differentiator vs. its neighbours (auto-selected procedural "how-to",
not a user-picked template or always-on facts).

- **Resources hub card** — add a `Skills` entry to `RESOURCE_CARDS` in
  `apps/web/src/app/(app)/resources/page.tsx`, `href: "/resources/skills"`, with an
  icon (e.g. `Sparkles`/`BookOpen` from lucide), bullets, and a `CARD_DESCRIPTIONS`
  entry. Mirror the existing Shortcuts card shape exactly.
- **Management page** — new route `apps/web/src/app/(app)/resources/skills/page.tsx`
  (mirror `resources/shortcuts/page.tsx`): list / create / edit / delete skills, with
  `name`, `description` ("use this when…"), and `instructions` (Markdown) editor.
  Company users additionally get the scope/visibility controls (reuse the KC
  visibility picker component).
- **Import**: upload/paste a `SKILL.md` → parsed into the form.
- **Chat indicator**: a small chip on the assistant turn — "Skill applied: Client
  proposal" — read from `metadata.skills`. Makes auto-selection legible (otherwise
  users won't trust/understand why output changed).
- **i18n:** add `resources.skills*` keys to both `en/resources.ts` and
  `sl/resources.ts`. Translate user-facing UI strings only — not `console.*` or
  `throw new Error` fallbacks (per project convention).

### Composer surfaces — next to Prompt Library (Project Details, Ask-me-anything, Model Arena)

Skills get an entry point **right beside the existing "Prompt Library" pill** in every
composer:

- **Project Details / Ask-me-anything chat** — `apps/web/src/components/project-chat/chat-composer.tsx`.
  The pill row currently holds `[Attach File] [Prompt Library]`
  (`PromptLibraryDialog` at line ~202). Add a `[Skills]` `ComposerPill` next to it that
  opens a `SkillsDialog`.
- **Model Arena** — `apps/web/src/app/(app)/compare-models/page.tsx`. The arena
  `Composer` has a `ComposerChip` "Prompt Library" (line ~1910, opened via
  `onOpenPromptLibrary` → `PromptLibraryDialog` at ~2639). Add a `[Skills]`
  `ComposerChip` next to it (`onOpenSkills` → `SkillsDialog`), and a link to
  `/resources/skills` like the existing arena prompt-library dialog footer (~2763).

**What the composer Skills entry point does — note the #2 nuance.** Because selection is
*automatic*, this dialog is primarily for **visibility + optional override**, not
mandatory picking:
- Browse/preview available skills (name, description) + a link to manage them at
  `/resources/skills`.
- Show which skills the router will/did auto-apply for the current message.
- **Optional**: let the user *pin* a skill for this conversation/turn (force-include),
  which is the cheap Option #1 manual-select affordance — the data model already
  supports it, so it's a small add on top of #2. If a pin is set, the router includes it
  regardless of the embedding score.

Build one shared `SkillsDialog` component and reuse it in both composers (mirror how
`PromptLibraryDialog` is shared today).

---

## Phase 4 — Tests

- `skill-router.service.spec.ts`: scope/visibility filtering (personal vs company,
  admins, teams), top-K + threshold, the 0-skill short-circuit, char/skill caps.
- `skill-md.parser.spec.ts`: frontmatter parsing, missing fields, malformed input.
- Controller e2e: CRUD + visibility patch authz (non-owner can't edit; admins-only
  skill hidden from non-admins).
- Chat integration: a turn whose message matches a skill description gets the
  instructions injected; a non-matching turn doesn't.

---

## Sequencing / commits (feature branch `feat/skills`)

1. `feat: add skills + skill_teams + conversation_skills schema + migration`
   (incl. `description_embedding vector(384)` nullable, accessible-filter indexes)
2. `feat: skills CRUD API + SKILL.md import + async description embedding`
   (embed via DocumentsService.embed(), backfill, null-tolerant)
3. `refactor: hoist query embed into chat/arena controllers (one embed per turn)`
   (optional `queryEmbedding` param on searchAccessibleChunks)
4. `feat: skill router (embedding select + LLM-confirm + sticky-per-conversation)`
5. `feat: wire skill router into chat stream + arena composedContext + observability`
6. `feat: skills in Resources hub (/resources card + /resources/skills page) + chat applied-skill indicator`
7. `feat: Skills composer entry point (shared SkillsDialog in project chat + arena, beside Prompt Library, with pin)`
8. `test: skill router (incl. sticky, threshold, null-embedding) + parser + authz coverage`

Each commit builds + lints green before the next (`pnpm build`, `pnpm lint`).

> Option #3 (executable skills) is **not** part of this branch — it is a separate
> follow-up PR. See the Follow-up section below and the PR-body template.

---

## Key risks / decisions to confirm

1. **UX overlap with Prompts / Shortcuts / Knowledge Core.** *(Placement decided:
   Skills sit in the Resources hub `/resources` next to Prompts/Shortcuts.)* The
   differentiator is *auto-selection* + *procedural "how-to"* (vs. Prompts =
   user-picked templates, KC = always-on factual knowledge). The hub card + page copy
   must make this explicit, or it reads as a fourth thing that does the same job.
2. **Selection accuracy — false positives are the costlier error.** *(Decided:
   LLM-confirm default-ON above a conservative threshold; prominent "Skill applied"
   chip.)* A wrongly-injected skill silently rewrites the answer's style.
3. **Latency/cost.** Embedding is **local/in-process ($0)**; the one added spend is the
   confirm call, gated behind the threshold so quiet turns pay nothing. One embed per
   turn via the Phase-0 hoist.
4. **Where skills apply.** *(Decided: project chat AND Model Arena.)* Arena injects once
   into `composedContext` → all panels identical.
5. **Sticky vs per-message.** *(Decided: sticky per conversation; arena per-question.)*
   Needs the active-skills store (`conversation_skills` or conversation metadata).
6. **Embedding model + dim + entry point.** *(CONFIRMED — Phase 0: Xenova/all-MiniLM-L6-v2,
   384-dim, `DocumentsService.embed()`.)* No longer a blocker.

---

## Follow-up: Option #3 — Executable skills (SEPARATE LARGE PR — NOT IN THIS PR)

> **Status: proposal only. Do NOT implement as part of the #2 PR.** This is a
> deliberately separate, much larger follow-up because it is a *new subsystem*, not a
> feature increment. It is recorded here so the direction is committed and the #2 data
> model stays forward-compatible with it.

**What it adds beyond #2.** A skill carries not just Markdown instructions but
**executable scripts/resources** that actually run — e.g. a "build Excel report" skill
that runs code which produces a real `.xlsx`. This requires capabilities WorkenAI does
not have today: an **agent loop** (model → tool call → execute → feed result back →
repeat) and a **sandbox** to run skill code safely.

**Why it can't be a small add-on (the cross-cutting touch-points).** Even isolated on
its own execution path, #3 unavoidably touches shared layers — these are the reason it
is a second PR:
1. **Multi-provider tool-calling** — the agent loop needs function/tool-calling, whose
   wire format differs per provider (OpenRouter ≠ Anthropic ≠ Azure). Touches the shared
   `ChatTransportService` / `integrations/` layer, and only works on models that support
   tool-calling well (part of the catalog drops out).
2. **Billing + observability** — one user turn becomes *several* upstream calls
   (model → tool → model …). `ObservabilityService` and the budget gates
   (`assertTeamBudgetNotExceeded`, etc.) must aggregate a multi-call turn, or billing is
   wrong.
3. **Guardrails + security** — running code is a new attack surface. The `guardrails`
   module must cover what a skill may execute (filesystem/network/resource limits);
   today's chat guardrails don't.
4. **Web UI** — needs new states ("running code…", intermediate tool steps, returned
   file artifacts) — net-new UI, not a tweak.

**Recommended shape when it is built.**
- **Anthropic-native first.** Implement on the Anthropic path only, where tool-calling +
  a code-execution sandbox come largely out of the box, avoiding the multi-provider
  tool-calling tangle for v1.
- **Opt-in, isolated path.** A dedicated `skill-execution` service/endpoint so the
  default chat stream (`chatStream`) is untouched and every other feature
  (compare-models, team chat, AI cron, tenders) keeps working unchanged.
- **Intermediate step before a full sandbox:** let executable skills call only
  *existing* WorkenAI tools (KC lookup, the OpenRouter web-search plugin already wired in
  `chat.controller.ts`) rather than arbitrary code. ~70% of the value, no sandbox.
- Adopt the full agentskills.io `SKILL.md` package format (scripts + resources), building
  on the #2 parser.

**Forward-compatibility carried by the #2 PR (so #3 doesn't require a migration churn):**
- `skills.source` already distinguishes `manual` vs `import`; add `executable` later.
- The `SKILL.md` parser ignores script/resource sections in #2 but should not choke on
  them — parse-and-preserve, don't reject.
- Keep `metadata.skills` on assistant messages so an executed-skill turn can later record
  tool steps in the same place.

**Rough sequencing for the #3 PR (when scheduled):** sandbox runtime → agent loop on the
Anthropic path → provider tool-calling abstraction in `ChatTransportService` →
multi-call billing/observability aggregation → guardrails for execution → UI for tool
steps + artifacts. Each is sizeable; expect this to be several PRs of its own, not one.

---

## PR body (template for the #2 PR)

When the #2 work is opened as a PR, the body **must** include the Option #3 follow-up
note below so reviewers know executable skills are intentionally out of scope and planned
separately:

```markdown
## Summary
Adds **Skills (Option #2)**: auto-selected *instructional* skills — Markdown "how we do
X" recipes that the system picks per chat turn via embedding-based progressive disclosure
and injects into context. Provider-agnostic (rides the existing context → system-message
path; no `ChatTransportService` changes).

## What's included
- `skills` schema + migration (scope/visibility mirror `knowledge_files`).
- Skills CRUD API + `SKILL.md` import.
- `SkillRouterService` (embedding select + context injection) wired into both the chat
  stream and the Model Arena (compare-models) send path.
- Skills in the **Resources hub** (`/resources` card + `/resources/skills` page) +
  "Skill applied" indicator in chat.
- Skills composer entry point (shared `SkillsDialog`) beside Prompt Library in Project
  Details / Ask-me-anything chat and in Model Arena, with optional per-conversation pin.
- Tests: router, parser, authz, chat integration.

## Explicitly NOT in this PR — follow-up: Option #3 (executable skills)
Executable skills (scripts that actually run, e.g. generate an `.xlsx`) require an agent
loop + sandbox and are a **separate, much larger follow-up PR** — a new subsystem, not an
increment. It will touch shared layers (multi-provider tool-calling, multi-call
billing/observability, guardrails for code execution, new UI states) and is planned
Anthropic-native first. See `docs/skills-plan.md` →
"Follow-up: Option #3". This PR keeps the data model forward-compatible with it (e.g.
`source` column, parse-and-preserve `SKILL.md` script sections).

## Plan
Full design + sequencing: `docs/skills-plan.md`.
```
