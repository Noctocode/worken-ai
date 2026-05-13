import { sql } from "drizzle-orm";
import {
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
  // Onboarding fields (populated in a single transaction when the user
  // completes the /setup-profile wizard). Nullable while onboarding is
  // incomplete.
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
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  parentTeamId: uuid("parent_team_id").references(() => teams.id, { onDelete: "set null" }),
  openrouterKeyId: text("openrouter_key_id"),
  openrouterKeyEncrypted: text("openrouter_key_encrypted"),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(1000),
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

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  model: text("model").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("observability_events_user_created_idx").on(table.userId, table.createdAt),
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

export const knowledgeFolders = pgTable("knowledge_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // Fast lookup for the upload-path dupe check: given an uploader and
  // a set of candidate hashes, find any pre-existing row. Two-column
  // index so the per-user scope is enforced in the same probe.
  index("knowledge_files_owner_hash_idx").on(
    table.uploadedById,
    table.contentSha256,
  ),
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

// Admin-managed allowlist of OpenRouter models that end users can pick from
// in the various model dropdowns (project create, compare-models, …).
// The full OpenRouter catalog is fetched live; this table flips the visible
// subset on/off without a deploy. Membership = enabled.
export const enabledModels = pgTable("enabled_models", {
  modelIdentifier: text("model_identifier").primaryKey(),
  enabledById: uuid("enabled_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  enabledAt: timestamp("enabled_at").defaultNow().notNull(),
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
