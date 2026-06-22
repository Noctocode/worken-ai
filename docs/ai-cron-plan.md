# AI Cron (urnik AI promptov) — načrt

Branch: `feat/cron-job-promps` · vse v en PR.

Stran `/ai-cron`, postavka `sidebar.nav.aiCron` v 2. skupini sidebara, takoj pod
Knowledge Core (`apps/web/src/components/layout/sidebar.tsx:117`), ikona `CalendarClock`.

Uporabnik izbere **kdaj** (urnik), **kaj** (prompt), **s katerim modelom** (vsi modeli +
BYOK + Custom LLM + Azure), opcijski **kontekst** (Knowledge Core RAG / web search) in
**dostavo** rezultata (in-app, e-pošta s seznamom prejemnikov, webhook).

## A) Arhitektura

DB-backed urnik z minutnim skenerjem; izvedba prek obstoječega `ChatTransportService`
(`apps/api/src/integrations/chat-transport.service.ts`) — pokrije katalog, BYOK,
Custom LLM, Azure brez dodatnega dela.

- Nove deps (`apps/api`): `@nestjs/schedule`, `cron-parser` (pin verzije; API check
  `CronExpressionParser.parse` vs `parseExpression`).
- `ScheduleModule.forRoot()` registriran **enkrat v `AppModule`**; `ai-cron` modul samo `@Cron` provider.

### Ključno dejstvo o podpisu
`ChatTransportService.resolve` sprejme `{ userId, modelIdentifier, projectId?, teamId? }` —
`scope` stringa NE pozna. Team kontekst = `teamId` (nullable). String `scope`
(`personal | <teamId>`) je samo konvencija FE pickerja `/models/effective`
(`models.controller.ts:45-50`). Zato shrani samo `teamId` (NULL = personal), brez `scope`
stolpca in brez translation layerja ob izvedbi.

## B) Baza (`packages/database/src/schema/index.ts`)

**`scheduledPrompts`**: `id`, `ownerId`→users (= resolve.userId), `teamId`→teams nullable
(= resolve.teamId; NULL ⇒ personal), `name`, `prompt`, `modelIdentifier`, `cronExpression`,
`timezone` (default UTC), `useKnowledgeCore` (bool), `knowledgeFolderId`→knowledgeFolders (null),
`useWebSearch` (bool), `deliverInApp`/`deliverEmail`/`deliverWebhook` (bool),
`emailRecipients` (jsonb string[]), `webhookUrl` (text null), `isEnabled` (bool),
`lastRunAt`/`nextRunAt` (ts null), `createdAt`/`updatedAt`.
- Index `(isEnabled, nextRunAt)` za skener.

**`scheduledPromptRuns`**: `id`, `scheduledPromptId`→cascade, `status`
(`pending|running|success|failed`), `startedAt`/`finishedAt`, `lastHeartbeatAt` (ts),
`triggeredBy` (`schedule|manual`), `output`, `errorMessage`, `model`/`provider`/
`promptTokens`/`completionTokens`/`totalTokens`/`costUsd`/`latencyMs`,
`deliveryStatus` (jsonb), `createdAt`.
- Indeksi `(scheduledPromptId, createdAt)`, `(status, lastHeartbeatAt)` (reaper).

Po spremembi: `pnpm db:generate` + `pnpm db:migrate` + `pnpm --filter @worken/database build`
+ restart API (drizzle dist past).

## C) Backend — `apps/api/src/ai-cron/`

- **controller** (`JwtOrApiKeyGuard`, `@CurrentUser()`): `GET /`, `POST /`, `PATCH /:id`,
  `DELETE /:id`, `POST /:id/run-now`, `POST /:id/toggle`, `GET /:id/runs`,
  `POST /validate-cron` (human opis + naslednjih 5 zagonov). Na meji ob shranjevanju:
  FE picker `scope` → `teamId` (`"personal"→null`).
- **ai-cron.service**: CRUD, lastništvo, validacija cron+TZ, stroškovni guardrail
  (ne-BYOK/ne-Custom ⇒ vsiljen min interval, npr. ≥15 min).
- **cron-scheduler.service** (`@Cron('* * * * *')`, dvofazno):
  - Faza 1 (kratka TX): `… WHERE isEnabled AND nextRunAt <= now() FOR UPDATE SKIP LOCKED LIMIT N`;
    ustvari run (`running`, `lastHeartbeatAt=now()`, `triggeredBy='schedule'`), takoj preračunaj
    `nextRunAt` na naslednji prihodnji termin iz now() (zamujeni = run once + skok naprej,
    brez catch-up), zapiši `lastRunAt`, commit → lock sproščen.
  - Faza 2 (izven TX): runner izvede; lock se NE drži čez LLM klic.
  - Per-owner concurrency cap: preskoči ownerje z ≥K aktivnih `schedule` runov;
    `triggeredBy='manual'` se NE šteje v cap.
  - Heartbeat-reaper: `running` run-i s stale `lastHeartbeatAt` (>3–5 min) → `failed`
    (ne po absolutnem času od startedAt). Mirror orphaned-file heartbeat/reaper vzorca.
- **cron-runner.service**: zgradi sporočila; RAG → vektorska poizvedba (isti util kot chat);
  web search → web-search pot; `resolve({ userId: ownerId, modelIdentifier, teamId })` →
  non-streaming klic; periodično osvežuje `lastHeartbeatAt`; observability event + run update;
  kliče delivery.
- **delivery.service** (`deliveryStatus` per kanal):
  - In-app → NotificationsModule.
  - E-pošta → `MailService.sendCronRunResult({ to, jobName, output })` v zanki čez `emailRecipients`.
  - Webhook (SSRF + DNS-rebinding): samo https; resolve hostname ENKRAT, poveži se na
    pin-ani razrešeni IP (custom `lookup` v agentu, brez re-resolva); zavrni
    private/loopback/link-local (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7);
    `redirect: 'manual'`, zavrni 3xx; Host header = originalni hostname (TLS SNI);
    timeout + omejena velikost. Odločitev dokumentirana s komentarjem ob webhook poti.

## D) Frontend — `apps/web/src/app/(app)/ai-cron/`

i18n je TIPIZIRAN in strog (`lib/i18n.tsx`): `TranslationKey` iz `en`, `Record<Language,
Record<TranslationKey,string>>` zahteva ključ v `en` IN `sl` hkrati. → novi ključi (oba jezika)
gredo v isti commit, kjer se prvič uporabijo. Ni "loose lookup" izhoda. Prevajamo samo UI
besedilo, ne `console.*`/`throw`.

- Sidebar postavka + `route-config.ts` vnos.
- `page.tsx` (seznam): ime, urnik v naravnem jeziku, model (badge BYOK/Custom), status toggle,
  naslednji zagon, zadnji rezultat, akcije (uredi/zaženi zdaj/zgodovina/izbriši), "+ Novo opravilo".
- `new` + `[id]/edit` (skupna `ai-cron-form.tsx`), 5 sekcij: Kdaj (builder dnevno/tedensko/mesečno
  + ura/dnevi + TZ, preklop na napredni cron z živim preview naslednjih 5 zagonov) · Kaj
  (prompt + presets — frontend konstanta) · Model (`useUserModels()` → vsi + BYOK + Custom + Azure,
  badgi) · Kontekst (Samo prompt / Knowledge Core + mapa / Web search) · Dostava (In-app · E-pošta
  s chips inputom za prejemnike, default uporabnikov mail · Webhook + URL).
- Run history (drawer/pod-stran) + markdown render.
- `api.ts` + hooki (`use-scheduled-prompts.ts`).

---

# Commit plan — vse na `feat/cron-job-promps`, en PR

Invarianta: vsak commit je samostojno zelen (`pnpm build` + `pnpm lint` ne padeta vmes).
Konvencionalni prefiksi.

| # | Commit | Vsebina |
|---|--------|---------|
| 1 | `feat(db): add scheduled_prompts and scheduled_prompt_runs schema` | Obe tabeli + indeksi, generirana migracija, `@worken/database` rebuild |
| 2 | `chore(api): add @nestjs/schedule and cron-parser deps` | package.json/lockfile, pin, `ScheduleModule.forRoot()` v AppModule |
| 3 | `feat(api): scaffold ai-cron module with CRUD and runs read` | module, controller (`GET`/`POST`/`PATCH`/`DELETE`/`toggle` + **`GET /:id/runs`**), service, cron+TZ validacija, `scope→teamId`. (`GET /:id/runs` vrača prazen seznam — zelen, obstaja pred FE) |
| 4 | `feat(api): add cron validation and next-run preview endpoint` | `POST /validate-cron` (human opis + 5 zagonov), stroškovni guardrail (min interval) |
| 5 | `feat(api): add two-phase cron scheduler with heartbeat reaper` | `@Cron('* * * * *')`, faza-1 claim (`FOR UPDATE SKIP LOCKED` + nextRunAt skok), per-owner cap, heartbeat-reaper. Runner še ni priklopljen |
| 6 | `feat(api): execute scheduled prompts via chat transport` | `cron-runner` (resolve, RAG, web-search, non-streaming, heartbeat refresh, observability + run update); **`POST /:id/run-now`** priklopljen. **Delivery = no-op/stub** (run se zapiše, dostava se ne izvede) → commit zelen + run-now testabilen |
| 7 | `feat(api): deliver cron run results (in-app, email, webhook)` | `delivery.service` + `MailService.sendCronRunResult`; webhook SSRF/DNS-rebinding pin; zamenja stub iz 6. run-now end-to-end |
| 8 | `feat(web): add ai-cron sidebar entry, route config, list page` | sidebar, route-config, `/ai-cron` seznam, `api.ts` + hooki. **i18n ključi (en+sl) za te poglede v ISTEM commitu** |
| 9 | `feat(web): add ai-cron create/edit form with schedule builder` | `/ai-cron/new` + `[id]/edit`, `ai-cron-form.tsx` (vseh 5 sekcij). **i18n ključi (en+sl) v ISTEM commitu** |
| 10 | `feat(web): add run history view` | Drawer/pod-stran + markdown render. **i18n ključi (en+sl) v ISTEM commitu** |
| 11 | `chore: fix lint and build for ai-cron feature` | Samo če po vsem kaj ostane. Sicer izpusti |

Opombe:
- Commit 11 (prejšnji ločeni "i18n strings") ODPADE — tipiziran strog i18n zahteva ključe (en+sl)
  ob prvi uporabi, torej v commitih 8/9/10.
- `git add .` premišljeno: `design-bug.png` (untracked) NE sme v te commite — `.gitignore` ali pusti ločeno.
- BE (1–7) testabilen prek `run-now` preden se loti FE (8–10).
- PR: `feat: AI Cron — scheduled AI prompts`; opis = model (DB-backed scanner, dvofazno, reaper,
  SSRF), screenshot, omemba migracije + `@worken/database` rebuild za reviewerje.
