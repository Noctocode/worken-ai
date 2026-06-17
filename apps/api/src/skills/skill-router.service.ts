import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { conversationSkills, skills, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ChatTransportService } from '../integrations/chat-transport.service.js';

/** A skill the router considers / selects. Embedding is required to be
 *  non-null here (the accessible query filters nulls out). */
export interface RoutableSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  descriptionEmbedding: number[];
}

/** A skill the router decided to apply this turn, with why. */
export interface SelectedSkill {
  id: string;
  name: string;
  instructions: string;
  /** 'pinned' = user-forced, 'sticky' = already active in this conversation,
   *  'auto' = newly matched + confirmed this turn. */
  reason: 'pinned' | 'sticky' | 'auto';
}

export interface SelectParams {
  userId: string;
  /** Precomputed query vector (shared from the chat/arena RAG embed). */
  queryEmbedding: number[];
  /** Raw message text for the LLM-confirm step. When omitted, selection is
   *  embedding-only (no confirm) — used by callers that can't supply text. */
  messageText?: string;
  /** Conversation for sticky selection + persistence. Omit for arena
   *  (stateless single question → per-question selection, no persistence). */
  conversationId?: string | null;
  /** Project being chatted in. When set, project-scoped skills linked to it
   *  become routable; omit for the (project-less) arena. */
  projectId?: string | null;
  /** Skills the user pinned in the composer this turn — always included,
   *  bypassing the embedding threshold. */
  pinnedSkillIds?: string[];
}

// Conservative defaults: a false positive (wrong skill silently rewriting
// the answer) is the costlier error, so we keep the bar high and the count
// low. Tunable later from org settings if needed.
// Prefilter threshold. Deliberately loose: it's a high-recall first stage
// (all-MiniLM-L6-v2 cosines run low — naturally-phrased matches land ~0.3–0.4
// against a "use when…" description), with the LLM-confirm step below doing
// the precision. Too tight here and well-phrased requests silently never
// match; confirm is what stops false positives, not this number.
const SIMILARITY_THRESHOLD = 0.3;
const TOP_K = 3; // candidates considered before LLM-confirm
const MAX_AUTO_SKILLS = 2; // cap on auto-selected (pins/sticky don't count)
const MAX_SKILL_CHARS = 4000; // total injected instructions budget
// Cheap, fast model for the confirm step. Defaults to the same model the
// arena trusts as its judge (google/gemini-2.5-flash) — small, fast, and
// reliably available on OpenRouter. Override via env if the catalog shifts.
const CONFIRM_MODEL =
  process.env['SKILL_CONFIRM_MODEL'] || 'google/gemini-2.5-flash';

@Injectable()
export class SkillRouterService {
  private readonly logger = new Logger(SkillRouterService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documentsService: DocumentsService,
    private readonly chatTransport: ChatTransportService,
  ) {}

  /**
   * Resolve an OpenRouter (baseURL, apiKey) for the cheap confirm call via
   * the SAME per-user/BYOK → platform-key resolution chat uses, instead of
   * reading process.env directly. CONFIRM_MODEL is an OpenRouter id, so this
   * yields the caller's OpenRouter key (or the platform fallback). Returns
   * null when no usable key resolves — confirm then can't run and the caller
   * fails closed. process.env is the last-resort fallback.
   */
  private async resolveConfirmClient(userId: string): Promise<OpenAI | null> {
    let apiKey: string | undefined;
    let baseURL = 'https://openrouter.ai/api/v1';
    try {
      const transport = await this.chatTransport.resolve({
        userId,
        modelIdentifier: CONFIRM_MODEL,
      });
      if (transport.apiKey) {
        apiKey = transport.apiKey;
        baseURL = transport.baseURL || baseURL;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Confirm-key transport resolve failed: ${msg}`);
    }
    apiKey = apiKey ?? process.env['OPENROUTER_API_KEY'];
    if (!apiKey) return null;
    return new OpenAI({ baseURL, apiKey });
  }

  /**
   * Skills the user may have auto-applied: their own + company-scope skills
   * shared with them. Visibility gating mirrors
   * KnowledgeIngestionService.searchAccessibleChunks (all / admins / teams),
   * with cross-tenant isolation on companyId. When `projectId` is given,
   * project-scoped skills linked to that project are also included (they apply
   * only when chatting in that project — mirrors KC project files). Only
   * active, embedded rows are returned — a null embedding means the async
   * backfill hasn't run yet, so the skill simply isn't routable until it does.
   */
  async getAccessibleSkills(
    userId: string,
    projectId?: string | null,
  ): Promise<RoutableSkill[]> {
    const [caller] = await this.db
      .select({ role: users.role, companyId: users.companyId })
      .from(users)
      .where(eq(users.id, userId));
    const isAdmin = caller?.role === 'admin';
    const callerCompanyId = caller?.companyId ?? null;

    // A company-scope skill is in the caller's tenant iff its owner shares
    // the caller's companyId. NULL companyId (personal account) → never sees
    // company skills.
    const sameCompany = callerCompanyId
      ? sql`EXISTS (
          SELECT 1 FROM ${users} owner
          WHERE owner.id = ${skills.userId}
            AND owner.company_id = ${callerCompanyId}
        )`
      : sql`FALSE`;

    const companyBranch = isAdmin
      ? and(
          eq(skills.scope, 'company'),
          sameCompany,
          // Project-scoped skills route ONLY via projectBranch (inside their
          // project) — even for an admin. Without this an admin sees every
          // project's project-scoped skill in every chat + the arena.
          sql`${skills.visibility} != 'project'`,
        )
      : or(
          and(
            eq(skills.scope, 'company'),
            eq(skills.visibility, 'all'),
            sameCompany,
          ),
          and(
            eq(skills.scope, 'company'),
            eq(skills.visibility, 'teams'),
            sameCompany,
            sql`EXISTS (
              SELECT 1 FROM skill_teams st
              INNER JOIN team_members tm ON tm.team_id = st.team_id
              WHERE st.skill_id = ${skills.id}
                AND tm.user_id = ${userId}
                AND tm.status = 'accepted'
            )`,
          ),
        );

    // A project-scoped skill is routable only when chatting in a project it's
    // linked to. The caller (chat) has already gated access to `projectId`, so
    // a link to it is sufficient — include such skills regardless of owner
    // (mirrors KC project files being shared with the project).
    const projectBranch = projectId
      ? and(
          eq(skills.visibility, 'project'),
          sql`EXISTS (
            SELECT 1 FROM skill_projects sp
            WHERE sp.skill_id = ${skills.id}
              AND sp.project_id = ${projectId}
          )`,
        )
      : sql`FALSE`;

    const rows = await this.db
      .select({
        id: skills.id,
        name: skills.name,
        description: skills.description,
        instructions: skills.instructions,
        descriptionEmbedding: skills.descriptionEmbedding,
      })
      .from(skills)
      .where(
        and(
          eq(skills.isActive, true),
          sql`${skills.descriptionEmbedding} IS NOT NULL`,
          // Own UNRESTRICTED skills (visibility 'all'/'admins') are always
          // routable. A scoped skill — even one you own — honours its scope:
          // a 'project' skill routes only inside its project (projectBranch),
          // and a 'teams' skill only via team membership (companyBranch). This
          // mirrors KC files and keeps the visibility the user picked actually
          // restrictive — otherwise the owner sees their team-/project-scoped
          // skill in every chat regardless of the team/project.
          or(
            and(
              eq(skills.userId, userId),
              sql`${skills.visibility} NOT IN ('project', 'teams')`,
            ),
            companyBranch,
            projectBranch,
          ),
        ),
      );

    return rows
      .filter((r): r is typeof r & { descriptionEmbedding: number[] } =>
        Array.isArray(r.descriptionEmbedding),
      )
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        instructions: r.instructions,
        descriptionEmbedding: r.descriptionEmbedding,
      }));
  }

  /**
   * Cosine similarity. Both the message vector and the skill-description
   * vector come from DocumentsService.embed with `normalize: true`, so they
   * are unit-length and cosine reduces to a dot product. We still divide by
   * the norms defensively in case an un-normalized vector ever sneaks in.
   */
  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * LLM-confirm (default-on): given the above-threshold candidates, ask a
   * cheap model which actually apply to the message. False positives are the
   * costlier error, so on any failure we fail CLOSED — drop the uncertain
   * candidates rather than inject a possibly-wrong skill.
   */
  private async confirmRelevance(
    userId: string,
    message: string,
    candidates: RoutableSkill[],
  ): Promise<Set<string>> {
    if (candidates.length === 0) return new Set();
    try {
      const client = await this.resolveConfirmClient(userId);
      if (!client) {
        this.logger.warn(
          'Skill confirm step skipped: no OpenRouter key resolved (BYOK/platform); dropping auto-candidates this turn.',
        );
        return new Set();
      }
      const list = candidates
        .map((c, i) => `${i + 1}. ${c.name}: ${c.description}`)
        .join('\n');
      const response = await client.chat.completions.create({
        model: CONFIRM_MODEL,
        messages: [
          {
            role: 'user',
            content:
              'You decide which "skills" (instruction sets) genuinely apply ' +
              'to a user message. Reply with ONLY a comma-separated list of ' +
              'the numbers that clearly apply, or "none". Be strict — when ' +
              'in doubt, leave it out.\n\n' +
              `Message:\n${message}\n\nSkills:\n${list}`,
          },
        ],
        // Generous cap: the answer is a few digits, but reasoning-capable
        // confirm models (e.g. gemini-2.5-flash) spend completion tokens on
        // internal thinking first. A tight cap (e.g. 20) starves the visible
        // answer → empty reply → every candidate silently rejected.
        max_completion_tokens: 1000,
      });
      const reply = response.choices[0]?.message?.content?.trim() ?? '';
      this.logger.debug(`Skill confirm reply: "${reply}"`);
      const picked = new Set<string>();
      for (const m of reply.matchAll(/\d+/g)) {
        const idx = Number(m[0]) - 1;
        if (idx >= 0 && idx < candidates.length) picked.add(candidates[idx].id);
      }
      return picked;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Skill confirm step failed; dropping auto-candidates this turn: ${msg}`,
      );
      return new Set();
    }
  }

  private async loadConversationSkills(
    conversationId: string,
  ): Promise<{ skillId: string; pinned: boolean }[]> {
    return this.db
      .select({
        skillId: conversationSkills.skillId,
        pinned: conversationSkills.pinned,
      })
      .from(conversationSkills)
      .where(eq(conversationSkills.conversationId, conversationId));
  }

  /** Persist newly auto-activated skills as sticky rows (idempotent). */
  private async persistSticky(
    conversationId: string,
    skillIds: string[],
  ): Promise<void> {
    if (skillIds.length === 0) return;
    await this.db
      .insert(conversationSkills)
      .values(skillIds.map((skillId) => ({ conversationId, skillId })))
      .onConflictDoNothing();
  }

  /**
   * Pick the skills to inject this turn. Union of:
   *   - pinned (request + persisted) — always included,
   *   - sticky (already active in this conversation) — always included,
   *   - auto — fresh matches above threshold, confirmed by the LLM, capped.
   * Newly auto-selected skills are persisted as sticky so they don't flicker
   * on later messages. Arena passes no conversationId → no sticky/persist.
   */
  async selectForMessage(params: SelectParams): Promise<SelectedSkill[]> {
    const { userId, queryEmbedding, conversationId, projectId } = params;
    const accessible = await this.getAccessibleSkills(userId, projectId);
    if (accessible.length === 0) return [];
    const byId = new Map(accessible.map((s) => [s.id, s]));

    // 1. Pinned + sticky from this conversation (+ request-supplied pins).
    const pinnedIds = new Set(params.pinnedSkillIds ?? []);
    const stickyIds = new Set<string>();
    if (conversationId) {
      for (const row of await this.loadConversationSkills(conversationId)) {
        if (row.pinned) pinnedIds.add(row.skillId);
        else stickyIds.add(row.skillId);
      }
    }

    // 2. Auto candidates: rank the rest by cosine, take top-K above threshold.
    const alreadyActive = new Set([...pinnedIds, ...stickyIds]);
    const ranked = accessible
      .filter((s) => !alreadyActive.has(s.id))
      .map((s) => ({
        skill: s,
        score: this.cosine(queryEmbedding, s.descriptionEmbedding),
      }))
      .filter((r) => r.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    // 3. LLM-confirm the candidates (default-on, fail-closed) when we have the
    //    message text; otherwise fall back to embedding-only selection.
    const confirmed = params.messageText
      ? await this.confirmRelevance(
          userId,
          params.messageText,
          ranked.map((r) => r.skill),
        )
      : null;

    const autoIds: string[] = [];
    for (const r of ranked) {
      if (autoIds.length >= MAX_AUTO_SKILLS) break;
      if (confirmed && !confirmed.has(r.skill.id)) continue;
      autoIds.push(r.skill.id);
    }

    // 4. Assemble, respecting the char budget. Pins first, then sticky, then
    //    auto, so the user's explicit choices survive truncation.
    const ordered: SelectedSkill[] = [];
    const pushIf = (id: string, reason: SelectedSkill['reason']) => {
      const s = byId.get(id);
      if (s)
        ordered.push({
          id: s.id,
          name: s.name,
          instructions: s.instructions,
          reason,
        });
    };
    for (const id of pinnedIds) pushIf(id, 'pinned');
    for (const id of stickyIds) pushIf(id, 'sticky');
    for (const id of autoIds) pushIf(id, 'auto');

    // The char budget is a HARD cap (protects the context window), so even a
    // pinned skill that overflows it on its own is dropped. Pins still come
    // first in `ordered`, so they get first claim on the budget.
    let budget = MAX_SKILL_CHARS;
    const kept: SelectedSkill[] = [];
    for (const s of ordered) {
      if (s.instructions.length > budget) {
        this.logger.debug(
          `Skill "${s.name}" dropped from context — char budget exhausted.`,
        );
        continue;
      }
      budget -= s.instructions.length;
      kept.push(s);
    }

    // 5. Persist as sticky only the freshly auto-selected skills that actually
    //    made it into the context this turn — a skill the budget dropped
    //    shouldn't reappear as "sticky" next turn having never influenced a
    //    response. Arena passes no conversationId → no persistence.
    if (conversationId) {
      const keptAuto = kept.filter((s) => s.reason === 'auto').map((s) => s.id);
      await this.persistSticky(conversationId, keptAuto);
    }

    return kept;
  }

  /** Render the selected skills as a single delimited context block to
   *  prepend to the chat/arena context. */
  renderContextBlock(selected: SelectedSkill[]): string {
    if (selected.length === 0) return '';
    const blocks = selected
      .map((s) => `## Skill: ${s.name}\n${s.instructions}`)
      .join('\n\n');
    return (
      'Apply the following skill instructions when they fit the request. ' +
      'They describe how this organization wants the task done.\n\n' +
      blocks
    );
  }
}
