import { sql } from "drizzle-orm";
import {
  pgTable,
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
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("medium"),
  triggers: integer("triggers").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  teamIsActive: boolean("team_is_active").notNull().default(true),
  validatorType: text("validator_type"),
  entities: jsonb("entities"),
  target: text("target").notNull().default("both"),
  onFail: text("on_fail").notNull().default("fix"),
  templateSource: text("template_source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
// Default monthlyBudgetCents=0 means "no company target set" (UI hides
// over-budget banner / projected pill until admin types a number). A
// future hard-cap gate in chat-transport may treat 0 differently
// (likely "unlimited" to avoid breaking deployments that never set
// one) — settled when phase 2 lands.
export const orgSettings = pgTable("org_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
