# ARSO Phase C — chat tool-loop (function calling)

Detailed plan for wiring the ARSO tools (Phase A data + Phase B definitions/
dispatch) into the chat so the model can **call them mid-conversation**. This is
the big, core-touching change; sub-phased to keep each step shippable + testable.

## Where we are

- **Phase A** — `ArsoService` fetches + normalizes weather / air / hydrology
  (cached, attributed). ✅
- **Phase B** — `ArsoToolsService.definitions()` (3 function schemas) +
  `dispatch(name, args)` + curated place→station resolution. ✅
- **Phase C** — make the chat actually call them. ← this doc.

## Current chat flow (grounded)

- `ChatService.sendMessageStream()` (`apps/api/src/chat/chat.service.ts:148`) is
  an **async generator** yielding a `ChatStreamEvent` union
  (`content` / `reasoning` / `usage` / `citations` / `error`, line 66). Two
  routes:
  - **openai-sdk** (OpenRouter / BYOK / Azure): builds `body` (system + messages),
    `chat.completions.create(body, {signal})`, iterates chunks (line 198-399).
  - **anthropic-sdk**: delegates to `AnthropicClientService.sendMessageStream()`
    (`anthropic-client.service.ts:162`). Tool use is **explicitly ignored today**
    (comment at line 126-127).
- `chat.controller.ts` orchestrates: pre-flight (conversation load, **input
  guardrail**, persist user msg, `chatTransport.resolve()`, **budget gates**, RAG)
  BEFORE SSE headers (`:87-105`), then `streamWithFallback()` (`:537`) wraps
  `sendMessageStream`, and the main loop (`:611`) maps each event to an SSE frame
  (+ incremental **output guardrail** on `content`, `:623`). Persistence +
  observability after.

**Key consequence:** the loop belongs **inside `ChatService.sendMessageStream`**.
If it lives there, the controller's resolve / budget / fallback / persistence
plumbing keeps working; the controller only learns **two new event types** and a
small gating decision. The model's tool round-trips stay invisible to the
controller except as new SSE events.

## Design

### 1. New stream events + options (`chat.service.ts`)
Extend `ChatStreamEvent`:
```ts
| { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown> }
| { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
```
Extend `StreamOptions`:
```ts
tools?: ChatTool[];                 // provider-agnostic defs (from ArsoToolsService)
runTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
maxToolIters?: number;             // default 5
```
`runTool` is **injected by the controller** (`= (n,a) => arsoTools.dispatch(n,a)`)
so `ChatService` stays decoupled from the ARSO module.

### 2. The loop (openai-sdk path)
Refactor the single completion into an inner helper, wrap in a loop:
```
let work = [...messages]; let iters = 0
while (true) {
  build body (+ tools mapped to OpenAI `tools:[{type:'function',function:{name,description,parameters}}]`,
              tool_choice:'auto')
  stream once:
    - accumulate tool_calls deltas by index (id, function.name, function.arguments
      arrive incrementally, like content)
    - keep yielding content/reasoning as today
  if finish_reason !== 'tool_calls' (or no tool_calls): break          // normal answer
  if ++iters > maxToolIters: yield a 'content' note + break            // safety cap
  for each accumulated call:
    yield {tool_call,…}; const out = await runTool(name,args); yield {tool_result,…}
    append to `work`: assistant msg with tool_calls + a 'tool' role msg {tool_call_id, content: JSON(out)}
  // loop: model now sees the tool output and writes the answer (or calls again)
}
```
Usage events: each iteration emits its own `usage`; the controller already sums
across the stream — verify it accumulates rather than overwrites (it stores the
last; we may need to **sum** usage across iterations for correct billing).

### 3. The loop (anthropic-sdk path)
More work — Anthropic uses **content blocks**: the model returns `tool_use`
blocks; we reply with a `user` message containing `tool_result` blocks. Extend
`AnthropicClientService.sendMessageStream` to (a) pass `tools` (native shape),
(b) surface `tool_use` blocks, (c) let the loop append `tool_result` and re-call.
Mapped onto the same `tool_call`/`tool_result` events so the controller is
identical for both routes.

### 4. Controller (`chat.controller.ts`)
- **Gate**: pass `tools` only when **(a)** the resolved model supports function
  calling AND **(b)** ARSO is enabled for the project/company. Model capability:
  a `supportsTools` flag (curated set / catalog field; default true for the
  openai-sdk route, true for anthropic-native, false otherwise). When tools
  aren't passed, behaviour is byte-for-byte unchanged.
- **Forward** `tool_call` / `tool_result` as new SSE event types.
- **Budget**: each loop iteration is a new model call → the pre-flight estimate
  must allow a few iterations; re-check the budget gate per iteration (reuse the
  existing reservation pattern) so a tool loop can't run away on cost.
- **Guardrails**: tool output flows back into the model and its final answer
  already passes the incremental output guardrail; tool args (model-authored)
  need no input-guardrail (they're not user text). Note in code.

### 5. Persistence
Store the tool round-trips on the assistant message metadata (name + redacted
args + ok) so reopening a conversation shows "called ARSO weather". Minimal:
attach a `toolCalls[]` array to the persisted assistant message metadata; FE
renders them in Phase D.

## Sub-phasing (each its own commit/PR-checkpoint)

- **C1 — openai-sdk loop + ARSO wired + SSE events.** The bulk of the value:
  on the OpenAI-compatible route (most traffic), the model calls ARSO tools and
  answers. New events forwarded; gating + per-iteration budget; cap at 5 iters.
  *Live-testable: ask "vreme v Ljubljani" on an OpenRouter model.*
- **C2 — anthropic-sdk loop.** Native `tool_use` path, mapped to the same events.
- **C3 — persistence + hardening.** Persist tool calls; sum usage across iters;
  abort/Stop mid-loop handled; tests. (FE rendering + the Integration toggle are
  **Phase D**.)

## Risks + mitigations

- **Touches the core chat** → keep it behind the gate: when `tools` is absent the
  path is exactly today's code. Land C1 first, verify no regression on a normal
  (no-tool) message before anything else.
- **tool_calls streaming is fiddly** (incremental id/name/arguments by index) →
  accumulate carefully; unit-test the accumulator with a faked chunk sequence
  (mirrors `chat.service.spec.ts`).
- **Runaway loop / cost** → `maxToolIters` + per-iteration budget gate.
- **Provider differences** → C1 (OpenAI) and C2 (Anthropic) split so each is
  verified independently; models without tool support never get `tools`.
- **Usage/billing** → sum usage across iterations (today only the last is kept).

## Open questions (confirm before C1)

1. **Model capability source:** start with "openai-sdk route ⇒ supportsTools, plus
   Anthropic native ⇒ supportsTools" (coarse, works for mainstream models), and
   refine with a catalog flag later? *(lean yes)*
2. **ARSO gate for C-phase:** until the Integration toggle (Phase D) exists,
   default ARSO tools **ON** for everyone (so we can test), or behind a temporary
   env flag? *(lean: ON in dev, env flag to disable.)*
3. **Tool-call persistence shape:** attach to assistant message `metadata.toolCalls`
   (no schema migration) vs a dedicated table? *(lean metadata — no migration.)*
