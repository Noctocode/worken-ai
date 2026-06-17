import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
  index,
  uniqueIndex,
  boolean,
  jsonb,
  integer,
  real,
  numeric,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("basic"),
  // Subscription plan. New rows default to 'free'; existing rows get
  // 'free' too on the first `db:push` thanks to the default. Future
  // plans (e.g. 'pro', 'enterprise') will live on this column without
  // a schema change. Kept loose-typed for now — once we know the full
  // tier set we can lock it down with an enum.
  plan: text("plan").notNull().default("free"),
  inviteStatus: text("invite_status").notNull().default("active"),
  name: text("name"),
  picture: text("picture"),
  googleId: text("google_id").unique(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  verificationTokenHash: text("verification_token_hash"),
  verificationTokenExpiresAt: timestamp("verification_token_expires_at", {
    withTimezone: true,
  }),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", {
    withTimezone: true,
  }),
  profileType: text("profile_type"), // 'company' | 'personal' — null = not set yet
  // Tenant pointer. The source of truth for "which company tenant is
  // this user in". `companyName` / `industry` / `teamSize` below are
  // *display caches* on the user row — every read should treat
  // `company_id` as authoritative. NULL when the user hasn't picked
  // a company profile yet (mid-onboarding) or when profileType is
  // 'personal'. ON DELETE SET NULL so a company can be torn down
  // without nuking its members' user rows.
  companyId: uuid("company_id").references(() => companies.id, {
    onDelete: "set null",
  }),
  // Display caches written alongside `companyId` on onboarding /
  // invite. Kept on the user row to avoid joining `companies` on
  // every /auth/me, dashboard tile, or org-users listing. NOT the
  // tenant identifier — same name on two different `company_id`s is
  // legitimate (two distinct tenants that picked the same display
  // name), and these fields should never be used for filtering.
  companyName: text("company_name"),
  industry: text("industry"),
  teamSize: text("team_size"),
  infraChoice: text("infra_choice"), // 'managed' | 'on-premise'
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(0),
  openrouterKeyId: text("openrouter_key_id"),
  openrouterKeyEncrypted: text("openrouter_key_encrypted"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Reverse lookup: "every user in tenant X" — drives
  // /teams?tab=users and any future tenant-scoped query.
  index("users_company_id_idx").on(table.companyId),
]);

/**
 * Tenant identity. A `companies` row IS a tenant — UUID-based, so
 * two companies with the same display `name` are still two distinct
 * tenants (the user who picked a duplicate name on self-signup gets
 * their own UUID, isolated from the original tenant).
 *
 * Created in one of two places:
 *   - OnboardingService.completeInner when a self-signup completes
 *     step-6 with profileType='company'.
 *   - Invite flows (users/invite, teams/invite, project-direct
 *     invite) pre-create the user row pointing at the *inviter's*
 *     existing `companyId`. No new companies row in that case.
 *
 * Mutability: a tenant can rename itself (UPDATE companies.name) and
 * every member sees the new name on next refetch. The legacy
 * `users.companyName` cache is updated in lockstep on rename.
 */
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  industry: text("industry"),
  teamSize: text("team_size"),
  infraChoice: text("infra_choice"),
  // Tenant-scoped monthly budget cap (cents). Tri-state, mirrors the
  // legacy singleton `org_settings.monthly_budget_cents` which it
  // replaces:
  //   - NULL → no cap set for this tenant (chat-transport gate
  //     silent-passes; FE hides over-budget banner).
  //   - 0    → kill switch — every chat call in this tenant 402s
  //     with ORG_SUSPENDED. Tenant-scoped, so flipping the switch
  //     in tenant A no longer suspends tenant B.
  //   - >0   → enforced; the gate blocks when tenant spend +
  //     estimate >= cap.
  monthlyBudgetCents: integer("monthly_budget_cents"),
  // Org-wide default for whether projects may use OpenRouter web search.
  // Teams override via `teams.web_search_enabled`; effective capability
  // is `team.webSearchEnabled ?? company.webSearchEnabled`.
  webSearchEnabled: boolean("web_search_enabled").notNull().default(false),
  // Per-tenant toggle for executable skills (Option #3). Default OFF — the
  // subsystem stays dark until an admin opts the tenant in; an env
  // kill-switch can force it off everywhere regardless.
  executableSkillsEnabled: boolean("executable_skills_enabled")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  parentTeamId: uuid("parent_team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null" }),
  openrouterKeyId: text("openrouter_key_id"),
  openrouterKeyEncrypted: text("openrouter_key_encrypted"),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(1000),
  // Per-team override for the web-search capability. NULL → inherit the
  // org default (`companies.web_search_enabled`); true/false → force.
  webSearchEnabled: boolean("web_search_enabled"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id),
    email: text("email").notNull(),
    role: text("role").notNull(), // 'owner' | 'editor' | 'viewer'
    status: text("status").notNull().default("pending"), // 'pending' | 'accepted'
    invitationToken: text("invitation_token"),
    invitationStatus: text("invitation_status"), // 'pending' | 'accepted' | 'expired' | 'revoked' (null for legacy rows w/o invite)
    invitationExpiresAt: timestamp("invitation_expires_at", {
      withTimezone: true,
    }),
    invitationRevokedAt: timestamp("invitation_revoked_at", {
      withTimezone: true,
    }),
    // Per-member monthly spend cap, in cents, that gates this user's
    // chat calls billed against the team. NULL = no individual cap (the
    // member shares the team's overall budget freely). 0 = suspended for
    // this team. >0 = enforced cap, checked against the user's
    // current-month spend in observability_events filtered by teamId.
    //
    // Gate fires uniformly across every routing path — WorkenAI default,
    // team-scoped BYOK, team-scoped Custom LLM. The suspension state
    // (cap=0) and the already-cap-reached state apply regardless. Only
    // the *spend accumulation* effectively skips Custom routes: those
    // log cost_usd=null because the model has no catalog pricing, so
    // their usage doesn't add to the SUM the gate checks against.
    // Net effect: Custom usage doesn't consume the cap, but a suspended
    // or already-over-cap member is still blocked from Custom calls.
    monthlyCapCents: integer("monthly_cap_cents"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // A user can be in a team at most once. Partial because user_id is
    // nullable (invitations to emails without a registered account
    // store user_id = null until the invitee signs up + accepts) — and
    // multiple null rows must be allowed (different emails, same team).
    // Once user_id is set, the (team, user) pair is unique regardless
    // of status (pending vs accepted) so an admin can't accidentally
    // queue a second invite on top of an active membership.
    uniqueIndex("team_members_team_user_unique")
      .on(table.teamId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    teamId: uuid("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    model: text("model").notNull(),
    // Active agent preset the project currently chats as. Its preset maps
    // to `model` above; switching the active agent from the project header
    // updates both. Defaults to the general assistant for legacy rows.
    agent: text("agent").notNull().default("general-assistant"),
    // The pool of agent presets picked for this project at create time.
    // The active `agent` is one of these; the header dropdown switches
    // among them. Empty for legacy projects created before multi-agent
    // support — callers fall back to `[agent]` in that case.
    agents: jsonb("agents").$type<string[]>().notNull().default([]),
    // Per-project web search switch. Effective only when the resolved
    // capability (team ?? company) is enabled; the chat path then adds
    // `plugins: [{ id: "web" }]`.
    webSearch: boolean("web_search").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Project names are unique within their scope, case-insensitively.
    // Personal projects (team_id IS NULL) are scoped to the owner; team
    // projects to the team. These are the race-safe backstop behind the
    // friendly pre-check in ProjectsService — a 23505 here is translated
    // back into the same 409. Partial + lower() so the two scopes don't
    // interfere and "Foo" / " foo " collide.
    uniqueIndex("projects_personal_name_unique")
      .on(table.userId, sql`lower(trim(${table.name}))`)
      .where(sql`${table.teamId} IS NULL`),
    uniqueIndex("projects_team_name_unique")
      .on(table.teamId, sql`lower(trim(${table.name}))`)
      .where(sql`${table.teamId} IS NOT NULL`),
  ],
);

/**
 * Direct, ad-hoc project membership.
 *
 * The original access model was *transitive only*: a user could chat
 * on a project iff they were an accepted member of `projects.teamId`'s
 * team. That works for the common "every project belongs to a team
 * and every team member sees every project" case, but it can't
 * express "I want Sam from another team to join this single chat".
 * The Figma invite modal (179:16073) shows exactly that — a "Members"
 * group for the project's team plus an "Other" group for anyone else
 * the owner has pulled in.
 *
 * `ConversationsService.verifyProjectAccess` accepts either source —
 * team membership OR a row here — so adding rows is purely additive
 * and never narrows the existing access set.
 *
 * Roles mirror the team-member set ('admin', 'editor', 'viewer') so
 * the FE can render a single role dropdown shape regardless of where
 * a member came from. `addedBy` is a soft FK with `set null` so a
 * deactivated inviter doesn't yank everyone they ever added.
 */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull().default("editor"),
    addedBy: uuid("added_by").references(() => users.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    // Reverse lookup: "which projects does this user have direct
    // access to?" — drives the future /users/me/projects scope.
    index("project_members_user_idx").on(table.userId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id)
      .notNull(),
    groupId: uuid("group_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("documents_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .references(() => projects.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  title: text("title"),
  // 'personal' = private to the creator (`userId`); 'team' = shared with
  // everyone who can access the project. Set at creation (personal
  // projects force 'personal'); drives the Personal/Team sidebar filter
  // AND access control — see ConversationsService.verifyConversationAccess.
  scope: text("scope", { enum: ["personal", "team"] })
    .notNull()
    .default("personal"),
  // Free-form "Chat Context" the right-hand Project Details panel
  // (Figma 238:17561 → "Chat Context") shows and lets members edit.
  // Per-conversation: shared task framing / brief that's prepended to
  // the conversation, distinct from the project description.
  context: text("context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id").references(() => users.id),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Per-message 👍 / 👎 feedback from a chat participant.
 *
 * Composite PK on (messageId, userId) so the FE thumbs row reads as
 * "your vote on this message" — upsert semantics, one row per user
 * per message. The toggle-off case (clicking the same thumb twice)
 * is modelled by deleting the row rather than storing a null score,
 * so aggregates stay simple (`sum(score)` is a no-op for un-voted
 * messages, no NULL handling).
 *
 * `note` is reserved for a future "tell us more" prompt the FE could
 * surface after a thumbs-down. Nullable for now — wire-up later.
 */
export const messageFeedback = pgTable(
  "message_feedback",
  {
    messageId: uuid("message_id")
      .references(() => messages.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // -1 (thumbs down) or 1 (thumbs up). Kept as integer rather than
    // enum so a future "neutral / mixed" doesn't need a migration.
    score: integer("score").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.userId] }),
    // Aggregate by message — drives the future "this answer scored
    // +X / -Y across the team" badge on /observability.
    index("message_feedback_message_idx").on(table.messageId),
  ],
);

export const observabilityEvents = pgTable(
  "observability_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(), // 'arena_call' | 'evaluator_call' | 'guardrail_trigger' | future
    model: text("model"),
    provider: text("provider"), // 'openai' | 'anthropic' | 'google' | 'openrouter:other' | 'system'
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    promptPreview: text("prompt_preview"), // first 200 chars, never the full prompt
    metadata: jsonb("metadata"),            // small extras, e.g. { arenaRunId, guardrailId, severity }
    // Correlates the N upstream calls of one multi-call turn (executable
    // skills, Option #3) so spend/usage rolls up per turn. NULL for the
    // single-shot calls that exist today — additive, no behavior change.
    turnId: uuid("turn_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("observability_events_user_created_idx").on(table.userId, table.createdAt),
    index("observability_events_turn_idx").on(table.turnId),
    index("observability_events_team_created_idx").on(table.teamId, table.createdAt),
    index("observability_events_model_created_idx").on(table.model, table.createdAt),
    index("observability_events_type_created_idx").on(table.eventType, table.createdAt),
    // Org-wide spend aggregate runs on every chat call when an admin
    // has set a Company Monthly Budget — `assertOrgBudgetNotExceeded`
    // sums cost_usd filtered by success=true AND createdAt >=
    // date_trunc('month', now()). The existing per-user / per-team
    // indexes don't help (no user/team filter on this query), so a
    // dedicated partial index on (created_at) WHERE success = true
    // keeps the gate cheap as observability_events grows.
    index("observability_events_success_created_idx")
      .on(table.createdAt)
      .where(sql`${table.success} = true`),
  ],
);

export const arenaRuns = pgTable("arena_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  question: text("question").notNull(),
  expectedOutput: text("expected_output").notNull().default(""),
  models: jsonb("models").notNull(),
  responses: jsonb("responses").notNull(),
  comparison: jsonb("comparison").notNull(),
  // The "judge" model that scored this run's answers. Configurable
  // (env default ARENA_JUDGE_MODEL or a per-run UI selection); stored
  // so history shows which evaluator produced the scores. NULL for
  // legacy runs created before this column existed.
  judgeModel: text("judge_model"),
  // Model whose answer the user marked as best for this run. NULL = none.
  favoriteModel: text("favorite_model"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guardrails = pgTable("guardrails", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("medium"),
  triggers: integer("triggers").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Org-wide scope: when true, this rule applies to every chat by
  // every user in the owner's company (matched via users.company_name)
  // and the team links in `guardrail_teams` are ignored. Lets a
  // company admin enforce one rule across every team without N
  // explicit link rows.
  isOrgWide: boolean("is_org_wide").notNull().default(false),
  validatorType: text("validator_type"),
  entities: jsonb("entities"),
  // Free-form regex used by the `regex_match` validator. Nullable
  // since `no_pii` and `detect_jailbreak` rules don't need it. Kept
  // as text rather than serialised to a typed structure so admins
  // can paste patterns from elsewhere (PCRE-ish flavour, JS engine
  // does the actual matching).
  pattern: text("pattern"),
  target: text("target").notNull().default("both"),
  onFail: text("on_fail").notNull().default("fix"),
  templateSource: text("template_source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Many-to-many link between a guardrail and the teams it applies to.
 * Replaces the previous `guardrails.team_id` + `team_is_active`
 * columns so a single rule (e.g. "Hide email") can be shared across
 * multiple teams instead of belonging to exactly one.
 *
 * `is_active` is the per-team toggle the admin flips when they want
 * to pause a shared rule for one team without unassigning it. The
 * rule's master `guardrails.is_active` still wins — both must be true
 * for the evaluator to load it.
 */
export const guardrailTeams = pgTable(
  "guardrail_teams",
  {
    guardrailId: uuid("guardrail_id")
      .references(() => guardrails.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    isActive: boolean("is_active").notNull().default(true),
    assignedBy: uuid("assigned_by").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.guardrailId, table.teamId] }),
    teamLookup: index("guardrail_teams_team_idx").on(table.teamId),
  }),
);

// Legacy `user_llm_credentials` table dropped — see
// `packages/database/backfill/drop-legacy-user-llm-credentials.sql`.
// Onboarding step-5 keys now flow into the `integrations` table from
// commit 595f986 onwards.

/**
 * Per-user staged onboarding state. Survives sessionStorage loss
 * (browser crash, cookie clear, device switch) so a user who closed
 * the tab on step 4 can pick up where they left off on next login.
 *
 * Lives only until the user completes onboarding —
 * `OnboardingService.complete` deletes the row after the atomic
 * users/credentials/documents transaction commits. ON DELETE CASCADE
 * to users.id covers GDPR delete + admin user-removal as well.
 *
 * Stores the *non-sensitive* scalar fields gathered across steps 2–4:
 * profile type, company info (name / industry / team size), infra
 * choice. Step-5 API keys and step-6 file uploads stay out of the
 * draft on purpose — the keys are an XSS exfiltration vector if
 * persisted, and the files are large multipart uploads that don't
 * round-trip cleanly through a JSON column.
 */
export const onboardingDrafts = pgTable("onboarding_drafts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  partial: jsonb("partial").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chunked + embedded text from user-uploaded knowledge files.
// Cascade-delete on the parent `knowledge_files` row cleans up
// embeddings without orphan rows. Embedding dimensions match the
// existing `documents` table so chat RAG search can compose both
// sources (project documents + knowledge files) without re-
// projecting vectors.
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    fileId: uuid("file_id").references(() => knowledgeFiles.id, {
      onDelete: "cascade",
    }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 384 }),
    // Mirrored from the parent row's scope. Duplicating the value
    // keeps the chat-time RAG filter index-friendly (single WHERE,
    // no JOIN to either parent table) — RAG search runs on every
    // prompt, the saving adds up.
    scope: text("scope").notNull().default("personal"),
    // Mirrored from knowledge_files.visibility for the same reason
    // we duplicate scope: per-chat search must filter without a
    // JOIN to the parent file. 'all' / 'admins'; only meaningful
    // when scope='company'.
    visibility: text("visibility").notNull().default("all"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // HNSW for fast cosine similarity at chat time. Same shape as
    // documents_embedding_idx on the project-level documents table.
    index("knowledge_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    // Per-user filter is the most common access pattern (chat layer
    // looks up "what does this user know"). Composite with createdAt
    // so the same index serves "list latest chunks for user".
    index("knowledge_chunks_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    // Org-wide chunks fetched on every chat for every company user,
    // so an index on scope by itself pays for the writes. Two-value
    // column is fine here.
    index("knowledge_chunks_scope_idx").on(table.scope),
    // Look up chunks by parent file (delete-by-file, status check).
    index("knowledge_chunks_file_idx").on(table.fileId),
  ],
);

export const tenders = pgTable("tenders", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  organization: text("organization"),
  description: text("description"),
  category: text("category"),
  deadline: timestamp("deadline", { withTimezone: true }),
  value: text("value"),
  matchRate: integer("match_rate").default(0),
  status: text("status").notNull().default("Active"),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tenderRequirements = pgTable("tender_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenderId: uuid("tender_id")
    .references(() => tenders.id, { onDelete: "cascade" })
    .notNull(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  evidence: text("evidence"),
  source: text("source"),
  status: text("status").notNull().default("gap"),
  priority: text("priority").notNull().default("Medium"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tenderDocuments = pgTable("tender_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenderId: uuid("tender_id")
    .references(() => tenders.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  size: text("size"),
  fileType: text("file_type"),
  storagePath: text("storage_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tenderTeamMembers = pgTable("tender_team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenderId: uuid("tender_id")
    .references(() => tenders.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const knowledgeFolders = pgTable(
  "knowledge_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id")
      .references(() => users.id)
      .notNull(),
    // Self-referencing FK: when set, this folder lives inside another
    // folder; when NULL, it's a top-level folder (the only state
    // before migration 0005 introduced nesting). Cascade on delete
    // tears down the whole subtree — child folders go, and the
    // existing FK on knowledge_files.folder_id (also cascade) takes
    // every file under them.
    //
    // Drive import uses this to put "Google Drive > <DriveFolderName>"
    // so imports from many Drive folders don't pile into a single
    // mixed bag. Users can also create their own nested folders via
    // the FE.
    parentFolderId: uuid("parent_folder_id").references(
      (): AnyPgColumn => knowledgeFolders.id,
      { onDelete: "cascade" },
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Children of a given folder — the FE folder-detail view runs
    // this query on every navigation, and without an index it would
    // full-scan knowledge_folders.
    index("knowledge_folders_parent_idx").on(table.parentFolderId),
  ],
);

export const knowledgeFiles = pgTable("knowledge_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  folderId: uuid("folder_id")
    .references(() => knowledgeFolders.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  fileType: text("file_type"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storagePath: text("storage_path"),
  uploadedById: uuid("uploaded_by_id").references(() => users.id),
  // Where the file is in the chunk + embed pipeline. Chunks land
  // in knowledge_chunks with `fileId` set. Lifecycle: pending →
  // processing → done | failed. Image-only / unsupported types
  // gracefully fail with `ingestion_error` set; the file row + disk
  // copy stay so download keeps working.
  ingestionStatus: text("ingestion_status").notNull().default("pending"),
  ingestionError: text("ingestion_error"),
  ingestionCompletedAt: timestamp("ingestion_completed_at"),
  // Set to now() each time a worker claims this row (pending → processing).
  // The stalled-ingestion reaper reclaims `processing` rows whose claim is
  // older than the stale window (or NULL, i.e. orphaned before this column
  // existed) so a worker that died mid-ingest doesn't strand the file.
  claimedAt: timestamp("claimed_at"),
  // How many times the reaper has reclaimed this row. After a cap it goes
  // terminal `failed` rather than looping forever on a poison-pill file.
  attempts: integer("attempts").notNull().default(0),
  // True while this file is part of an import whose completion notification
  // hasn't fired yet. Set when an import-fed drain is kicked off; cleared
  // (and the notification sent) by whichever instance drains the last
  // flagged file. DB-backed rather than in-memory so it survives a
  // cross-instance / reaper handoff and fires exactly once.
  importNotify: boolean("import_notify").notNull().default(false),
  // RAG visibility at chat / arena time. Personal accounts →
  // uploader-only; company accounts → org-wide. Set from the
  // uploader's profileType at upload time.
  scope: text("scope").notNull().default("personal"),
  // Within company-scope, a second layer of gating:
  //   - 'all'    : every company user can pull these chunks at chat /
  //                arena time (default; matches pre-feature behaviour).
  //   - 'admins' : restricted to role='admin' (admin-only privilege).
  //   - 'teams'  : restricted to members of the team set in
  //                `knowledge_file_teams`. Empty link set === no one
  //                can read; the upload path validates non-empty.
  // The choice is exposed at upload time and is editable post-upload
  // via PATCH /knowledge-core/files/:id/visibility. Irrelevant for
  // scope='personal' (owner-only already), kept on every row for
  // shape uniformity + search-filter simplicity.
  visibility: text("visibility").notNull().default("all"),
  // Content hash (hex SHA-256) of the uploaded bytes. Used by the
  // upload path to skip files the same uploader already has elsewhere
  // in their Knowledge Core — we surface them as duplicates on the FE
  // instead of inserting another row. Nullable for legacy rows
  // uploaded before this column existed; those simply opt out of
  // duplicate detection until they're re-uploaded.
  contentSha256: text("content_sha256"),
  // Provenance: 'upload' for files added via the KC dropzone, 'drive'
  // for files imported from a connected Google Drive. Drives the
  // ingestion path (drive-source rows download from Drive before
  // parsing) and lets the FE render a small Drive badge next to the
  // file row.
  source: text("source").notNull().default("upload"),
  // External system's ID for this file. For source='drive' this is
  // Drive's `fileId`. Nullable for source='upload'. The partial
  // unique index below makes the same Drive file unimportable twice
  // by the same uploader.
  externalId: text("external_id"),
  // Direct link back to the file in its external system. For Drive
  // this is the `webViewLink` ("Open in Drive" button). Nullable
  // outside of source='drive'.
  externalUrl: text("external_url"),
  // SharePoint needs a (driveId, itemId) pair to download — itemId
  // alone is ambiguous across libraries. Drive / OneDrive rows leave
  // this NULL. Confluence rows set it to the space id — not needed for
  // download, but it keeps Confluence out of the Drive/OneDrive dedup
  // index below (which requires external_drive_id IS NULL), so a
  // Confluence page id that happens to equal a Drive file id for the
  // same user can't collide.
  externalDriveId: text("external_drive_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // Fast lookup for the upload-path dupe check: given an uploader and
  // a set of candidate hashes, find any pre-existing row. Two-column
  // index so the per-user scope is enforced in the same probe.
  index("knowledge_files_owner_hash_idx").on(
    table.uploadedById,
    table.contentSha256,
  ),
  // De-dupe import of the same Drive / OneDrive file by the same
  // user. Partial so upload-source rows (external_id NULL) don't
  // collide, AND so SharePoint rows fall through to the SP-specific
  // index below — SharePoint item ids are drive-scoped, while Drive
  // and OneDrive ids are globally unique within the user's scope
  // (Drive has no driveId concept; OneDrive is single-drive per
  // user). external_drive_id IS NULL is the predicate that
  // distinguishes them. Probed on every Drive / OneDrive import to
  // decide insert-vs-skip.
  uniqueIndex("knowledge_files_owner_external_unique")
    .on(table.uploadedById, table.externalId)
    .where(
      sql`${table.externalId} IS NOT NULL AND ${table.externalDriveId} IS NULL`,
    ),
  // De-dupe import of the same SharePoint file by the same user.
  // Unlike Drive / OneDrive, SharePoint item ids are drive-scoped
  // (the same itemId can appear in two different document libraries),
  // so the dedup key is the (driveId, itemId) PAIR. Non-overlapping
  // with the index above by design: SP rows always set
  // external_drive_id (so the upper index's predicate excludes them);
  // Drive / OneDrive rows always leave it NULL (so this index's
  // predicate excludes them via source='sharepoint'). Probed on every
  // SharePoint import to decide insert-vs-skip.
  uniqueIndex("knowledge_files_owner_sp_external_unique")
    .on(table.uploadedById, table.externalDriveId, table.externalId)
    .where(sql`${table.source} = 'sharepoint'`),
  // De-dupe import of the same Confluence page by the same user.
  // Confluence page ids are unique within the connected site, so the
  // key is just (uploaded_by_id, external_id). Source-scoped so it can't
  // collide with a Drive/OneDrive file id that happens to be the same
  // string — those rows live in the index above (external_drive_id IS
  // NULL), while Confluence rows set external_drive_id to the space id,
  // which excludes them from it. Probed on every Confluence import.
  uniqueIndex("knowledge_files_owner_confluence_external_unique")
    .on(table.uploadedById, table.externalId)
    .where(sql`${table.source} = 'confluence'`),
]);

// Many-to-many link between `projects` and `knowledge_files`. Lets
// a project "attach" KC files so the chat RAG for that project
// pulls those chunks in addition to its own `documents` rows.
// Replaces the old per-project upload destination — uploads from
// Manage Context now land in KC and get linked here.
//
// Cascade on both sides so a deleted project / file auto-cleans
// the link rows. (project_id, file_id) composite PK keeps the link
// inherently idempotent under repeat-attach attempts.
export const projectKnowledgeFiles = pgTable(
  "project_knowledge_files",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    fileId: uuid("file_id")
      .references(() => knowledgeFiles.id, { onDelete: "cascade" })
      .notNull(),
    attachedBy: uuid("attached_by").references(() => users.id),
    attachedAt: timestamp("attached_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.fileId] }),
    // Reverse lookup: "which projects reference this KC file?" —
    // useful for detach-on-file-delete UIs and audit.
    index("project_knowledge_files_file_idx").on(table.fileId),
  ],
);

// Many-to-many link between `knowledge_files` and `teams` for the
// `visibility = 'teams'` mode. Each row grants one team read access
// to the file at chat / arena time. Empty link set === no team can
// read the file; the upload path validates the array is non-empty
// when visibility='teams'. Cascade on both sides so deleting a file
// or a team auto-cleans the links — no orphans, no broken RAG.
export const knowledgeFileTeams = pgTable(
  "knowledge_file_teams",
  {
    fileId: uuid("file_id")
      .references(() => knowledgeFiles.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fileId, table.teamId] }),
    // Reverse lookup: "which files does team X get to see?" — used by
    // the team detail page and the chat-time membership check.
    index("knowledge_file_teams_team_idx").on(table.teamId),
  ],
);

export const shortcuts = pgTable("shortcuts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  label: text("label").notNull(),
  body: text("body").notNull(),
  category: text("category"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// In-app notification inbox. Mirrors the actionable subset of what
// the mail service sends (team / org invitations) plus auto-emitted
// info-only alerts (budget thresholds). Email stays as a parallel
// channel for now — both fire so we don't drop invites for users
// who never open the app.
//
// `type` is a loose-typed discriminator; `data` carries per-type
// payload (e.g. team_invite has { teamId, teamName, inviterName,
// invitationToken, memberId } so the FE can render Accept/Decline
// without an extra round-trip). Keeping the schema generic means
// future types (file_failed, guardrail_blocked, …) drop in without
// migrations.
//
// `status` lifecycle:
//   - 'pending'   : surfaced in the panel with action buttons live
//   - 'acted'     : user accepted/declined (or the row is otherwise
//                   resolved); keep the row visible for ~24h then
//                   age out of the default list
//   - 'dismissed' : user X'd the row, no action needed
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").notNull().default({}),
    status: text("status").notNull().default("pending"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Default list query: pending + acted for this user, newest
    // first. Covering for the common bell-popover fetch.
    index("notifications_user_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    // Unread badge probe — partial would be tighter but a regular
    // index on read_at suffices since the user_id filter narrows
    // the scan first.
    index("notifications_user_read_idx").on(table.userId, table.readAt),
  ],
);

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  title: text("title").notNull(),
  description: text("description"),
  body: text("body").notNull(),
  category: text("category"),
  tags: text("tags").array().notNull().default([]),
  variables: jsonb("variables").notNull().default([]),
  model: text("model"),
  temperature: real("temperature"),
  maxTokens: integer("max_tokens"),
  topP: real("top_p"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Instructional "skills" — reusable Markdown "how we do X here" recipes
// (e.g. "how we write client proposals") the chat/arena auto-selects per
// turn and injects into the model's context. Ownership mirrors `prompts`;
// scope/visibility mirror `knowledge_files` so org-provisioning through
// Teams/Company admin comes for free. NO executable scripts/sandbox here —
// that's a separate follow-up (see docs/skills-plan.md "Option #3").
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // Short label, e.g. "Client proposal".
    name: text("name").notNull(),
    // The routing trigger — "use this skill when…". Embedded + matched
    // against the user message; also shown in the skill picker.
    description: text("description").notNull(),
    // The SKILL.md body that gets injected into context when selected.
    instructions: text("instructions").notNull(),
    // Same semantics as knowledge_files.scope / visibility.
    scope: text("scope").notNull().default("personal"), // personal | company
    visibility: text("visibility").notNull().default("all"), // all | admins | teams | project
    isActive: boolean("is_active").notNull().default(true),
    source: text("source").notNull().default("manual"), // manual | import | executable
    // Executable-skill scripts/resources (Option #3) parsed from SKILL.md.
    // NULL for instructional (#2) skills. Stored as JSONB (small, read as a
    // unit) rather than a side table.
    scripts:
      jsonb("scripts").$type<
        {
          name: string;
          language: string;
          entrypoint?: boolean;
          content: string;
        }[]
      >(),
    // pgvector embedding of name+description for the Stage-1 prefilter.
    // Dim 384 = Xenova/all-MiniLM-L6-v2 (the same model DocumentsService.embed
    // uses for KC chunks — cosine is only meaningful within one model space).
    // NULLABLE on purpose: filled asynchronously after create (like the KC
    // ingest pipeline), and the router skips rows where it's still null
    // rather than blocking skill creation on the embedder.
    descriptionEmbedding: vector("description_embedding", { dimensions: 384 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Accessible-filter probe (scope + company visibility gate). NOT a
    // vector index — N (skills a user can see) is tiny, so the router
    // pulls the accessible set and cosine-ranks in memory; ivfflat/hnsw
    // would be needless complexity here.
    index("skills_scope_visibility_idx").on(table.scope, table.visibility),
    // Owner's "my skills" list (mirrors how prompts are listed per user).
    index("skills_user_idx").on(table.userId),
  ],
);

// Team gating for visibility='teams' — mirrors knowledge_file_teams.
export const skillTeams = pgTable(
  "skill_teams",
  {
    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.teamId] }),
    // Reverse lookup: "which skills does team X get?" — used by the
    // accessible-filter EXISTS probe at chat time.
    index("skill_teams_team_idx").on(table.teamId),
  ],
);

// Project gating for visibility='project' — mirrors project_knowledge_files.
// A project-scoped skill applies when anyone with access to the project
// chats IN that project (the chat carries projectId); it does not surface in
// other projects or in the (project-less) Model Arena. Cascade on both sides
// so deleting a skill or a project auto-cleans the links.
export const skillProjects = pgTable(
  "skill_projects",
  {
    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.projectId] }),
    // Reverse lookup: "which skills does project X get?" — the router's
    // accessible-filter EXISTS probe when chatting in a project.
    index("skill_projects_project_idx").on(table.projectId),
  ],
);

// Sticky skill selection per conversation. Skills are procedural ("how we
// write proposals") so they must not flicker: once a skill is auto-selected
// (or pinned) in a conversation it stays active for the rest of it, instead
// of re-rolling the embedding match on every message and "forgetting" the
// format mid-task. `pinned` distinguishes a user-forced skill (always
// included, bypasses the embedding threshold) from one that triggered
// automatically. Arena is stateless (single question) so it doesn't use
// this table — it selects per question.
export const conversationSkills = pgTable(
  "conversation_skills",
  {
    conversationId: uuid("conversation_id")
      .references(() => conversations.id, { onDelete: "cascade" })
      .notNull(),
    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.skillId] }),
  ],
);

// ── Executable skills (Option #3) ───────────────────────────────────
// One row per execution of an executable skill. Holds the multi-call
// agent loop's lifecycle + rolled-up cost. `turnId` correlates the run's
// upstream/tool calls in observability_events.
export const skillRuns = pgTable(
  "skill_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .references(() => skills.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // Set when launched from a chat; NULL when launched from /resources/skills.
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    // running | done | failed | cancelled
    status: text("status").notNull().default("running"),
    // The run's own id IS the turn-correlation id — it's written into
    // observability_events.turn_id so a run's N calls roll up. No separate
    // turn_id column (one run == one turn).
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    error: text("error"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("skill_runs_user_idx").on(table.userId, table.startedAt),
    index("skill_runs_skill_idx").on(table.skillId),
  ],
);

// Per-step trace of a run (one row per LLM / tool / script step). A real
// table (not JSONB) because steps are queried for observability.
export const skillRunSteps = pgTable(
  "skill_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .references(() => skillRuns.id, { onDelete: "cascade" })
      .notNull(),
    // Monotonic per-run order (created_at can tie within a ms).
    stepIndex: integer("step_index").notNull().default(0),
    stepType: text("step_type").notNull(), // llm | tool | script
    // tool name (tool steps) / script name (script steps); model id goes in
    // `model` below, not here.
    tool: text("tool"),
    // Model id for llm steps (dedicated column, mirrors observability_events).
    model: text("model"),
    inputPreview: text("input_preview"),
    outputPreview: text("output_preview"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    success: boolean("success").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("skill_run_steps_run_idx").on(table.runId, table.stepIndex)],
);

// Files produced by a sandboxed run (Phase D). `expiresAt` drives the
// retention reaper; `storagePath` lives under uploads/skill-artifacts/.
export const skillArtifacts = pgTable(
  "skill_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .references(() => skillRuns.id, { onDelete: "cascade" })
      .notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("skill_artifacts_run_idx").on(table.runId),
    index("skill_artifacts_expires_idx").on(table.expiresAt),
  ],
);

export const modelConfigs = pgTable("model_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  // When set, the alias is shared with every member of the team —
  // so a Custom LLM endpoint admin configured for TEAM_X is usable
  // by every member, not just admin. Cascade so deleting a team
  // also removes its aliases. NULL = user-personal alias (legacy).
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  customName: text("custom_name").notNull(),
  modelIdentifier: text("model_identifier").notNull(),
  // The real model id sent to the upstream endpoint's OpenAI-compatible
  // `chat/completions` call. Only set for Custom LLM aliases (where
  // `modelIdentifier` is a synthetic `user:…`/picker id that the endpoint
  // wouldn't recognise). NULL for predefined/catalog aliases, where
  // `modelIdentifier` IS already the upstream model id.
  upstreamModel: text("upstream_model"),
  isActive: boolean("is_active").notNull().default(true),
  fallbackModels: jsonb("fallback_models").notNull().default([]),
  // When set, chat calls for this alias route through the linked
  // integration (a Custom LLM the user registered in Management →
  // Integration). When null, routing falls back to BYOK (if the user
  // has a key for the alias's predefined provider) or OpenRouter.
  // ON DELETE SET NULL so deleting a Custom LLM doesn't delete aliases
  // pointing at it — they revert to OpenRouter routing.
  integrationId: uuid("integration_id").references(() => integrations.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Per-user (BYOK) configuration for third-party LLM providers.
 *
 * Two flavors share this table:
 *
 *  - **Predefined providers** (Gemini, ChatGPT, Deepseek, Mistral, Claude,
 *    Perplexity, Qwen, Copilot, Grok). The catalog of these lives as a
 *    BE constant — see apps/api/src/integrations/predefined-providers.ts.
 *    `apiUrl` is null for these (we use the provider's well-known endpoint
 *    on the BE side). Unique on (ownerId, providerId).
 *
 *  - **Custom LLMs** — anything OpenAI-API-compatible the user runs
 *    themselves (Ollama, vLLM, Together, Fireworks, …). `providerId`
 *    is the literal string "custom"; `apiUrl` is required.
 *
 * `apiKeyEncrypted` is the user's own key (BYOK). When null, calls fall
 * back to the workspace's WorkenAI / OpenRouter key.
 */
/**
 * Programmatic API tokens for external clients (CI/CD, scripts, mobile
 * apps, internal automations) that want to call the WorkenAI REST API
 * without going through the FE login flow. Each row is a single token
 * the user has minted; they can have many (one per integration / bot /
 * environment).
 *
 * Plaintext format: `sk-wai-<32 random chars>`. Only the SHA-256 hash
 * is stored — the JwtOrApiKeyGuard hashes the incoming `Authorization:
 * Bearer …` header and looks it up here. Revoked rows keep a non-null
 * `revoked_at` so audit logs survive after a user disables a key.
 *
 * `prefix` is the last 4 chars of the plaintext (e.g. "x9k2"), shown in
 * the My Keys table alongside `sk-wai-…` so the user can tell their
 * tokens apart without seeing the secret again.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    hash: text("hash").notNull(),
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (table) => [
    uniqueIndex("api_keys_hash_unique").on(table.hash),
    index("api_keys_owner_idx").on(table.ownerId),
  ],
);

/** One Azure OpenAI deployment the user has created in their resource.
 *  `deploymentName` is the Azure-side name (used as the `model` arg on
 *  the wire); `label` is what we show in the model picker. */
export type AzureDeployment = { deploymentName: string; label: string };

/** Provider-specific config that doesn't fit the flat columns. Empty
 *  `{}` for every provider except Azure OpenAI, which needs a
 *  per-resource endpoint, an api-version, and the list of deployments
 *  to surface as selectable models. Not secret (all visible in the
 *  Azure portal), so stored as plaintext JSON — only the API key in
 *  `apiKeyEncrypted` is encrypted. */
export type IntegrationConfig = {
  azureEndpoint?: string;
  azureApiVersion?: string;
  azureDeployments?: AzureDeployment[];
};

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Who configured this row. Always set — even on team-scoped rows,
    // where it tracks the admin who provisioned the team key for audit.
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // When set, this integration is *team-scoped*: every member of the
    // team sees the BYOK key (team-shared Anthropic key etc.). When
    // null, the integration is owner-personal (legacy behaviour).
    // Cascade so removing a team also drops its provisioned BYOK keys.
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    apiUrl: text("api_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Provider-specific extras (Azure endpoint / api-version /
    // deployments). `{}` for every other provider. Azure keeps
    // `apiUrl` NULL so it stays covered by the predefined unique
    // indexes below — its endpoint lives here, not in `apiUrl`.
    config: jsonb("config").$type<IntegrationConfig>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Partial unique index: at most one row per (owner, predefined
    // provider) for *personal* (non-team) BYOK. Custom LLMs share
    // `providerId='custom'` and need to stay non-unique (a user can
    // register many custom endpoints), so the WHERE clause excludes
    // them via `api_url IS NULL`. team_id IS NULL guards against
    // collision with team-scoped rows owned by the same admin.
    //
    // Without this, IntegrationsService.upsert (select-then-insert) is
    // racy under concurrent saves and could land two predefined rows
    // for the same provider; the BYOK lookup would then silently pick
    // whichever the planner returns first.
    uniqueIndex("integrations_owner_provider_predef_unique")
      .on(table.ownerId, table.providerId)
      .where(sql`${table.apiUrl} IS NULL AND ${table.teamId} IS NULL`),
    // Team-scoped predefined integration uniqueness: at most one row
    // per (team, predefined provider). Two admins should not be able
    // to land conflicting Anthropic keys on the same team.
    uniqueIndex("integrations_team_provider_predef_unique")
      .on(table.teamId, table.providerId)
      .where(sql`${table.apiUrl} IS NULL AND ${table.teamId} IS NOT NULL`),
  ],
);

// Many-to-many link between `teams` and `integrations`. Lets an admin
// configure a BYOK key once in their personal Integration tab and then
// link it into one or more teams, instead of duplicating the encrypted
// key into a separate team-scoped `integrations` row per team.
//
// `isEnabled` is per-link so an admin can temporarily disable a key's
// use on a single team without affecting other teams that share the
// same underlying integration. The underlying `integrations.isEnabled`
// is the "is the personal key on at all" master switch; both must be
// true for chat-time routing to surface this key for a team.
//
// The link table replaces the legacy pattern of putting `team_id` on
// `integrations` directly. Existing team-scoped rows still work for
// reads during the transition, but new ones are not created — the
// picker on the team-details page now writes to this table instead.
export const teamIntegrationLinks = pgTable(
  "team_integration_links",
  {
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    integrationId: uuid("integration_id")
      .references(() => integrations.id, { onDelete: "cascade" })
      .notNull(),
    // Per-link enable flag — distinct from `integrations.isEnabled` so
    // pausing one team's access to a shared key doesn't take the key
    // off for the admin's personal use or for other teams.
    isEnabled: boolean("is_enabled").notNull().default(true),
    // Audit only — who added this link. Set to null on the actor's
    // user delete so we don't cascade-remove the link itself; the link
    // outlives the actor.
    linkedBy: uuid("linked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    linkedAt: timestamp("linked_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.integrationId] }),
    // Reverse lookup: "which teams link this integration?" — used when
    // the admin updates / disables an integration so we can flag
    // affected teams in the UI.
    index("team_integration_links_integration_idx").on(table.integrationId),
    // Per-team-per-provider uniqueness is enforced in service code
    // (TeamsService.setIntegrationLinks) rather than at the DB level:
    // the constraint depends on the JOINed integrations.provider_id,
    // which can't be expressed in a single partial index. Service-side
    // it's a select-then-throw inside the link-set transaction.
  ],
);

// Org-level singleton settings. The Company tab on the FE renders a
// "Company Monthly Budget" target the admin sets here; future org-wide
// flags (logo URL, default infraChoice, branding overrides…) will land
// on the same row instead of needing one table per setting. We don't
// enforce singleton via a partial unique index — the get/upsert logic
// in the service deterministically reads the oldest row, so an
// accidental second row would just be hidden, not cause data loss.
//
// monthlyBudgetCents follows the same tri-state shape as
// team_members.monthlyCapCents:
//   - NULL → no company target set (chat-transport gate is a silent
//     pass, UI shows "No target set" + hides over-budget banner /
//     projected pill). Default for fresh deployments and lazy-seeded
//     rows so existing installs that never open the Company tab
//     keep working unchanged.
//   - 0    → org-wide chat suspended (every chat call hits the gate
//     and 402s with ORG_SUSPENDED). Same semantics as team /
//     member 0 — a deliberate kill switch admins can flip when
//     something goes wrong.
//   - >0   → enforced. Gate blocks when org spend + estimate >= cap.
export const orgSettings = pgTable("org_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  monthlyBudgetCents: integer("monthly_budget_cents"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Provider-agnostic OAuth token store. The first provider hooked up
 * here is `google_drive` (Knowledge Core → "Connect Google Drive"),
 * but the table is shaped for OneDrive / Dropbox / etc. to slot in
 * later under the same row layout.
 *
 * Distinct from `integrations` (BYOK LLM keys): OAuth needs an
 * access/refresh pair, an expiry timestamp, and a reauth-required
 * state machine, none of which fit the single-string
 * `apiKeyEncrypted` shape that BYOK uses. Tokens are encrypted at
 * rest via the same `EncryptionService` (AES-256-GCM, `v1:` prefix)
 * that wraps BYOK keys.
 *
 * The Google sign-in flow (auth/google.strategy.ts) is *separate*
 * from this — sign-in requests only `email + profile` and stores
 * the resulting `googleId` directly on `users`. This table is
 * populated by an incremental-authorization flow that requests
 * `drive.readonly` on top of the existing grant when the user
 * clicks "Connect Google Drive".
 */
export const oauthConnections = pgTable(
  "oauth_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // 'google_drive' for now. New providers add their own string
    // here (e.g. 'microsoft_graph', 'dropbox') — service code
    // dispatches on this column.
    provider: text("provider").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    // Drive may omit refresh_token on re-consent if the user already
    // granted offline access for this client. We request
    // `prompt=consent` on every connect to force a fresh refresh
    // token, but the column stays nullable so the code path is safe
    // under Google's edge cases.
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    // Space-separated scopes that were ACTUALLY granted (Google can
    // return a subset of what we requested). Compared against the
    // provider's required scope set when deciding whether the
    // connection is usable.
    scope: text("scope").notNull(),
    // When `accessToken` expires. Refresh fires automatically when
    // expires_at < now() + 60s on the next API call — see
    // `GoogleDriveOAuthService.getValidAccessToken`.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Display cache of the connected Google account's email. Shown
    // in the FE status chip ("Connected as petra@…"). Not used for
    // routing — `ownerId` is the source of truth.
    accountEmail: text("account_email"),
    // 'active' | 'reauth_required'. Flipped to `reauth_required`
    // when a refresh attempt fails (user revoked the grant in
    // Google account settings, etc.); FE shows a "Reconnect" prompt
    // then instead of the normal "Import from Drive" button.
    status: text("status").notNull().default("active"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Per-product enable flags. For the Microsoft provider, a single
    // row backs BOTH the SharePoint and OneDrive UI sections — the
    // user can opt into each independently via this flag map. Default
    // empty for non-Microsoft providers (Google Drive ignores it).
    //
    // Shape: { sharepoint?: boolean; onedrive?: boolean }
    features: jsonb("features")
      .$type<{ sharepoint?: boolean; onedrive?: boolean }>()
      .notNull()
      .default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // One connection per (owner, provider) — reconnecting replaces
    // the existing row, doesn't accumulate duplicates.
    uniqueIndex("oauth_connections_owner_provider_unique").on(
      table.ownerId,
      table.provider,
    ),
  ],
);

/**
 * Per-folder (or whole-drive) record of what's been imported from a
 * connected `oauthConnection`. Drives the FE Re-sync UI:
 *   - One row per imported folder = one "Re-sync" button in the
 *     Knowledge Core page.
 *   - `scope = 'all'` represents a "whole Drive" import; capped at
 *     one row per owner via the partial unique index.
 *   - `scope = 'folder'` rows hold `driveFolderId`; capped at one
 *     row per (owner, folder) so re-importing the same folder
 *     becomes a no-op the second time and the FE collapses to a
 *     single Re-sync entry.
 *
 * Detaching a source removes the record but leaves the imported
 * `knowledge_files` rows in place — the user removes those via the
 * normal KC delete path. Re-sync only adds NEW files (matched by
 * `external_id`); existing rows are not re-ingested even if the
 * Drive copy changed (an explicit "re-ingest" path can be added
 * later if needed).
 */
export const driveImportSources = pgTable(
  "drive_import_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    connectionId: uuid("connection_id")
      .references(() => oauthConnections.id, { onDelete: "cascade" })
      .notNull(),
    // 'all' for "Entire Drive" imports, 'folder' for a specific
    // folder. Keeps the FE dispatch simple (no NULL checks on the
    // folder id, just a `scope === 'all'` branch).
    scope: text("scope").notNull(),
    // Drive's `fileId` for the imported folder. NULL when
    // scope='all' — Drive's root doesn't have a stable `fileId` we
    // can rely on across "My Drive" / "Shared with me", so we walk
    // the tree from `about.get.user.rootFolderId` at sync time
    // instead.
    driveFolderId: text("drive_folder_id"),
    // Display name shown in the Re-sync UI. 'My Drive' for
    // scope='all'. Cached at import time; not refreshed on rename
    // in Drive (a future PR can pull this on each Re-sync if it
    // becomes a real complaint).
    driveFolderName: text("drive_folder_name").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // How many KC files this source produced on its last sync.
    // Used by the FE chip ("12 files imported"). Recomputed on
    // every Re-sync.
    fileCountAtLastSync: integer("file_count_at_last_sync")
      .notNull()
      .default(0),
    // Visibility applied to files imported from this source. Stored
    // so Re-sync can reproduce the original setting without asking the
    // user again. Defaults to 'all'.
    visibility: text("visibility").notNull().default('all'),
    // JSON-serialised string[] — team / project ids that files from
    // this source should be linked to. NULL unless visibility is
    // 'teams' or 'project'.
    teamIds: jsonb("team_ids").$type<string[]>(),
    projectIds: jsonb("project_ids").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // At most one source per (owner, drive_folder_id). The second
    // import of the same folder folds into the existing row as a
    // Re-sync, not a duplicate.
    uniqueIndex("drive_import_sources_owner_folder_unique")
      .on(table.ownerId, table.driveFolderId)
      .where(sql`${table.driveFolderId} IS NOT NULL`),
    // At most one "Entire Drive" source per owner — same idea but
    // for scope='all' where drive_folder_id is NULL.
    uniqueIndex("drive_import_sources_owner_all_unique")
      .on(table.ownerId)
      .where(sql`${table.scope} = 'all'`),
  ],
);

/**
 * Per-site / per-folder record of what's been imported from a
 * connected SharePoint (Microsoft Graph) account. Parallels
 * `driveImportSources` but the hierarchy is one level deeper
 * (site → drive/library → folder), so the row carries siteId,
 * driveId, and folderId — only siteId is required.
 *
 *   - `scope = 'site'`  : whole-site import (BFS across every drive
 *     in the site). One row per (owner, siteId) via the partial
 *     unique index.
 *   - `scope = 'folder'`: a specific folder inside a specific drive
 *     inside a site. One row per (owner, siteId, driveId, folderId).
 *
 * Re-sync semantics match Drive: only NEW files are added (dedup by
 * the `(uploaded_by_id, external_drive_id, external_id)` triple on
 * `knowledge_files` — see the `knowledge_files_owner_sp_external_unique`
 * partial unique index added in migration 0006), existing rows stay
 * put even if the SharePoint copy changed.
 *
 * Defer (low value): a CHECK constraint enforcing the scope/column
 * invariant (`scope='site' → drive_id/folder_id NULL`, inverse for
 * folder). The import code already enforces this — a CHECK only
 * guards against future hand-written SQL.
 */
export const sharepointImportSources = pgTable(
  "sharepoint_import_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    connectionId: uuid("connection_id")
      .references(() => oauthConnections.id, { onDelete: "cascade" })
      .notNull(),
    // 'site' for a whole-site import, 'folder' for a specific folder
    // inside a specific drive.
    scope: text("scope").notNull(),
    // SharePoint site id (Graph's `sites/{id}` value). Always set —
    // every import is anchored to a site.
    siteId: text("site_id").notNull(),
    // Display cache of the site's `displayName`. Shown in the
    // Re-sync UI and used as the KC child-folder name for site-scope
    // imports.
    siteName: text("site_name").notNull(),
    // SharePoint drive (document library) id. NULL when scope='site'
    // (the import spans every drive on the site).
    driveId: text("drive_id"),
    // Display cache of the drive's `name`. NULL when scope='site'.
    driveName: text("drive_name"),
    // SharePoint item id of the folder being imported. NULL when
    // scope='site'.
    folderId: text("folder_id"),
    // Display cache of the folder name. NULL when scope='site'.
    folderName: text("folder_name"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    fileCountAtLastSync: integer("file_count_at_last_sync")
      .notNull()
      .default(0),
    visibility: text("visibility").notNull().default("all"),
    teamIds: jsonb("team_ids").$type<string[]>(),
    projectIds: jsonb("project_ids").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // At most one whole-site source per (owner, site).
    uniqueIndex("sharepoint_import_sources_owner_site_unique")
      .on(table.ownerId, table.siteId)
      .where(sql`${table.scope} = 'site'`),
    // At most one folder source per (owner, site, drive, folder).
    uniqueIndex("sharepoint_import_sources_owner_folder_unique")
      .on(table.ownerId, table.siteId, table.driveId, table.folderId)
      .where(sql`${table.scope} = 'folder'`),
  ],
);

/**
 * Per-folder (or whole-OneDrive) record of what's been imported from
 * a user's OneDrive for Business. Direct mirror of
 * `driveImportSources` (single-drive structure — OneDrive has no
 * site/library hierarchy), with `onedrive_folder_id` storing the
 * Graph driveItem id for folder-scope imports.
 *
 * Re-sync semantics match Drive: only NEW files are added (dedup by
 * `knowledge_files.external_id` = OneDrive item id; external_id is
 * unique per user because each user has a single `/me/drive`),
 * existing rows stay put even if the OneDrive copy changed.
 */
export const onedriveImportSources = pgTable(
  "onedrive_import_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    connectionId: uuid("connection_id")
      .references(() => oauthConnections.id, { onDelete: "cascade" })
      .notNull(),
    // 'all' for "Entire OneDrive" imports, 'folder' for a specific
    // folder. NULL onedriveFolderId is allowed only when scope='all'.
    scope: text("scope").notNull(),
    onedriveFolderId: text("onedrive_folder_id"),
    onedriveFolderName: text("onedrive_folder_name").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    fileCountAtLastSync: integer("file_count_at_last_sync")
      .notNull()
      .default(0),
    visibility: text("visibility").notNull().default("all"),
    teamIds: jsonb("team_ids").$type<string[]>(),
    projectIds: jsonb("project_ids").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // At most one source per (owner, folder) — re-imports of the same
    // OneDrive folder fold into the existing row as a Re-sync.
    uniqueIndex("onedrive_import_sources_owner_folder_unique")
      .on(table.ownerId, table.onedriveFolderId)
      .where(sql`${table.onedriveFolderId} IS NOT NULL`),
    // At most one whole-OneDrive source per owner.
    uniqueIndex("onedrive_import_sources_owner_all_unique")
      .on(table.ownerId)
      .where(sql`${table.scope} = 'all'`),
  ],
);

/**
 * Per-space / per-page record of what's been imported from a connected
 * Confluence (Atlassian) site. Parallels `driveImportSources` but the
 * hierarchy is space → page (pages form a tree), so a row carries spaceId
 * plus an optional pageId:
 *
 *   - `scope = 'space'`: whole-space import (every current page in the
 *     space). One row per (owner, spaceId) via the partial unique index.
 *   - `scope = 'page'` : a specific page and its descendant pages. One row
 *     per (owner, spaceId, pageId).
 *
 * Re-sync semantics match Drive: only NEW pages are added (dedup by
 * `knowledge_files.external_id` = Confluence page id, which is unique within
 * a site; external_drive_id stays NULL so Confluence rows share the
 * Drive/OneDrive `knowledge_files_owner_external_unique` index). Existing
 * rows stay put even if the Confluence page changed.
 */
export const confluenceImportSources = pgTable(
  "confluence_import_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    connectionId: uuid("connection_id")
      .references(() => oauthConnections.id, { onDelete: "cascade" })
      .notNull(),
    // 'space' for a whole-space import, 'page' for a specific page subtree.
    scope: text("scope").notNull(),
    // Confluence v2 space id. Always set — every import is anchored to a space.
    spaceId: text("space_id").notNull(),
    // Space key (e.g. "ENG"). Display + web-link cache.
    spaceKey: text("space_key").notNull(),
    // Display cache of the space name; also used as the KC child-folder name.
    spaceName: text("space_name").notNull(),
    // Confluence page id of the imported page. NULL when scope='space'.
    pageId: text("page_id"),
    // Display cache of the page title. NULL when scope='space'.
    pageTitle: text("page_title"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    fileCountAtLastSync: integer("file_count_at_last_sync")
      .notNull()
      .default(0),
    visibility: text("visibility").notNull().default("all"),
    teamIds: jsonb("team_ids").$type<string[]>(),
    projectIds: jsonb("project_ids").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // At most one whole-space source per (owner, space).
    uniqueIndex("confluence_import_sources_owner_space_unique")
      .on(table.ownerId, table.spaceId)
      .where(sql`${table.scope} = 'space'`),
    // At most one page source per (owner, space, page).
    uniqueIndex("confluence_import_sources_owner_page_unique")
      .on(table.ownerId, table.spaceId, table.pageId)
      .where(sql`${table.scope} = 'page'`),
  ],
);
