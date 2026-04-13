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
  name: string | null;
  picture: string | null;
  isPaid: boolean;
  emailVerified: boolean;
  profileType: "company" | "personal" | null;
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
  await apiFetch("/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    skipAuthRedirect: true,
  });
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
}

export interface TeamMember {
  id: string;
  email: string;
  role: "basic" | "advanced";
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
  if (!res.ok) throw new Error("Failed to delete team");
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

export async function inviteTeamMember(
  teamId: string,
  email: string,
  role: "basic" | "advanced",
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
  role: "basic" | "advanced",
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
  if (!res.ok) throw new Error("Failed to remove member");
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
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

// Invitations

export interface InviteDetails {
  email: string;
  role: string;
  teamName: string;
  inviterName: string;
  expiresAt: string | null;
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
  monthlyBudgetCents: number;
  spentCents: number;
  projectedCents: number;
  teams: { id: string; name: string; role: string; status: string }[];
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
  if (!res.ok) throw new Error("Failed to remove user");
}

// Model Configs

export interface ModelConfig {
  id: string;
  ownerId: string;
  customName: string;
  modelIdentifier: string;
  isActive: boolean;
  fallbackModels: string[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchModels(): Promise<ModelConfig[]> {
  const res = await apiFetch("/models");
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function createModel(data: {
  customName: string;
  modelIdentifier: string;
  fallbackModels?: string[];
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
  comparison: ModelComparisonEntry[];
  responses: ModelResponse[];
}

export async function sendQuestionToCompareModels(
  models: string[],
  question: string,
  expectedOutput: string,
): Promise<CompareModelsApiResult> {
  const res = await apiFetch(`/compare-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models, question, expectedOutput }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}
