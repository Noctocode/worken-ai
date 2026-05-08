import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { guardrails } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { ObservabilityService } from '../observability/observability.service.js';

export type GuardrailTarget = 'input' | 'output';
export type GuardrailAction = 'fix' | 'exception';

/**
 * Marker the FE chat-error humanizer matches on to render the
 * "blocked by a guardrail" message. Same pattern as the budget
 * markers (BUDGET_PENDING_APPROVAL, ORG_BUDGET_EXCEEDED, …).
 */
export const GUARDRAIL_BLOCKED_MARKER = 'GUARDRAIL_BLOCKED';

/**
 * Per-rule outcome bundled into a decision. `matches` counts how many
 * times the rule fired so we can increment the per-rule triggers
 * counter accurately even when the rule maps to multiple regex hits
 * in a single text.
 */
export interface GuardrailViolation {
  ruleId: string;
  ruleName: string;
  validator: string;
  severity: string;
  matches: number;
  action: GuardrailAction;
}

/**
 * What `evaluate` hands back to the caller. `text` is the (possibly
 * masked) string the chat layer should pass forward — equal to the
 * input when nothing matched. `blocked` is the first exception-action
 * violation; when set, the caller should surface a 422 instead of
 * passing `text` along. `violations` covers every hit (fix and
 * exception) so the caller can bump triggers on all of them.
 */
export interface GuardrailDecision {
  text: string;
  blocked: GuardrailViolation | null;
  violations: GuardrailViolation[];
}

interface LoadedRule {
  id: string;
  name: string;
  validatorType: string | null;
  entities: unknown;
  pattern: string | null;
  target: string;
  onFail: string;
  severity: string;
}

/**
 * Each PII entity maps to a regex (or undefined for entities that
 * need NER — Person / Location / NRP). Detected matches are replaced
 * with `[REDACTED:<entity>]` when the rule's onFail is "fix".
 *
 * Some patterns lean conservative on purpose:
 *  - `\b` boundaries everywhere so partial matches in URLs / emails
 *    don't false-trip
 *  - case-insensitive only where it doesn't break semantics
 */
const PII_REGEXES: Record<string, RegExp | null> = {
  'Email Address': /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  'Phone Number':
    /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g,
  'Credit Card': /\b(?:\d{4}[- ]?){3}\d{4}\b|\b\d{16}\b|\b3\d{14}\b/g,
  'IBAN Code': /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
  'IP Address':
    /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  'Date Time':
    /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\b/g,
  // Bitcoin (P2PKH/P2SH/Bech32) + Ethereum addresses. Conservative —
  // long alphanumeric strings can false-trip; OK for a guardrail.
  Crypto:
    /\b(?:bc1[a-z0-9]{39,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40})\b/g,
  // ── Heuristic NER ────────────────────────────────────────────
  // True NER (Microsoft Presidio, spaCy, an LLM call) catches more,
  // but adds a service dependency and per-call latency we don't
  // want on the chat hot path. The heuristics below catch the
  // obvious cases without false-positiving on every Capitalized
  // word — admins who need production-grade detection should run
  // Presidio behind a proxy or stand up an LLM-based pre-filter.
  //
  // Person: titles (Mr./Mrs./Ms./Dr./Prof./Sir/Madam) followed by
  // 1-3 capitalised name parts. Apostrophes / hyphens allowed in
  // names (O'Brien, Marie-Claire). Bare "John Smith" without a
  // title is intentionally NOT matched — that pattern false-trips
  // on countless capitalised pairs ("United States", "New York").
  Person:
    /\b(?:Mr|Mrs|Ms|Dr|Prof|Sir|Madam|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-ZČŠŽŁ][\wčšžćđüöäßéèáàíìóòúùÀ-ſ'-]{1,}(?:\s+[A-ZČŠŽŁ][\wčšžćđüöäßéèáàíìóòúùÀ-ſ'-]{1,}){0,2}\b/gu,
  // Location: curated list of countries + major cities. Misses
  // "Salzburg" (not in the list) but doesn't false-trip on
  // "Hello World". Gives an admin a starting point that they can
  // extend via the regex_match validator for org-specific places.
  Location: buildKeywordRegex(LOCATIONS_LIST()),
  // NRP (Nationality / Religious / Political): same shape — a
  // curated list of the most common NRP terms. EU-leaning; admins
  // in other regions can add via regex_match.
  NRP: buildKeywordRegex(NRP_LIST()),
};

function LOCATIONS_LIST(): string[] {
  return [
    // Countries (EU + major)
    'United States',
    'United Kingdom',
    'Germany',
    'France',
    'Italy',
    'Spain',
    'Portugal',
    'Netherlands',
    'Belgium',
    'Luxembourg',
    'Austria',
    'Switzerland',
    'Slovenia',
    'Croatia',
    'Serbia',
    'Bosnia and Herzegovina',
    'Montenegro',
    'Hungary',
    'Czech Republic',
    'Slovakia',
    'Poland',
    'Romania',
    'Bulgaria',
    'Greece',
    'Ireland',
    'Denmark',
    'Sweden',
    'Norway',
    'Finland',
    'Iceland',
    'Estonia',
    'Latvia',
    'Lithuania',
    'Russia',
    'Ukraine',
    'Turkey',
    'Canada',
    'Mexico',
    'Brazil',
    'Argentina',
    'China',
    'Japan',
    'India',
    'Australia',
    'New Zealand',
    'South Africa',
    // Major cities (capitals + global hubs)
    'New York',
    'London',
    'Paris',
    'Berlin',
    'Munich',
    'Hamburg',
    'Frankfurt',
    'Vienna',
    'Zurich',
    'Geneva',
    'Rome',
    'Milan',
    'Madrid',
    'Barcelona',
    'Lisbon',
    'Amsterdam',
    'Brussels',
    'Copenhagen',
    'Stockholm',
    'Oslo',
    'Helsinki',
    'Dublin',
    'Athens',
    'Istanbul',
    'Moscow',
    'Warsaw',
    'Prague',
    'Budapest',
    'Bucharest',
    'Sofia',
    'Belgrade',
    'Zagreb',
    'Ljubljana',
    'Sarajevo',
    'Skopje',
    'Tokyo',
    'Beijing',
    'Shanghai',
    'Hong Kong',
    'Mumbai',
    'Delhi',
    'Sydney',
    'Melbourne',
    'Toronto',
    'San Francisco',
    'Los Angeles',
    'Chicago',
    'Boston',
    'Washington',
    'Seattle',
  ];
}

function NRP_LIST(): string[] {
  return [
    // Nationalities (English names — covers most reporting / chat use)
    'American',
    'British',
    'English',
    'Scottish',
    'Irish',
    'Welsh',
    'German',
    'French',
    'Italian',
    'Spanish',
    'Portuguese',
    'Dutch',
    'Belgian',
    'Austrian',
    'Swiss',
    'Slovenian',
    'Croatian',
    'Serbian',
    'Bosnian',
    'Hungarian',
    'Czech',
    'Slovak',
    'Polish',
    'Romanian',
    'Bulgarian',
    'Greek',
    'Russian',
    'Ukrainian',
    'Turkish',
    'Canadian',
    'Mexican',
    'Brazilian',
    'Argentinian',
    'Chinese',
    'Japanese',
    'Korean',
    'Indian',
    'Pakistani',
    'Australian',
    'African',
    'Asian',
    'European',
    // Religions (broad strokes — admins extend via regex_match for
    // denominations / sects)
    'Christian',
    'Catholic',
    'Protestant',
    'Orthodox',
    'Muslim',
    'Jewish',
    'Buddhist',
    'Hindu',
    'Sikh',
    'Atheist',
    'Agnostic',
    // Political affiliations (English — broad)
    'Republican',
    'Democrat',
    'Liberal',
    'Conservative',
    'Socialist',
    'Communist',
    'Libertarian',
    'Green Party',
  ];
}

/**
 * Build a single union regex from a phrase list. `\b` boundaries
 * keep substring matches out (so "Indian" doesn't match "Indiana"),
 * `u` flag covers Unicode case folding and lets `\w` include
 * non-ASCII letters consistently.
 */
function buildKeywordRegex(phrases: string[]): RegExp {
  return new RegExp(`\\b(?:${phrases.map(escapeRegex).join('|')})\\b`, 'giu');
}

/**
 * Common jailbreak / prompt-injection phrases. Conservative list so
 * legitimate prompts don't false-trip — mostly the literal phrases
 * adversaries use to override system prompts. Match is
 * case-insensitive across word boundaries.
 *
 * EN, SL, and DE coverage. SL and DE additions mirror the EN intent
 * (override / reveal / role-swap) so a prompt translated for an EU
 * tenant still trips the gate. Adding a new language is just append
 * + redeploy — the union regex rebuilds on import.
 */
const JAILBREAK_PHRASES = [
  // English
  'ignore previous instructions',
  'ignore the above',
  'ignore all previous',
  'disregard previous',
  'forget your instructions',
  'forget previous instructions',
  'you are now',
  'pretend you are',
  'act as if you',
  'roleplay as',
  'developer mode',
  'jailbreak mode',
  'DAN mode',
  'do anything now',
  'unrestricted mode',
  'no restrictions',
  'without any restrictions',
  'bypass your',
  'bypass safety',
  'bypass guidelines',
  'override your',
  'override the system',
  'system prompt',
  'reveal your prompt',
  'show your instructions',
  'print your prompt',
  'output your prompt',
  // Slovenian
  'zanemari prejšnja navodila',
  'zanemari navodila',
  'ignoriraj navodila',
  'pozabi navodila',
  'pozabi prejšnja navodila',
  'ti si zdaj',
  'pretvarjaj se da si',
  'igraj vlogo',
  'razkrij navodila',
  'razkrij sistemsko navodilo',
  'brez omejitev',
  'način brez omejitev',
  'mimo varnostnih',
  // German
  'ignoriere die obigen anweisungen',
  'ignoriere alle vorherigen',
  'vergiss deine anweisungen',
  'vergiss alle vorherigen',
  'du bist jetzt',
  'tu so als wärst du',
  'spiele die rolle',
  'entwicklermodus',
  'ohne einschränkungen',
  'umgehe die sicherheits',
  'überschreibe das system',
  'zeige deine anweisungen',
  'enthülle deinen prompt',
];

const JAILBREAK_REGEX = new RegExp(
  // word boundary on both sides; phrases get their literal regex chars
  // escaped so the few with apostrophes / hyphens don't break. `u`
  // flag is necessary for proper Unicode case folding — without it,
  // SL/DE phrases like "Zanemari" wouldn't match "zanemari" because
  // ASCII-only `i` doesn't fold Š↔š etc.
  `\\b(?:${JAILBREAK_PHRASES.map(escapeRegex).join('|')})\\b`,
  'giu',
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Token chunk size at which a streaming output gate would re-evaluate.
 * Not used today — chat is non-streaming — but exported as a hint for
 * the future streaming integration so the constant lives near the
 * evaluator that owns the policy rather than scattered in chat code.
 *
 * Streaming integration plan when it lands:
 *   1. Caller opens an OpenAI SDK stream
 *   2. Buffer tokens into a `pending` string
 *   3. Every STREAM_REEVAL_CHUNK_BYTES received bytes (or on
 *      newline / sentence boundary, whichever comes first), call
 *      `evaluate({ text: pending, target: 'output', userId, teamId })`
 *   4. If `blocked` → close the stream + 422. If violations
 *      contain only fix-rules → emit the difference between the
 *      previous fixed text and the new fixed text, then continue.
 *   5. After the upstream stream closes, run one final evaluate on
 *      the complete text to catch a violating phrase that straddles
 *      chunk boundaries.
 *
 * The current `evaluate` signature already shape-fits this — it's
 * pure with respect to the input text, so nothing about the API
 * needs to change.
 */
export const STREAM_REEVAL_CHUNK_BYTES = 256;

/**
 * Optional external NER endpoint. When the env var is set, the
 * evaluator calls this URL for Person / Location / NRP entity
 * detection instead of (or alongside) the heuristic regex
 * fallbacks below. Recommended backends:
 *
 *   - Microsoft Presidio behind a proxy (https://microsoft.github.io/presidio/)
 *     — production-grade, free, runs locally.
 *   - Internal LLM-based extractor (a cheap model with a strict
 *     "extract entities, return JSON" system prompt). Easy to spin
 *     up but adds per-call cost + latency.
 *
 * Endpoint contract: POST { text } → { entities: [{ entity, type
 * (Person|Location|NRP), start, end }] }. Implementations that
 * don't conform return any other shape and the evaluator falls
 * back to heuristics with a warn-log.
 */
const EXTERNAL_NER_URL = process.env.GUARDRAIL_NER_URL ?? null;
const EXTERNAL_NER_TIMEOUT_MS = 1500;

interface ExternalNerEntity {
  entity: string;
  type: 'Person' | 'Location' | 'NRP';
  start: number;
  end: number;
}

@Injectable()
export class GuardrailEvaluatorService {
  private readonly logger = new Logger(GuardrailEvaluatorService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly observability: ObservabilityService,
  ) {}

  /**
   * Run every applicable guardrail rule against `text` and return a
   * decision the chat layer can act on. `target='input'` filters to
   * rules whose target is 'input' or 'both'; same for 'output'.
   *
   * Rule scope:
   *   - userId only → personal rules (teamId is null on the rule)
   *   - userId + teamId → both personal AND team-scoped rules for that
   *     team. Team-scoped rules respect the team's isActive flag too
   *     (`teamIsActive`), so admins can pause a shared rule without
   *     unassigning it.
   *
   * Scaling note: PII regexes scan once per rule, so a chat with N
   * applicable rules is O(N * |text|). Realistic N (1–10 rules per
   * org) keeps this well under a millisecond on chat-sized text.
   */
  async evaluate(input: {
    text: string;
    target: GuardrailTarget;
    userId: string;
    teamId: string | null;
  }): Promise<GuardrailDecision> {
    const rules = await this.loadApplicableRules(input);
    const targetMatches = (rule: LoadedRule) =>
      rule.target === input.target || rule.target === 'both';

    // External NER once per evaluate, only when (a) the env hook is
    // configured and (b) at least one applicable rule actually asks
    // for Person/Location/NRP. Cached across rules so a request that
    // applies two PII rules doesn't pay the network cost twice.
    let externalNer: ExternalNerEntity[] | null = null;
    const needsNer =
      EXTERNAL_NER_URL !== null &&
      rules.some(
        (r) =>
          targetMatches(r) &&
          r.validatorType === 'no_pii' &&
          parseEntities(r.entities).some(
            (e) => e === 'Person' || e === 'Location' || e === 'NRP',
          ),
      );
    if (needsNer) {
      externalNer = await this.extractExternalNer(input.text);
    }

    let workingText = input.text;
    const violations: GuardrailViolation[] = [];
    let blocked: GuardrailViolation | null = null;

    for (const rule of rules) {
      if (!targetMatches(rule)) continue;
      const action: GuardrailAction =
        rule.onFail === 'exception' ? 'exception' : 'fix';

      let hits = 0;
      let fixedText = workingText;

      switch (rule.validatorType) {
        case 'no_pii': {
          const result = runNoPii(workingText, rule.entities, externalNer);
          hits = result.matches;
          fixedText = result.fixed;
          break;
        }
        case 'detect_jailbreak': {
          // `entities` doubles as the admin's custom blocklist for
          // this validator — we union it with the built-in 27
          // phrases rather than replacing them, so admins extend
          // the curated list instead of losing it. Empty / null
          // entities → built-in only.
          const result = runDetectJailbreak(
            workingText,
            parseEntities(rule.entities),
          );
          hits = result.matches;
          fixedText = result.fixed;
          break;
        }
        case 'regex_match': {
          // Compile the admin-supplied pattern at evaluate time. We
          // don't cache compiled regexes between calls because:
          //   - rules can be edited / disabled mid-flight; cache
          //     invalidation isn't worth the complexity
          //   - typical N (1–10 active rules) makes per-call compile
          //     a few microseconds, well under the chat round-trip
          // Broken patterns are logged + skipped instead of throwing
          // so a single typo'd rule doesn't take down everyone's
          // chat. The create path validates patterns up front, but
          // legacy rows or future bypass paths (manual SQL) might
          // still slip through.
          const result = runRegexMatch(
            workingText,
            rule.pattern,
            this.logger,
            rule.id,
          );
          hits = result.matches;
          fixedText = result.fixed;
          break;
        }
        default:
          this.logger.warn(
            `Unknown validatorType "${rule.validatorType}" on rule ${rule.id}; skipping.`,
          );
          break;
      }

      if (hits === 0) continue;

      const violation: GuardrailViolation = {
        ruleId: rule.id,
        ruleName: rule.name,
        validator: rule.validatorType ?? 'unknown',
        severity: rule.severity,
        matches: hits,
        action,
      };
      violations.push(violation);

      // Carry the masked text forward in BOTH paths. For 'fix' it's
      // necessary so the next rule sees the redacted text. For
      // 'exception' it isn't load-bearing for the chat layer (we're
      // about to refuse the message anyway), but the audit log
      // downstream uses workingText as its `promptSample` — keeping
      // the masked version means observability_events doesn't end
      // up holding the raw PII that triggered the block.
      workingText = fixedText;
      if (action === 'exception') {
        // First exception wins — short-circuit so we don't keep
        // masking text we're about to refuse anyway.
        blocked = violation;
        break;
      }
    }

    // Bump triggers + emit audit events fire-and-forget — both are
    // audit data, neither is load-bearing for the chat path. Logged
    // errors keep them visible without taking down the call.
    if (violations.length > 0) {
      void this.bumpTriggers(violations.map((v) => v.ruleId)).catch((err) => {
        this.logger.warn(
          `Failed to increment guardrail triggers: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
      void this.recordAuditEvents({
        userId: input.userId,
        teamId: input.teamId,
        target: input.target,
        // workingText is post-fix — the version we'll actually pass
        // to the LLM (or persist). We log this rather than the raw
        // input so observability_events doesn't become a PII sink:
        // emails / cards / etc. are already redacted in the snippet
        // by the time we record it. Compliance still sees the
        // shape of what triggered ("[REDACTED:Email Address] in
        // 'reach me at …'") which is the actual audit need.
        promptSample: workingText,
        violations,
      }).catch((err) => {
        this.logger.warn(
          `Failed to emit guardrail audit events: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return { text: workingText, blocked, violations };
  }

  private async recordAuditEvents(input: {
    userId: string;
    teamId: string | null;
    target: GuardrailTarget;
    promptSample: string;
    violations: GuardrailViolation[];
  }): Promise<void> {
    // One observability event per violating rule so dashboards can
    // group / count by rule without unpacking metadata. Sequential
    // (not Promise.all) — these are audit-side, no need to fan out.
    for (const v of input.violations) {
      await this.observability.recordLLMCall({
        userId: input.userId,
        teamId: input.teamId,
        eventType: 'guardrail_trigger',
        // success flips meaning slightly here: we're not measuring
        // whether the chat call succeeded but whether the GUARDRAIL
        // let traffic through. fix → traffic flowed (success); the
        // exception path → blocked (failure-shaped row). Lets the
        // observability dashboard render trigger / block columns
        // separately.
        success: v.action === 'fix',
        prompt: input.promptSample,
        metadata: {
          ruleId: v.ruleId,
          ruleName: v.ruleName,
          validator: v.validator,
          severity: v.severity,
          action: v.action,
          target: input.target,
          matches: v.matches,
        },
      });
    }
  }

  private async loadApplicableRules(scope: {
    userId: string;
    teamId: string | null;
  }): Promise<LoadedRule[]> {
    // Personal rules: rule.teamId IS NULL AND rule.ownerId = me AND
    // rule.isActive. Team rules: rule.teamId = X AND rule.isActive
    // AND rule.teamIsActive — regardless of who owns the rule, every
    // team member sees a shared rule the team admin assigned.
    const personalCond = and(
      isNull(guardrails.teamId),
      eq(guardrails.ownerId, scope.userId),
      eq(guardrails.isActive, true),
    );
    const whereClause = scope.teamId
      ? or(
          personalCond,
          and(
            eq(guardrails.teamId, scope.teamId),
            eq(guardrails.isActive, true),
            eq(guardrails.teamIsActive, true),
          ),
        )
      : personalCond;

    return await this.db
      .select({
        id: guardrails.id,
        name: guardrails.name,
        validatorType: guardrails.validatorType,
        entities: guardrails.entities,
        pattern: guardrails.pattern,
        target: guardrails.target,
        onFail: guardrails.onFail,
        severity: guardrails.severity,
      })
      .from(guardrails)
      .where(whereClause)
      // Severity-first ordering matters because the evaluator
      // short-circuits on the first exception-action violation: a
      // high-severity exception rule should win over a lower-
      // severity one when both match the same prompt. CASE expr
      // sorts the string column 'high'/'medium'/'low' as 0/1/2 so
      // ASC == high-first. createdAt narrows it down further;
      // guardrails.id as the final tiebreaker guarantees the same
      // ordering across calls even when bulk inserts (template
      // application) land two rules in the same microsecond.
      .orderBy(
        asc(
          sql`CASE ${guardrails.severity}
                WHEN 'high' THEN 0
                WHEN 'medium' THEN 1
                ELSE 2
              END`,
        ),
        desc(guardrails.createdAt),
        asc(guardrails.id),
      );
  }

  /**
   * Call the configured external NER endpoint with a hard timeout.
   * Returns null on any failure (network, non-2xx, malformed body)
   * so the caller silently falls back to heuristics — production
   * NER is a quality boost, not load-bearing for the chat path.
   *
   * Endpoint contract documented next to EXTERNAL_NER_URL above.
   */
  private async extractExternalNer(
    text: string,
  ): Promise<ExternalNerEntity[] | null> {
    if (!EXTERNAL_NER_URL) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTERNAL_NER_TIMEOUT_MS);
    try {
      const res = await fetch(EXTERNAL_NER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `External NER returned ${res.status}; falling back to heuristics.`,
        );
        return null;
      }
      const body: unknown = await res.json();
      if (
        !body ||
        typeof body !== 'object' ||
        !Array.isArray((body as { entities?: unknown[] }).entities)
      ) {
        this.logger.warn(
          'External NER response missing `entities` array; falling back to heuristics.',
        );
        return null;
      }
      const raw = (body as { entities: unknown[] }).entities;
      // Defensive shape check — drop malformed entries instead of
      // failing the whole call.
      return raw.filter((e): e is ExternalNerEntity => {
        if (!e || typeof e !== 'object') return false;
        const r = e as Record<string, unknown>;
        return (
          typeof r.entity === 'string' &&
          (r.type === 'Person' || r.type === 'Location' || r.type === 'NRP') &&
          typeof r.start === 'number' &&
          typeof r.end === 'number' &&
          r.end > r.start
        );
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `External NER call failed (${msg}); falling back to heuristics.`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async bumpTriggers(ruleIds: string[]): Promise<void> {
    if (ruleIds.length === 0) return;
    // One increment per violating rule per call, even when the rule
    // produced multiple regex hits — per-hit counting would inflate
    // the FE Triggers column into "redactions made", which isn't
    // what the column communicates.
    await this.db
      .update(guardrails)
      .set({
        triggers: sql`${guardrails.triggers} + 1`,
        updatedAt: new Date(),
      })
      .where(inArray(guardrails.id, ruleIds));
  }
}

/* ─── Validators ─────────────────────────────────────────────────── */

function runNoPii(
  text: string,
  entitiesRaw: unknown,
  externalNer: ExternalNerEntity[] | null = null,
): { matches: number; fixed: string } {
  const entities = parseEntities(entitiesRaw);
  const requested = new Set(entities);
  let matches = 0;
  let fixed = text;

  // Phase 1: external NER (when configured + returned). Replace by
  // offset, processing back-to-front so earlier indices stay valid
  // through the sequence of slice / concat operations.
  const nerEntityNames = new Set(['Person', 'Location', 'NRP']);
  if (externalNer && externalNer.length > 0) {
    const applicable = externalNer
      .filter((e) => requested.has(e.type))
      .sort((a, b) => b.start - a.start);
    for (const e of applicable) {
      fixed =
        fixed.slice(0, e.start) + `[REDACTED:${e.type}]` + fixed.slice(e.end);
      matches += 1;
    }
  }

  // Phase 2: heuristic regex for the rest of the entities. Skip
  // Person/Location/NRP if external NER already handled them so we
  // don't double-mask the same span.
  const externalCovered = externalNer !== null;
  for (const entity of entities) {
    if (externalCovered && nerEntityNames.has(entity)) continue;
    const regex = PII_REGEXES[entity];
    if (!regex) continue; // unknown entity — skip
    fixed = fixed.replace(regex, () => {
      matches += 1;
      return `[REDACTED:${entity}]`;
    });
  }
  return { matches, fixed };
}

function runDetectJailbreak(
  text: string,
  customPhrases: string[] = [],
): { matches: number; fixed: string } {
  // Union the built-in 27 with the admin's custom blocklist on every
  // call — cheap because typical N is small, and rebuilding lets
  // admins toggle phrases without restarting the server. Each custom
  // entry is regex-escaped + word-boundaried, same shape as built-in.
  const cleaned = customPhrases
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const regex =
    cleaned.length === 0
      ? JAILBREAK_REGEX
      : new RegExp(
          `\\b(?:${[...JAILBREAK_PHRASES, ...cleaned]
            .map(escapeRegex)
            .join('|')})\\b`,
          'giu',
        );
  let matches = 0;
  const fixed = text.replace(regex, (m) => {
    matches += 1;
    return `[BLOCKED]${' '.repeat(Math.max(0, m.length - 9))}`;
  });
  return { matches, fixed };
}

// Hard ceiling on text size for the regex_match validator. Even a
// pattern that slipped through `assertSafeRegex` at create time
// can't lock the chat thread for more than a few milliseconds on a
// payload this size. Set well above realistic chat-message sizes
// (a 100KB prompt is enormous) but still tight enough that the
// pathological worst case is bounded.
const REGEX_MATCH_MAX_INPUT = 100_000;

function runRegexMatch(
  text: string,
  pattern: string | null,
  logger: Logger,
  ruleId: string,
): { matches: number; fixed: string } {
  if (!pattern || pattern.trim().length === 0) {
    // Empty pattern would compile to /(?:)/ which matches everywhere.
    // Treat it as a no-op so a half-configured rule doesn't redact
    // every character of every chat message.
    return { matches: 0, fixed: text };
  }
  if (text.length > REGEX_MATCH_MAX_INPUT) {
    // ReDoS defence-in-depth. assertSafeRegex catches bombs at
    // create time; this caps the blast radius if anything slips
    // through (legacy rules, future bypass paths, etc.). Skipping
    // is safer than running pathological regex on huge payloads —
    // legit prompts virtually never exceed this size.
    logger.warn(
      `regex_match rule ${ruleId} skipped: input length ${text.length} > ${REGEX_MATCH_MAX_INPUT}.`,
    );
    return { matches: 0, fixed: text };
  }
  let regex: RegExp;
  try {
    // 'gi' is the safe default — global so we catch every hit, case-
    // insensitive so admins don't have to think about uppercase
    // variants. Admins who need case-sensitive can prefix their
    // pattern with `(?-i)` (Postgres flavour) — JS engine ignores
    // that flag silently which keeps the validator forgiving.
    regex = new RegExp(pattern, 'gi');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `regex_match rule ${ruleId} has invalid pattern; skipping. (${msg})`,
    );
    return { matches: 0, fixed: text };
  }
  let matches = 0;
  const fixed = text.replace(regex, () => {
    matches += 1;
    return '[REDACTED:regex_match]';
  });
  return { matches, fixed };
}

function parseEntities(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((x): x is string => typeof x === 'string');
  return [];
}
