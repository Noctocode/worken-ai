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
  teamId: string;
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
  severity: string;
  validatorType?: string;
  entities?: string[];
  target?: string;
  onFail?: string;
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
