import {
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
  index,
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

export const teamMembers = pgTable("team_members", {
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
  invitationExpiresAt: timestamp("invitation_expires_at", { withTimezone: true }),
  invitationRevokedAt: timestamp("invitation_revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const userLlmCredentials = pgTable("user_llm_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  provider: text("provider").notNull(), // 'openai' | 'azure' | 'anthropic' | 'private-vpc'
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  customName: text("custom_name").notNull(),
  modelIdentifier: text("model_identifier").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  fallbackModels: jsonb("fallback_models").notNull().default([]),
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
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  providerId: text("provider_id").notNull(),
  apiUrl: text("api_url"),
  apiKeyEncrypted: text("api_key_encrypted"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
