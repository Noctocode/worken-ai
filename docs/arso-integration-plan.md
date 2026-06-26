# ARSO integration — AI-callable weather / air / water tools

## Goal

Give the chat AI **built-in tools that pull live Slovenian environmental data
from ARSO** (Agencija RS za okolje) and answer questions like *"Kakšno je vreme
v Ljubljani jutri?"*, *"Kakšna je kakovost zraka v Mariboru?"*, *"Kakšen je
vodostaj Save v Litiji?"*. The model decides when to call them (function
calling), the backend fetches + normalizes ARSO data, and the model answers in
the user's language.

Decisions locked in (from scoping):
- **Where it lives:** an **AI-callable tool in chat** (function calling), built
  **specifically for ARSO** — not the generic "AI Tools" plugin framework
  (that track is on hold). The chat tool-loop we add here can generalise later.
- **Data scope:** **weather** (forecast + current), **air quality**, **hydrology**.

## ARSO data — what we call (all public, no API key)

| Data | Endpoint | Format |
|---|---|---|
| Location forecast | `https://vreme.arso.gov.si/api/1.0/location/?location=<place>` | JSON |
| Current observation (per station) | `https://meteo.arso.gov.si/uploads/probase/www/observ/surface/text/sl/observationAms_<STATION>_latest.xml` | XML |
| Air quality (latest hourly, all stations) | `http://www.arso.gov.si/xml/zrak/ones_zrak_urni_podatki_zadnji.xml` | XML |
| Hydrology (latest water levels/flows) | `http://www.arso.gov.si/xml/vode/hidro_podatki_zadnji.xml` | XML |

- **No auth / no key.** Public, reusable; we surface attribution **"Vir: ARSO"**.
- Data refreshes ~30–60 min → we **cache** server-side (good-citizen + speed).
- Two known reference Node libs for shapes: `bkazic/weather-arso-api-node`,
  `papnkukn/arso-podatki`.

## Architecture

```
chat ──(model emits tool_call)──► ToolDispatcher ──► ArsoService ──► ARSO (cached)
  ▲                                                      │
  └──────────── tool result (normalized JSON) ◄──────────┘
```

**1. ARSO data layer — `apps/api/src/arso/` (the easy, isolated part)**
- `arso.service.ts`: fetch + parse + cache the four sources. XML via
  `fast-xml-parser`; normalize each into clean typed JSON (units, timestamps,
  station/place, attribution). In-memory TTL cache (e.g. 30 min) keyed per
  source/place so concurrent calls share one upstream fetch. Fixed ARSO hosts
  (no SSRF surface), per-request timeout + graceful "data unavailable" fallback.
- `arso-locations.ts`: map a free-text Slovenian place → the right station /
  the `location` query param (ARSO uses named places + station codes). Start
  with the location forecast API's own resolver + a curated station list for
  air/water (those XML feeds are station-keyed, not free-text).

**2. Tools (function definitions the model sees)**
- `arso_weather_forecast(location)` — multi-day forecast for a place.
- `arso_current_weather(location)` — latest observation (temp, wind, etc.).
- `arso_air_quality(location?)` — latest air-quality readings (PM10/PM2.5, O₃…).
- `arso_river_level(river_or_station?)` — latest water level / flow.

Each is a thin schema (name, description telling the model *when* to use it,
params) that maps 1:1 to an `ArsoService` method.

**3. Chat tool-loop — `apps/api/src/chat/` (the hard, new part)**
Today the chat is single-turn with no `tool_calls`. We add an agentic loop:
1. Offer the ARSO tools to the provider when the resolved model supports
   function calling (OpenAI-SDK route — OpenRouter/custom/Azure — first; the
   Anthropic native `tool_use` path next). Models without tool support → tools
   simply not offered (chat unchanged).
2. Detect `tool_call` / `tool_use` in the stream; emit new SSE events
   (`tool_call`, `tool_result`) so the UI can show *"Kličem ARSO vreme…"*.
3. Execute the call via the dispatcher → `ArsoService`, append the tool result,
   call the model again. Repeat to a small **MAX_TOOL_ITERS** cap; guard
   budget/tokens each iteration.
4. Persist tool calls for transcript fidelity; tool output goes through the
   existing output guardrails.

**4. Web UI**
- Render `tool_call` / `tool_result` as a compact inline step in the message.
- Attribution line ("Vir: ARSO") on env answers. Optional org/team **toggle**
  to enable ARSO tools (mirrors the existing Web-search toggle).

## Phasing (each = its own PR)

- **Phase A — ARSO data service (inert).** `arso` module: fetch + XML parse +
  cache for weather / air / water; normalized typed methods; a debug
  `GET /arso/*` (admin) to eyeball the normalized JSON. No chat involvement.
  *Shippable, testable standalone (live ARSO calls).*
- **Phase B — Tools + dispatcher + location resolution.** Define the four tool
  schemas; dispatcher maps tool name → ArsoService; free-text place → station /
  location resolver. `POST /arso/tool-test` to dry-run a tool by args.
- **Phase C — Chat tool-loop.** Function calling in chat (offer tools, loop,
  execute, SSE events, persistence, budget guards). **Weather/air/water answers
  work end-to-end in chat.** Biggest + riskiest change.
- **Phase D — Polish.** Inline tool-call UI, attribution, org toggle, cache
  tuning, more places/stations, EN/SL.

## Decisions (locked — confirmed before Phase A)

1. **Provider coverage:** support function calling on the **OpenAI-SDK route
   first**, then Anthropic native `tool_use` in the same Phase C. Models that
   don't support tools → tools simply not offered (chat unchanged).
2. **Gating:** ARSO is **keyless** (public data), so it surfaces in the
   **Integration tab as an enable toggle — no API-key field**. Off until an
   admin enables it for the company/team (the opt-in). (Option 2a.)
3. **Location resolution:** **curated list first** — map the main Slovenian
   places/stations, expand over time.
4. **Caching:** **in-memory per-instance TTL** to start (Redis only if/when the
   API goes multi-instance).

## Non-goals (v1)
- Generic user-defined tools (that's the on-hold AI Tools framework).
- Radar/precipitation imagery, UV, pollen (can add as more tools later).
- Historical/archive queries (ARSO archives exist; out of scope for v1).
