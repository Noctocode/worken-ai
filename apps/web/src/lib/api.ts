const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ApiFetchOptions extends RequestInit {
  // Pass true on public pages (e.g. /invite) where an unauthenticated 401
  // is an expected outcome, not a session expiry. The caller handles the
  // response itself instead of being bounced to /login.
  skipAuthRedirect?: boolean;
}

export async function apiFetch(
  input: string,
  init?: ApiFetchOptions,
): Promise<Response> {
  const { skipAuthRedirect, ...fetchInit } = init ?? {};
  const res = await fetch(`${BASE_URL}${input}`, {
    ...fetchInit,
    credentials: "include",
  });

  if (res.status === 401) {
    // Try refreshing the token
    const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });

    if (refreshRes.ok) {
      // Retry the original request
      return fetch(`${BASE_URL}${input}`, {
        ...fetchInit,
        credentials: "include",
      });
    }

    if (skipAuthRedirect) {
      return res;
    }

    // Refresh failed — redirect to login
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  return res;
}

export interface User {
  id: string;
  email: string;
  role: "admin" | "advanced" | "basic";
  inviteStatus: "active" | "pending";
  name: string | null;
  picture: string | null;
  emailVerified: boolean;
  profileType: "company" | "personal" | null;
  onboardingCompleted: boolean;
  canCreateProject: boolean;
}

export async function fetchCurrentUser(): Promise<User> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

// Public-page variant: returns null when the visitor isn't signed in,
// instead of redirecting them to /login.
export async function fetchCurrentUserOptional(): Promise<User | null> {
  const res = await apiFetch("/auth/me", { skipAuthRedirect: true });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json();
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

export interface AuthUserSummary {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export type SignupResponse =
  | { verified: true; user: AuthUserSummary }
  | { verified: false; email: string; message: string };

export class AuthApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.code = code;
  }
}

async function parseAuthError(res: Response): Promise<AuthApiError> {
  const body = await res.json().catch(() => ({}));
  let message = "Something went wrong";
  if (typeof body?.message === "string") message = body.message;
  else if (Array.isArray(body?.message)) message = body.message.join(", ");
  const code = typeof body?.code === "string" ? body.code : undefined;
  return new AuthApiError(message, code);
}

export async function signupWithPassword(input: {
  email: string;
  password: string;
  name: string;
  token?: string;
}): Promise<SignupResponse> {
  const res = await apiFetch("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    skipAuthRedirect: true,
  });
  if (!res.ok) throw await parseAuthError(res);
  return res.json();
}

export async function resendVerificationEmail(email: string): Promise<void> {
  const res = await apiFetch("/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    skipAuthRedirect: true,
  });
  if (!res.ok) throw await parseAuthError(res);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await apiFetch("/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    skipAuthRedirect: true,
  });
  if (!res.ok) throw await parseAuthError(res);
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  const res = await apiFetch("/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
    skipAuthRedirect: true,
  });
  if (!res.ok) throw await parseAuthError(res);
}

export async function setProfileType(
  profileType: "company" | "personal",
): Promise<User> {
  const res = await apiFetch("/auth/profile-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileType }),
  });
  if (!res.ok) throw new Error("Failed to save profile type");
  return res.json();
}

export interface LoginResponse {
  user: AuthUserSummary;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    skipAuthRedirect: true,
  });
  if (!res.ok) throw await parseAuthError(res);
  return res.json();
}

// Projects

export interface Project {
  id: string;
  name: string;
  description: string | null;
  model: string;
  status: string;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  model: string;
  teamId?: string;
}

export async function fetchProjects(
  filter: "all" | "personal" | "team" = "all",
): Promise<Project[]> {
  const res = await apiFetch(`/projects?filter=${filter}`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(id: string): Promise<Project> {
  const res = await apiFetch(`/projects/${id}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const res = await apiFetch("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create project");
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch(`/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
}

// Documents

export interface Document {
  id: string;
  content: string;
  createdAt: string;
}

export async function createDocument(
  projectId: string,
  content: string,
): Promise<Document[]> {
  const res = await apiFetch(`/projects/${projectId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to create document");
  return res.json();
}

export async function fetchDocuments(projectId: string): Promise<Document[]> {
  const res = await apiFetch(`/projects/${projectId}/documents`);
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}

export interface DocumentGroup {
  groupId: string;
  title: string;
  createdAt: string;
  chunkCount: number;
}

export async function fetchDocumentGroups(
  projectId: string,
): Promise<DocumentGroup[]> {
  const res = await apiFetch(`/projects/${projectId}/documents/groups`);
  if (!res.ok) throw new Error("Failed to fetch document groups");
  return res.json();
}

export async function deleteDocumentGroup(
  projectId: string,
  groupId: string,
): Promise<void> {
  const res = await apiFetch(
    `/projects/${projectId}/documents/groups/${groupId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete document group");
}

export async function uploadDocumentFile(
  projectId: string,
  file: File,
): Promise<Document[]> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(`/projects/${projectId}/documents/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to upload document file");
  }
  return res.json();
}

// Teams

export interface Team {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  monthlyBudgetCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeamListItem extends Team {
  memberCount: number;
  members: { name: string | null; picture: string | null }[];
  spentCents: number;
  projectedCents: number;
  canManage: boolean;
}

export interface TeamMember {
  id: string;
  email: string;
  role: "owner" | "editor" | "viewer";
  status: "pending" | "accepted";
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userPicture: string | null;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
  spentCents: number;
  projectedCents: number;
}

export async function fetchTeams(): Promise<TeamListItem[]> {
  const res = await apiFetch("/teams");
  if (!res.ok) throw new Error("Failed to fetch teams");
  return res.json();
}

export async function fetchTeam(id: string): Promise<TeamWithMembers> {
  const res = await apiFetch(`/teams/${id}`);
  if (!res.ok) throw new Error("Failed to fetch team");
  return res.json();
}

export async function deleteTeam(id: string): Promise<void> {
  const res = await apiFetch(`/teams/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to delete team");
  }
}

export async function updateTeam(
  id: string,
  data: { name?: string; description?: string },
): Promise<Team> {
  const res = await apiFetch(`/teams/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update team");
  return res.json();
}

export async function createTeam(data: {
  name: string;
  description?: string;
  monthlyBudget?: number;
  parentTeamId?: string;
}): Promise<Team> {
  const res = await apiFetch("/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create team");
  return res.json();
}

export interface SubteamListItem extends Team {
  memberCount: number;
  members: { name: string | null; picture: string | null }[];
  spentCents: number;
  projectedCents: number;
}

export async function fetchSubteams(teamId: string): Promise<SubteamListItem[]> {
  const res = await apiFetch(`/teams/${teamId}/subteams`);
  if (!res.ok) throw new Error("Failed to fetch subteams");
  return res.json();
}

export interface InviteTeamMemberResult extends TeamMember {
  resent: boolean;
}

export async function inviteUser(
  email: string,
  role: "basic" | "advanced",
): Promise<{ status: string; email: string; role: string }> {
  const res = await apiFetch("/users/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to invite user");
  }
  return res.json();
}

export async function inviteTeamMember(
  teamId: string,
  email: string,
  role: "editor" | "viewer",
): Promise<InviteTeamMemberResult> {
  const res = await apiFetch(`/teams/${teamId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to invite member");
  }
  return res.json();
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invitationStatus: "pending" | "expired" | "revoked" | "accepted";
  invitationExpiresAt: string | null;
  invitationRevokedAt: string | null;
  createdAt: string;
}

export async function listTeamInvitations(
  teamId: string,
): Promise<PendingInvitation[]> {
  const res = await apiFetch(`/teams/${teamId}/invitations`);
  if (!res.ok) throw new Error("Failed to list invitations");
  return res.json();
}

export async function revokeInvitation(memberId: string): Promise<void> {
  const res = await apiFetch(`/teams/invitations/${memberId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to revoke invitation");
  }
}

export async function updateMemberRole(
  teamId: string,
  memberId: string,
  role: "editor" | "viewer",
): Promise<TeamMember> {
  const res = await apiFetch(`/teams/${teamId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error("Failed to update member role");
  return res.json();
}

export async function removeTeamMember(
  teamId: string,
  memberId: string,
): Promise<void> {
  const res = await apiFetch(`/teams/${teamId}/members/${memberId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to remove member");
  }
}

export async function updateTeamBudget(
  teamId: string,
  budgetUsd: number,
): Promise<{ monthlyBudgetCents: number }> {
  const res = await apiFetch(`/teams/${teamId}/budget`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetUsd }),
  });
  if (!res.ok) throw new Error("Failed to update budget");
  return res.json();
}

// Guardrails

export interface Guardrail {
  id: string;
  teamId: string;
  name: string;
  type: string;
  severity: "high" | "medium" | "low";
  triggers: number;
  isActive: boolean;
  teamIsActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchGuardrails(teamId: string): Promise<Guardrail[]> {
  const res = await apiFetch(`/teams/${teamId}/guardrails`);
  if (!res.ok) throw new Error("Failed to fetch guardrails");
  return res.json();
}

export async function createGuardrail(
  teamId: string,
  data: { name: string; type: string; severity: Guardrail["severity"] },
): Promise<Guardrail> {
  const res = await apiFetch(`/teams/${teamId}/guardrails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create guardrail");
  return res.json();
}

export async function toggleGuardrail(
  teamId: string,
  guardrailId: string,
  isActive: boolean,
): Promise<Guardrail> {
  const res = await apiFetch(`/teams/${teamId}/guardrails/${guardrailId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) throw new Error("Failed to toggle guardrail");
  return res.json();
}

export async function deleteGuardrail(
  teamId: string,
  guardrailId: string,
): Promise<void> {
  const res = await apiFetch(`/teams/${teamId}/guardrails/${guardrailId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete guardrail");
}

// Conversations

export interface ConversationParticipant {
  id: string | null;
  name: string | null;
  picture: string | null;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  metadata: unknown;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userPicture: string | null;
}

export interface ConversationWithMessages {
  id: string;
  projectId: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export async function fetchConversations(
  projectId: string,
): Promise<ConversationListItem[]> {
  const res = await apiFetch(`/projects/${projectId}/conversations`);
  if (!res.ok) throw new Error("Failed to fetch conversations");
  return res.json();
}

export async function fetchConversation(
  id: string,
): Promise<ConversationWithMessages> {
  const res = await apiFetch(`/conversations/${id}`);
  if (!res.ok) throw new Error("Failed to fetch conversation");
  return res.json();
}

export async function createConversation(
  projectId: string,
): Promise<{ id: string }> {
  const res = await apiFetch(`/projects/${projectId}/conversations`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function sendChatMessage(
  conversationId: string,
  content: string,
  model?: string,
  projectId?: string,
): Promise<{ role: string; content: string; reasoning_details?: unknown }> {
  const res = await apiFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      content,
      model,
      enableReasoning: true,
      projectId,
    }),
  });
  if (!res.ok) {
    // Surface the BE error body so humanizeChatError() can route it to a
    // specific user-facing message. The HTTP status is *always* prepended
    // so the humanizer can rely on \b402\b / \b429\b / \b401\b matching
    // even when the BE body itself doesn't mention the code (OpenRouter's
    // 402 text, for example, talks about "max_tokens" + "total limit"
    // which would otherwise false-positive as a context-length error).
    let detail: string | null = null;
    try {
      const body = await res.text();
      try {
        const parsed = JSON.parse(body) as { message?: string | string[] };
        if (Array.isArray(parsed.message)) detail = parsed.message.join("; ");
        else if (typeof parsed.message === "string") detail = parsed.message;
        else if (body) detail = body;
      } catch {
        if (body) detail = body;
      }
    } catch {
      /* keep null fallback */
    }
    const message = detail
      ? `${res.status} ${res.statusText}: ${detail}`
      : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return res.json();
}

// Invitations

export interface InviteDetails {
  email: string;
  role: string;
  teamName: string;
  inviterName: string;
  expiresAt: string | null;
  hasAccount: boolean;
}

export async function fetchInviteDetails(
  token: string,
): Promise<InviteDetails> {
  const res = await fetch(`${BASE_URL}/teams/invite/${token}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to fetch invite");
  }
  return res.json();
}

export async function acceptInvite(token: string): Promise<void> {
  const res = await apiFetch(`/teams/invite/${token}/accept`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to accept invite");
  }
}

// INSERT_YOUR_CODE

// Org Users

export interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: "basic" | "advanced" | "admin";
  inviteStatus: "active" | "pending";
  status: "pending" | "accepted";
  teams: string[];
  monthlyBudgetCents: number;
  spentCents: number;
  projectedCents: number;
  createdAt: string;
}

export async function fetchOrgUsers(): Promise<OrgUser[]> {
  const res = await apiFetch("/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export interface OrgUserDetail {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: "basic" | "advanced" | "admin";
  tier: "basic" | "advanced";
  monthlyBudgetCents: number;
  spentCents: number;
  projectedCents: number;
  teams: {
    id: string;
    memberId: string;
    name: string;
    role: string;
    status: string;
    canManage: boolean;
  }[];
  createdAt: string;
}

export async function fetchOrgUser(id: string): Promise<OrgUserDetail> {
  const res = await apiFetch(`/users/${id}`);
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

export async function updateUserBudget(
  userId: string,
  budgetUsd: number,
): Promise<{ monthlyBudgetCents: number }> {
  const res = await apiFetch(`/users/${userId}/budget`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ budgetUsd }),
  });
  if (!res.ok) throw new Error("Failed to update user budget");
  return res.json();
}

export async function removeOrgUser(userId: string): Promise<void> {
  const res = await apiFetch(`/users/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to remove user");
  }
}

// Model Configs

export interface ModelConfig {
  id: string;
  ownerId: string;
  customName: string;
  modelIdentifier: string;
  isActive: boolean;
  fallbackModels: string[];
  /** When set, chat calls for this alias route through the linked Custom
   *  LLM integration instead of OpenRouter. */
  integrationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchModels(): Promise<ModelConfig[]> {
  const res = await apiFetch("/models");
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

// ─── Catalog (admin-curated subset of OpenRouter models) ───────────────────

export interface AvailableModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export interface CatalogModel extends AvailableModel {
  enabled: boolean;
  enabledAt: string | null;
}

export async function fetchAvailableModels(): Promise<AvailableModel[]> {
  const res = await apiFetch("/models/available");
  if (!res.ok) throw new Error("Failed to fetch available models");
  return res.json();
}

export interface EffectiveModel extends AvailableModel {
  source: "alias" | "byok" | "custom";
  aliasId?: string;
}

/**
 * Per-user effective model list — drives the model pickers in the arena
 * and project chat. Includes the user's model aliases (Models tab) plus
 * any catalog model for a provider where the user has BYOK enabled.
 */
export async function fetchEffectiveModels(): Promise<EffectiveModel[]> {
  const res = await apiFetch("/models/effective");
  if (!res.ok) throw new Error("Failed to fetch effective models");
  return res.json();
}

export async function fetchModelsCatalog(): Promise<CatalogModel[]> {
  const res = await apiFetch("/models/catalog");
  if (!res.ok) throw new Error("Failed to fetch models catalog");
  return res.json();
}

export async function setModelEnabled(
  modelIdentifier: string,
  enabled: boolean,
): Promise<{ modelIdentifier: string; enabled: boolean }> {
  const res = await apiFetch(`/models/catalog/enabled`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelIdentifier, enabled }),
  });
  if (!res.ok) throw new Error("Failed to update model");
  return res.json();
}

export async function setModelsEnabledBatch(
  modelIdentifiers: string[],
  enabled: boolean,
): Promise<{ updated: string[]; enabled: boolean }> {
  const res = await apiFetch(`/models/catalog/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelIdentifiers, enabled }),
  });
  if (!res.ok) throw new Error("Failed to bulk-update models");
  return res.json();
}

export async function createModel(data: {
  customName: string;
  modelIdentifier: string;
  fallbackModels?: string[];
  integrationId?: string | null;
}): Promise<ModelConfig> {
  const res = await apiFetch("/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create model");
  return res.json();
}

export async function updateModel(
  id: string,
  data: {
    customName?: string;
    modelIdentifier?: string;
    isActive?: boolean;
    fallbackModels?: string[];
    integrationId?: string | null;
  },
): Promise<ModelConfig> {
  const res = await apiFetch(`/models/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update model");
  return res.json();
}

export async function deleteModel(id: string): Promise<void> {
  const res = await apiFetch(`/models/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete model");
}

// Interface for model comparison (for /compare-models API)
export interface ModelComparisonEntry {
  name: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
  summary: string;
}

export interface ModelResponse {
  model: string;
  response: {
    content: string;
    reasoning_details?: unknown;
  };
}

export interface CompareModelsApiResult {
  runId?: string;
  comparison: ModelComparisonEntry[];
  responses: ModelResponse[];
}

export async function sendQuestionToCompareModels(
  models: string[],
  question: string,
  expectedOutput: string,
  context?: string,
  teamId?: string | null,
): Promise<CompareModelsApiResult> {
  const res = await apiFetch(`/compare-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      models,
      question,
      expectedOutput,
      context,
      // Sentinel "personal" tells the server to skip the team fallback
      // and tag events as Personal. Undefined uses the user's primary.
      ...(teamId !== undefined ? { teamId: teamId ?? "personal" } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    let serverMessage: string | undefined;
    try {
      const parsed = JSON.parse(body) as { message?: string | string[] };
      serverMessage = Array.isArray(parsed.message)
        ? parsed.message.join("; ")
        : parsed.message;
    } catch {
      serverMessage = body;
    }
    throw new Error(
      `Compare-models request failed (${res.status} ${res.statusText})${
        serverMessage ? `: ${serverMessage}` : ""
      }`,
    );
  }
  return res.json();
}

export interface ArenaRunSummary {
  id: string;
  question: string;
  createdAt: string;
}

export interface ArenaRunDetail {
  id: string;
  question: string;
  expectedOutput: string;
  models: string[];
  responses: ModelResponse[];
  comparison: ModelComparisonEntry[];
  createdAt: string;
}

export async function fetchArenaRuns(): Promise<ArenaRunSummary[]> {
  const res = await apiFetch(`/compare-models/runs`);
  if (!res.ok) throw new Error("Failed to load arena history");
  return res.json();
}

export async function fetchArenaRun(id: string): Promise<ArenaRunDetail> {
  const res = await apiFetch(`/compare-models/runs/${id}`);
  if (!res.ok) throw new Error("Failed to load arena run");
  return res.json();
}

export async function deleteArenaRun(id: string): Promise<void> {
  const res = await apiFetch(`/compare-models/runs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete arena run");
}

export async function parseArenaAttachment(
  file: File,
  teamId?: string | null,
): Promise<{ name: string; content: string }> {
  const form = new FormData();
  form.append("file", file);
  if (teamId) form.append("teamId", teamId);
  const res = await apiFetch(`/compare-models/attachments/parse`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    let serverMessage: string | undefined;
    try {
      const parsed = JSON.parse(body) as { message?: string | string[] };
      serverMessage = Array.isArray(parsed.message)
        ? parsed.message.join("; ")
        : parsed.message;
    } catch {
      serverMessage = body;
    }
    throw new Error(
      `Attachment upload failed (${res.status} ${res.statusText})${
        serverMessage ? `: ${serverMessage}` : ""
      }`,
    );
  }
  return res.json();
}

// Prompts

export interface PromptVariable {
  name: string;
  description?: string;
  default?: string;
}

export interface PromptSummary {
  id: string;
  title: string;
  description: string | null;
  body: string;
  category: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Prompt {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  body: string;
  category: string | null;
  tags: string[];
  variables: PromptVariable[];
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptInput {
  title: string;
  description?: string | null;
  body: string;
  category?: string | null;
  tags?: string[];
  variables?: PromptVariable[];
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.text();
    const parsed = JSON.parse(body) as { message?: string | string[] };
    const msg = Array.isArray(parsed.message) ? parsed.message.join("; ") : parsed.message;
    return msg || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchPrompts(): Promise<PromptSummary[]> {
  const res = await apiFetch(`/prompts`);
  if (!res.ok) throw new Error("Failed to load prompts");
  return res.json();
}

export async function fetchPrompt(id: string): Promise<Prompt> {
  const res = await apiFetch(`/prompts/${id}`);
  if (!res.ok) throw new Error("Failed to load prompt");
  return res.json();
}

export async function createPrompt(input: PromptInput): Promise<Prompt> {
  const res = await apiFetch(`/prompts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to create prompt"));
  }
  return res.json();
}

export async function updatePrompt(
  id: string,
  input: Partial<PromptInput>,
): Promise<Prompt> {
  const res = await apiFetch(`/prompts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to update prompt"));
  }
  return res.json();
}

export async function deletePrompt(id: string): Promise<void> {
  const res = await apiFetch(`/prompts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete prompt");
}

// Shortcuts

export const SHORTCUT_BODY_MAX = 500;

export interface Shortcut {
  id: string;
  userId: string;
  label: string;
  body: string;
  category: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShortcutInput {
  label: string;
  body: string;
  category?: string | null;
  description?: string | null;
}

export async function fetchShortcuts(): Promise<Shortcut[]> {
  const res = await apiFetch(`/shortcuts`);
  if (!res.ok) throw new Error("Failed to load shortcuts");
  return res.json();
}

export async function fetchShortcut(id: string): Promise<Shortcut> {
  const res = await apiFetch(`/shortcuts/${id}`);
  if (!res.ok) throw new Error("Failed to load shortcut");
  return res.json();
}

export async function createShortcut(input: ShortcutInput): Promise<Shortcut> {
  const res = await apiFetch(`/shortcuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to create shortcut"));
  }
  return res.json();
}

export async function updateShortcut(
  id: string,
  input: Partial<ShortcutInput>,
): Promise<Shortcut> {
  const res = await apiFetch(`/shortcuts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to update shortcut"));
  }
  return res.json();
}

export async function deleteShortcut(id: string): Promise<void> {
  const res = await apiFetch(`/shortcuts/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete shortcut");
}

// Tenders

export interface TenderSummary {
  id: string;
  code: string;
  name: string;
  organization: string | null;
  description: string | null;
  category: string | null;
  deadline: string | null;
  value: string | null;
  matchRate: number | null;
  status: string;
  ownerId: string;
  ownerName: string | null;
  requirementCount: number;
  gapCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenderRequirement {
  id: string;
  tenderId: string;
  code: string;
  title: string;
  evidence: string | null;
  source: string | null;
  status: string;
  priority: string;
  createdAt: string;
}

export interface TenderDocument {
  id: string;
  tenderId: string;
  name: string;
  size: string | null;
  fileType: string | null;
  storagePath: string | null;
  createdAt: string;
}

export interface TenderTeamMember {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  createdAt: string;
}

export interface TenderDetail {
  id: string;
  code: string;
  name: string;
  organization: string | null;
  description: string | null;
  category: string | null;
  deadline: string | null;
  value: string | null;
  matchRate: number | null;
  status: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  requirements: TenderRequirement[];
  documents: TenderDocument[];
  teamMembers: TenderTeamMember[];
}

export interface CreateTenderPayload {
  name: string;
  code?: string;
  organization?: string;
  description?: string;
  category?: string;
  deadline?: string;
  value?: string;
  requirements?: { title: string; priority: string }[];
  teamMemberIds?: string[];
}

export async function fetchTenders(): Promise<TenderSummary[]> {
  const res = await apiFetch("/tenders");
  if (!res.ok) throw new Error("Failed to fetch tenders");
  return res.json();
}

export async function fetchTender(id: string): Promise<TenderDetail> {
  const res = await apiFetch(`/tenders/${id}`);
  if (!res.ok) throw new Error("Failed to fetch tender");
  return res.json();
}

export async function createTender(
  data: CreateTenderPayload,
): Promise<Pick<TenderSummary, "id" | "code" | "name" | "status">> {
  const res = await apiFetch("/tenders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Failed to create tender");
  }
  return res.json();
}

export async function updateTender(
  id: string,
  data: Partial<CreateTenderPayload & { matchRate: number; status: string }>,
): Promise<Pick<TenderSummary, "id" | "code" | "name" | "status">> {
  const res = await apiFetch(`/tenders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update tender");
  return res.json();
}

export async function deleteTender(id: string): Promise<void> {
  const res = await apiFetch(`/tenders/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete tender");
}

// Knowledge Core

export interface KnowledgeFolder {
  id: string;
  name: string;
  ownerId: string;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeFile {
  id: string;
  folderId: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  storagePath: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
}

export interface KnowledgeFolderDetail {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  files: KnowledgeFile[];
}

export interface KnowledgeRecentFile {
  id: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  folderName: string;
  uploadedByName: string | null;
  createdAt: string;
}

export async function fetchKnowledgeFolders(): Promise<KnowledgeFolder[]> {
  const res = await apiFetch("/knowledge-core/folders");
  if (!res.ok) throw new Error("Failed to fetch folders");
  return res.json();
}

export async function fetchKnowledgeFolder(
  id: string,
): Promise<KnowledgeFolderDetail> {
  const res = await apiFetch(`/knowledge-core/folders/${id}`);
  if (!res.ok) throw new Error("Failed to fetch folder");
  return res.json();
}

export async function createKnowledgeFolder(
  name: string,
): Promise<Pick<KnowledgeFolder, "id" | "name" | "ownerId" | "createdAt" | "updatedAt">> {
  const res = await apiFetch("/knowledge-core/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create folder");
  return res.json();
}

export async function deleteKnowledgeFolder(id: string): Promise<void> {
  const res = await apiFetch(`/knowledge-core/folders/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete folder");
}

export async function uploadKnowledgeFiles(
  folderId: string,
  files: File[],
): Promise<Omit<KnowledgeFile, "uploadedByName">[]> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await apiFetch(`/knowledge-core/folders/${folderId}/files`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Failed to upload files");
  return res.json();
}

export async function moveKnowledgeFile(
  fileId: string,
  targetFolderId: string,
): Promise<void> {
  const res = await apiFetch(`/knowledge-core/files/${fileId}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetFolderId }),
  });
  if (!res.ok) throw new Error("Failed to move file");
}

export async function deleteKnowledgeFile(id: string): Promise<void> {
  const res = await apiFetch(`/knowledge-core/files/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete file");
}

export async function fetchRecentKnowledgeFiles(): Promise<
  KnowledgeRecentFile[]
> {
  const res = await apiFetch("/knowledge-core/recent");
  if (!res.ok) throw new Error("Failed to fetch recent files");
  return res.json();
}

// Guardrails Section

export interface GuardrailItem {
  id: string;
  teamId: string | null;
  name: string;
  type: string;
  severity: "high" | "medium" | "low";
  triggers: number;
  isActive: boolean;
  validatorType: string | null;
  entities: string[] | null;
  target: string | null;
  onFail: string | null;
  templateSource: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GuardrailStats {
  activeRules: number;
  totalTriggers: number;
  criticalRules: number;
  coverage: number;
}

export interface ComplianceTemplateItem {
  id: string;
  name: string;
  ruleCount: number;
  description: string;
  features: string[];
}

export async function fetchGuardrailItems(): Promise<GuardrailItem[]> {
  const res = await apiFetch("/guardrails-section");
  if (!res.ok) throw new Error("Failed to fetch guardrails");
  return res.json();
}

export async function fetchGuardrailStats(): Promise<GuardrailStats> {
  const res = await apiFetch("/guardrails-section/stats");
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchComplianceTemplates(): Promise<
  ComplianceTemplateItem[]
> {
  const res = await apiFetch("/guardrails-section/templates");
  if (!res.ok) throw new Error("Failed to fetch templates");
  return res.json();
}

export async function createGuardrailItem(data: {
  name: string;
  type: string;
  severity: "high" | "medium" | "low";
  validatorType?: string;
  entities?: string[];
  target?: "input" | "output" | "both";
  onFail?: "fix" | "exception";
}): Promise<GuardrailItem> {
  const res = await apiFetch("/guardrails-section", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Failed to create guardrail");
  }
  return res.json();
}

export async function toggleGuardrailItem(id: string): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${id}/toggle`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to toggle guardrail");
  return res.json();
}

export async function deleteGuardrailItem(id: string): Promise<void> {
  const res = await apiFetch(`/guardrails-section/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete guardrail");
}

export async function toggleGuardrailTeamActive(
  guardrailId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${guardrailId}/toggle-team`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to toggle guardrail");
  return res.json();
}

export async function assignGuardrailToTeam(
  guardrailId: string,
  teamId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${guardrailId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
  });
  if (!res.ok) throw new Error("Failed to assign guardrail");
  return res.json();
}

export async function unassignGuardrailFromTeam(
  guardrailId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${guardrailId}/unassign`, {
    method: "PATCH",
  });
  if (!res.ok) throw new Error("Failed to remove guardrail from team");
  return res.json();
}

export async function applyComplianceTemplate(
  templateId: string,
): Promise<{ templateName: string; rulesCreated: number }> {
  const res = await apiFetch("/guardrails-section/apply-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) throw new Error("Failed to apply template");
  return res.json();
}

export async function removeComplianceTemplate(
  templateId: string,
): Promise<{ templateId: string; rulesRemoved: number }> {
  const res = await apiFetch(`/guardrails-section/template/${templateId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to disable template");
  return res.json();
}

// Onboarding

export interface OnboardingProfile {
  name: string | null;
  email: string;
  picture: string | null;
  profileType: "company" | "personal" | null;
  companyName: string | null;
  industry: string | null;
  teamSize: string | null;
  infraChoice: "managed" | "on-premise" | null;
  onboardingCompletedAt: string | null;
  providers: Array<{ id: string; provider: string; createdAt: string }>;
  documents: Array<{
    id: string;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    createdAt: string;
  }>;
}

export async function fetchOnboardingProfile(): Promise<OnboardingProfile> {
  const res = await apiFetch("/onboarding/profile");
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export interface CompleteOnboardingPayload {
  profileType: "company" | "personal";
  fullName?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
  infraChoice: "managed" | "on-premise";
  apiKeys?: Partial<
    Record<"openai" | "azure" | "anthropic" | "private-vpc", string>
  >;
}

export async function completeOnboarding(
  payload: CompleteOnboardingPayload,
  files: File[],
): Promise<void> {
  const form = new FormData();
  form.append("data", JSON.stringify(payload));
  for (const f of files) form.append("files", f, f.name);

  const res = await apiFetch("/onboarding/complete", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to complete onboarding");
  }
}

// ─── Observability ────────────────────────────────────────────────────

export type ObservabilityRange = "24h" | "7d" | "30d" | "90d";
export type ObservabilityGranularity = "hour" | "day" | "week";

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function fetchObservability<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (res.status === 403) {
    throw new ForbiddenError(
      "Observability is admin-only. Ask an admin to grant access.",
    );
  }
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

export interface ObservabilitySummaryBucket {
  totalCost: number;
  totalTokens: number;
  avgLatencyMs: number;
  activeUsers: number;
  callCount: number;
}

export interface ObservabilitySummary {
  range: ObservabilityRange;
  current: ObservabilitySummaryBucket;
  previous: ObservabilitySummaryBucket;
}

export function fetchObservabilitySummary(
  range: ObservabilityRange,
): Promise<ObservabilitySummary> {
  return fetchObservability(`/observability/summary?range=${range}`);
}

export interface ObservabilityTokenBucket {
  bucket: string; // ISO timestamp
  tokens: number;
  cost: number;
  calls: number;
}

export interface ObservabilityTokenUsage {
  range: ObservabilityRange;
  granularity: ObservabilityGranularity;
  series: ObservabilityTokenBucket[];
}

export function fetchObservabilityTokenUsage(
  range: ObservabilityRange,
): Promise<ObservabilityTokenUsage> {
  return fetchObservability(`/observability/token-usage?range=${range}`);
}

export interface ObservabilityProviderRow {
  provider: string;
  cost: number;
  tokens: number;
  calls: number;
}

export interface ObservabilityCostByProvider {
  range: ObservabilityRange;
  providers: ObservabilityProviderRow[];
}

export function fetchObservabilityCostByProvider(
  range: ObservabilityRange,
): Promise<ObservabilityCostByProvider> {
  return fetchObservability(`/observability/cost-by-provider?range=${range}`);
}

export interface ObservabilityTeamRow {
  teamId: string | null;
  teamName: string;
  cost: number;
  tokens: number;
  avgLatencyMs: number;
  calls: number;
  activeUsers: number;
}

export interface ObservabilityTeamAnalytics {
  range: ObservabilityRange;
  teams: ObservabilityTeamRow[];
}

export function fetchObservabilityTeamAnalytics(
  range: ObservabilityRange,
): Promise<ObservabilityTeamAnalytics> {
  return fetchObservability(`/observability/team-analytics?range=${range}`);
}

export interface ObservabilityEvent {
  id: string;
  createdAt: string;
  eventType: string;
  model: string | null;
  provider: string | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  success: boolean;
  errorMessage: string | null;
  promptPreview: string | null;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface ObservabilityEvents {
  range: ObservabilityRange;
  total: number;
  page: number;
  pageSize: number;
  events: ObservabilityEvent[];
}

export interface ObservabilityEventsQuery {
  range: ObservabilityRange;
  search?: string;
  page?: number;
  pageSize?: number;
  eventType?: string;
}

export function fetchObservabilityEvents(
  query: ObservabilityEventsQuery,
): Promise<ObservabilityEvents> {
  const params = new URLSearchParams({ range: query.range });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.eventType) params.set("eventType", query.eventType);
  return fetchObservability(`/observability/events?${params.toString()}`);
}

export interface ObservabilityGuardrailTrigger {
  guardrailId: string | null;
  guardrailName: string | null;
  severity: string | null;
  count: number;
  lastTriggeredAt: string;
}

export interface ObservabilityGuardrailActivity {
  range: ObservabilityRange;
  totalTriggers: number;
  triggers: ObservabilityGuardrailTrigger[];
}

export function fetchObservabilityGuardrailActivity(
  range: ObservabilityRange,
): Promise<ObservabilityGuardrailActivity> {
  return fetchObservability(
    `/observability/guardrail-activity?range=${range}`,
  );
}

// ─── Integrations (Management → Integration) ──────────────────────────────

export interface PredefinedProvider {
  id: string;
  displayName: string;
  description: string;
  iconHint: string;
  defaultRateLimit: number;
}

export interface IntegrationCard {
  id: string | null; // null when no DB row exists yet (untouched predefined)
  providerId: string;
  displayName: string;
  description: string;
  iconHint: string;
  apiUrl: string | null;
  hasApiKey: boolean;
  isEnabled: boolean;
  isCustom: boolean;
  /** Whether the provider's native API speaks OpenAI Chat Completions. */
  openAICompatible: boolean;
  /**
   * Whether the BYOK key is honored end-to-end (OpenAI SDK or a native
   * SDK shim like Anthropic's). When false the key is stored but chat
   * still routes through OpenRouter — Settings dialog shows a disclaimer.
   */
  byokSupported: boolean;
  /** For custom rows: how many model_configs aliases reference this integration. */
  boundAliasCount: number;
  stats: {
    successRate: number; // 0..1 over last 30 days
    /** Calls in the current calendar month. */
    apiCalls: number;
    /** Peak calls in any single day over the last 30 days. */
    peakDailyCalls: number;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

export async function fetchIntegrationProviders(): Promise<PredefinedProvider[]> {
  const res = await apiFetch("/integrations/providers");
  if (!res.ok) throw new Error("Failed to fetch provider catalog");
  return res.json();
}

export async function fetchIntegrations(): Promise<IntegrationCard[]> {
  const res = await apiFetch("/integrations");
  if (!res.ok) throw new Error("Failed to fetch integrations");
  return res.json();
}

export async function upsertIntegration(input: {
  providerId: string;
  apiUrl?: string;
  apiKey?: string;
  isEnabled?: boolean;
}): Promise<IntegrationCard> {
  const res = await apiFetch("/integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to save integration");
  }
  return res.json();
}

export async function updateIntegration(
  id: string,
  input: { isEnabled?: boolean; apiKey?: string | null },
): Promise<IntegrationCard> {
  const res = await apiFetch(`/integrations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to update integration");
  }
  return res.json();
}

export async function deleteIntegration(id: string): Promise<void> {
  const res = await apiFetch(`/integrations/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to delete integration");
  }
}

// ───── API keys (programmatic access tokens) ──────────────────────────

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Plaintext is included only on the response of POST /api-keys; subsequent
 * fetches return ApiKeySummary without it.
 */
export interface MintedApiKey extends ApiKeySummary {
  plaintext: string;
}

export async function fetchApiKeys(): Promise<ApiKeySummary[]> {
  const res = await apiFetch("/api-keys");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to load API keys");
  }
  return res.json();
}

export async function mintApiKey(name: string): Promise<MintedApiKey> {
  const res = await apiFetch("/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to create API key");
  }
  return res.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await apiFetch(`/api-keys/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to revoke API key");
  }
}
