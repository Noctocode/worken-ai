import { parseSSEFrames } from "./sse-parser";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ApiFetchOptions extends RequestInit {
  // Pass true on public pages (e.g. /invite) where an unauthenticated 401
  // is an expected outcome, not a session expiry. The caller handles the
  // response itself instead of being bounced to /login.
  skipAuthRedirect?: boolean;
}

// Module-level coordination for the 401 → /auth/refresh recovery path.
// The app can have many concurrent in-flight queries (notifications poll
// at 5s + 30s, /auth/me, plus whatever the current page is fetching);
// when the access_token expires they all 401 at roughly the same moment.
// Without coalescing here, each one fired its own /auth/refresh, the BE
// rotated the refresh_token N times, and the FE thrashed.
//
// `refreshPromise` is a singleton for the in-flight refresh — every 401
// awaits the same promise.
//
// `sessionDead` latches once a refresh has terminally failed (BE 401'd
// the /auth/refresh call). Subsequent 401s skip the refresh attempt
// entirely and just route to /login. Without this, every still-in-
// flight query fired its own redundant refresh while the navigation
// was being scheduled, and the BE cookie-clear on the first 401 would
// race with the cookie-set from a stale parallel refresh.
let refreshPromise: Promise<boolean> | null = null;
let sessionDead = false;
let loginRedirectScheduled = false;

async function attemptRefresh(): Promise<boolean> {
  if (sessionDead) return false;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        // BE has cleared the auth cookies as part of this 401 — see
        // apps/api/src/auth/auth.controller.ts:refresh. Latch the
        // dead flag so the next 401 doesn't waste another round-trip.
        sessionDead = true;
        return false;
      }
      return true;
    } catch {
      // Network error during refresh — treat as terminal so the
      // user lands on /login instead of looping on a flaky link.
      sessionDead = true;
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function scheduleLoginRedirect() {
  if (loginRedirectScheduled || typeof window === "undefined") return;
  loginRedirectScheduled = true;
  // `replace` instead of `href` so the dead-session page doesn't sit
  // on the back-stack — back button would otherwise re-enter the loop.
  window.location.replace("/login");
}

export async function apiFetch(
  input: string,
  init?: ApiFetchOptions,
): Promise<Response> {
  const { skipAuthRedirect, ...fetchInit } = init ?? {};

  // Short-circuit once the session has been declared dead. Polling
  // queries that fire between the first failed refresh and the actual
  // /login navigation would otherwise queue up a flood of redundant
  // /auth/refresh calls — the user's "flickering" symptom.
  if (sessionDead && !skipAuthRedirect) {
    scheduleLoginRedirect();
    throw new Error("Session expired");
  }

  const res = await fetch(`${BASE_URL}${input}`, {
    ...fetchInit,
    credentials: "include",
  });

  if (res.status !== 401) return res;

  // Single-flight the refresh: N concurrent 401s share one attempt.
  const refreshed = await attemptRefresh();
  if (refreshed) {
    return fetch(`${BASE_URL}${input}`, {
      ...fetchInit,
      credentials: "include",
    });
  }

  if (skipAuthRedirect) return res;

  // Refresh failed terminally. BE has already cleared the cookies on
  // its 401 response, so the middleware will let /login through this
  // time instead of bouncing back to "/".
  scheduleLoginRedirect();
  throw new Error("Session expired");
}

export interface User {
  id: string;
  email: string;
  role: "admin" | "advanced" | "basic";
  // Subscription plan. Currently only "free" exists; the field is
  // typed as a string union with `string` open-end so future plans
  // ('pro', 'enterprise', …) don't require coordinated FE/BE deploy.
  plan: "free" | (string & {});
  inviteStatus: "active" | "pending";
  name: string | null;
  picture: string | null;
  emailVerified: boolean;
  profileType: "company" | "personal" | null;
  companyName: string | null;
  onboardingCompleted: boolean;
  canCreateProject: boolean;
  /** Cap in cents enforced on the user's OpenRouter sub-account.
   *  0 = no key provisioned yet (personal users self-set in
   *  Billing tab; company-profile users wait for admin approval). */
  monthlyBudgetCents: number;
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

/** Compact preview row for the avatar stack on a team project card.
 *  `userId`/`userName`/`userPicture` may be null for invites that
 *  haven't been claimed yet — we still show a placeholder avatar with
 *  the row id as the React key. */
export interface ProjectMemberPreview {
  id: string;
  userId: string | null;
  userName: string | null;
  userPicture: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  model: string;
  /** Active agent preset the project chats as. Maps to `model`. */
  agent: string;
  /** Pool of agent presets picked for this project. May be empty for
   *  legacy projects — callers fall back to `[agent]` in that case. */
  agents: string[];
  status: string;
  /** Per-project web search switch. */
  webSearch: boolean;
  /** Whether the org/team allows web search — drives showing the toggle.
   *  Only populated by the single-project fetch (findOne). */
  webSearchAllowed?: boolean;
  /** Whether the project's active model can actually use web search
   *  (false for native Anthropic BYOK, which bypasses the OpenRouter
   *  plugin). Only populated by findOne when webSearchAllowed. */
  webSearchSupported?: boolean;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Whether the caller may edit this project (rename, change model,
   *  web search). Populated by the list endpoint; mirrors the BE update
   *  gate. Undefined on payloads that don't compute it (treat as allowed). */
  canManage?: boolean;
  /** Whether the caller may delete this project (owner-only). Populated
   *  by the list endpoint. Undefined → treat as allowed (BE still gates). */
  canDelete?: boolean;
  /** Populated only when `teamId` is set. Capped at 4 entries on the
   *  BE; full team list lives at /teams/:id. */
  teamMembers?: ProjectMemberPreview[];
  /** Total count of accepted members on the project's team. Used to
   *  render the "+N" indicator when teamMembers is truncated. */
  teamMembersCount?: number;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  model: string;
  /** Active agent preset. Defaults to general-assistant when omitted. */
  agent?: string;
  /** Pool of agent presets picked for the project. Defaults to [agent]. */
  agents?: string[];
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

/** Thrown when the API rejects a duplicate project name (HTTP 409).
 *  Components catch this to show a field-level "name already taken" error. */
export class DuplicateProjectNameError extends Error {
  constructor() {
    super("Project name already exists");
    this.name = "DuplicateProjectNameError";
  }
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const res = await apiFetch("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status === 409) throw new DuplicateProjectNameError();
    throw new Error("Failed to create project");
  }
  return res.json();
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  model?: string;
  agent?: string;
  agents?: string[];
  webSearch?: boolean;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
): Promise<Project> {
  const res = await apiFetch(`/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    if (res.status === 409) throw new DuplicateProjectNameError();
    throw new Error("Failed to update project");
  }
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch(`/projects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete project");
}

// Documents

export interface Document {
  id: string;
  groupId: string;
  title: string;
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

// ─── Project ↔ Knowledge Core attachments ─────────────────────────
//
// Manage Context routes file uploads through Knowledge Core now —
// see ProjectKnowledgeService on the BE. The legacy
// `uploadDocumentFile` above stays for paste-text snippets and
// existing data; the helpers below replace the project-scoped
// upload path with KC linking + KC upload (auto-attach).

export interface ProjectKnowledgeFile {
  fileId: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  folderId: string;
  folderName: string;
  visibility: KnowledgeFileVisibility;
  ingestionStatus: IngestionDocStatus;
  ingestionError: string | null;
  teams: KnowledgeFileTeamRef[];
  attachedAt: string;
}

export interface ProjectKnowledgeUploadDefaults {
  folderId: string;
  folderName: string;
  visibility: "all" | "teams";
  teamIds: string[];
}

export async function fetchProjectKnowledgeFiles(
  projectId: string,
): Promise<ProjectKnowledgeFile[]> {
  const res = await apiFetch(`/projects/${projectId}/knowledge-files`);
  if (!res.ok) throw new Error("Failed to fetch project knowledge files");
  return res.json();
}

export async function fetchProjectKnowledgeUploadDefaults(
  projectId: string,
): Promise<ProjectKnowledgeUploadDefaults> {
  const res = await apiFetch(
    `/projects/${projectId}/knowledge-files/upload-defaults`,
  );
  if (!res.ok) throw new Error("Failed to fetch upload defaults");
  return res.json();
}

export async function attachKnowledgeFiles(
  projectId: string,
  fileIds: string[],
): Promise<{ attached: string[] }> {
  const res = await apiFetch(`/projects/${projectId}/knowledge-files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to attach files");
  }
  return res.json();
}

export async function detachKnowledgeFile(
  projectId: string,
  fileId: string,
): Promise<{ ok: true }> {
  const res = await apiFetch(
    `/projects/${projectId}/knowledge-files/${fileId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to detach file");
  return res.json();
}

export interface ProjectKnowledgeUploadResult {
  uploaded: Array<{ id: string; name: string; ingestionStatus: string }>;
  duplicates: KnowledgeUploadDuplicate[];
  nameConflicts: KnowledgeUploadNameConflict[];
}

/**
 * Upload one or more files from the Manage Context dialog. Routes
 * through the BE which writes to KC + auto-attaches to the
 * project. `folderId` / `visibility` / `teamIds` are optional —
 * omit them to use the smart-default ("Projects" folder, scope-
 * aware visibility).
 *
 * `nameConflictActions` (optional) carries the user's resolution for
 * same-name-different-content collisions surfaced by a prior call.
 * See `uploadKnowledgeFiles` for the semantics; the BE routes both
 * uploads through the same service so behaviour is identical.
 */
export async function uploadProjectKnowledgeFiles(
  projectId: string,
  files: File[],
  options: {
    folderId?: string;
    visibility?: KnowledgeFileVisibility;
    teamIds?: string[];
    projectIds?: string[];
    nameConflictActions?: Record<string, NameConflictAction>;
  } = {},
): Promise<ProjectKnowledgeUploadResult> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  if (options.folderId) form.append("folderId", options.folderId);
  if (options.visibility) form.append("visibility", options.visibility);
  if (options.visibility === "teams" && options.teamIds) {
    options.teamIds.forEach((id) => form.append("teamIds", id));
  }
  // projectIds are sent whenever provided — the project attach (RAG
  // grant) is independent of the visibility tier, so a personal-scope
  // upload can still be linked to its project.
  if (options.projectIds && options.projectIds.length > 0) {
    options.projectIds.forEach((id) => form.append("projectIds", id));
  }
  if (
    options.nameConflictActions &&
    Object.keys(options.nameConflictActions).length > 0
  ) {
    form.append(
      "nameConflictActions",
      JSON.stringify(options.nameConflictActions),
    );
  }
  const res = await apiFetch(
    `/projects/${projectId}/knowledge-files/upload`,
    { method: "POST", body: form },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to upload files");
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
  /** Per-team web-search override; null = inherit the org default. */
  webSearchEnabled: boolean | null;
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
  // 'admin' and 'manager' are owner-equivalent: same permissions as
  // the team owner (budget, invites, role changes, integrations)
  // except they aren't the literal team owner so they can't be
  // removed as such. Only an owner, admin, or manager can promote /
  // demote into these tiers. 'editor' can create team projects,
  // edit content, and invite editors/viewers but can't touch
  // admin/manager rows.
  role: "owner" | "admin" | "manager" | "editor" | "viewer";
  status: "pending" | "accepted";
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userPicture: string | null;
  /**
   * Per-member monthly spend cap in cents.
   *  - null  → no individual cap (member shares the team budget)
   *  - 0     → suspended (chat blocked at the gate)
   *  - >0    → enforced against the member's current-month spend
   */
  monthlyCapCents: number | null;
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
  data: {
    name?: string;
    description?: string;
    webSearchEnabled?: boolean | null;
  },
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
  role: OrgRole,
): Promise<{ status: string; email: string; role: OrgRole }> {
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
  role: "admin" | "manager" | "editor" | "viewer",
  monthlyCapCents?: number | null,
): Promise<InviteTeamMemberResult> {
  const res = await apiFetch(`/teams/${teamId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role, monthlyCapCents }),
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
  role: "admin" | "manager" | "editor" | "viewer",
): Promise<TeamMember> {
  const res = await apiFetch(`/teams/${teamId}/members/${memberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update member role");
  }
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

/**
 * Per-member monthly spend cap inside a team.
 *
 * Pass `null` to clear the cap (member shares the team budget freely).
 * Pass `0` to suspend (chat-time gate blocks all calls).
 * Pass `>0` to enforce the cap, in cents.
 */
export async function updateTeamMemberCap(
  teamId: string,
  memberId: string,
  monthlyCapCents: number | null,
): Promise<{ id: string; monthlyCapCents: number | null }> {
  const res = await apiFetch(`/teams/${teamId}/members/${memberId}/cap`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monthlyCapCents }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update member cap");
  }
  return res.json();
}

// Guardrails — per-team listing. Rules are owned + edited in
// /guardrails-section; teams just link to them via the dialog on
// /teams/[id]. Creation / toggle / unlink endpoints live on
// /guardrails-section since the M2M refactor.

export interface Guardrail {
  id: string;
  name: string;
  type: string;
  severity: "high" | "medium" | "low";
  triggers: number;
  /** Master toggle on the rule (Guardrails page Switch). */
  isActive: boolean;
  /** Per-team pause toggle from `guardrail_teams.is_active`. Both this
   *  and `isActive` must be true for the evaluator to apply the rule
   *  to this team's chats. Forced to true for rules surfaced via the
   *  org-wide branch — org-wide rules can't be paused per-team. */
  teamIsActive: boolean;
  /** When true the rule reached this team via the org-wide branch
   *  (or via an org-wide-flagged direct link). FE disables the
   *  per-team Switch + "Remove from team" affordances on these rows
   *  since the toggle lives only on the master Guardrails page. */
  isOrgWide: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchGuardrails(teamId: string): Promise<Guardrail[]> {
  const res = await apiFetch(`/teams/${teamId}/guardrails`);
  if (!res.ok) throw new Error("Failed to fetch guardrails");
  return res.json();
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
  /** 'personal' = private to the creator; 'team' = shared with the
   *  project's team. Drives the Personal/Team sidebar filter. */
  scope: "personal" | "team";
  createdAt: string;
  updatedAt: string;
  participants: ConversationParticipant[];
}

/** A Knowledge Core file attached to a chat message (rendered as a
 *  downloadable chip). Stored in the message's metadata.attachments. */
export interface ChatAttachment {
  fileId: string;
  name: string;
  fileType?: string | null;
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

/**
 * Download a Knowledge Core file by id (the inline chat attachment +
 * Data Sources panel use this). Fetches through apiFetch so the auth
 * cookie rides along, then saves the blob client-side.
 */
export async function downloadKnowledgeFile(
  fileId: string,
  name: string,
): Promise<void> {
  const res = await apiFetch(`/knowledge-core/files/${fileId}/download`);
  if (!res.ok) throw new Error("Failed to download file");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ConversationWithMessages {
  id: string;
  projectId: string;
  userId: string;
  title: string | null;
  /** Free-form Chat Context shown/edited in the right Project Details
   *  panel (Figma 238:17561). Null when unset. */
  context: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export async function fetchConversations(
  projectId: string,
  query?: string,
): Promise<ConversationListItem[]> {
  const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const res = await apiFetch(`/projects/${projectId}/conversations${qs}`);
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
  scope: "personal" | "team" = "personal",
): Promise<{ id: string }> {
  const res = await apiFetch(`/projects/${projectId}/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope }),
  });
  if (!res.ok) throw new Error("Failed to create conversation");
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await apiFetch(`/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

/**
 * Update a conversation's free-form Chat Context (right Project
 * Details panel "Edit Context"). Pass null/empty to clear it. Returns
 * the normalised stored value.
 */
export async function updateConversationContext(
  id: string,
  context: string | null,
): Promise<{ context: string | null }> {
  const res = await apiFetch(`/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context }),
  });
  if (!res.ok) throw new Error("Failed to update chat context");
  return res.json();
}

/**
 * Persist 👍 / 👎 on an assistant message. `score` is 1 or -1; pass
 * null to remove an existing vote (the FE's toggle-off semantics —
 * clicking the same thumb twice). Returns the final stored score
 * (echoed back so the FE can confirm without a refetch).
 */
export async function submitMessageFeedback(
  messageId: string,
  score: 1 | -1 | null,
): Promise<{ score: 1 | -1 | null }> {
  const res = await apiFetch(`/messages/${messageId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to save feedback");
  }
  return res.json();
}

export interface ProjectMember {
  /** For pending team invites this is `invite:<team_members.id>` so
   *  the FE has a stable React key even before the invitee accepts.
   *  Don't try to look this up as a user id — only meaningful for
   *  in-list rendering when status === 'pending'. */
  userId: string;
  userName: string | null;
  userEmail: string;
  userPicture: string | null;
  role: "admin" | "editor" | "viewer";
  /** "team" rows come from the project's team; "direct" rows are
   *  ad-hoc invites stored in `project_members`. Pending team
   *  invites also flow under "direct" so they show up immediately in
   *  the Figma "Other" group after Send Invite — distinguish them
   *  by `status`. */
  source: "team" | "direct";
  status: "pending" | "accepted";
  addedAt: string;
}

export async function fetchProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  const res = await apiFetch(`/projects/${projectId}/members`);
  if (!res.ok) throw new Error("Failed to load project members");
  return res.json();
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: "admin" | "editor" | "viewer" = "editor",
): Promise<ProjectMember> {
  const res = await apiFetch(`/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to add member");
  }
  return res.json();
}

/**
 * Add by email — server-side path that creates the org user (if
 * missing) AND adds them to the project's direct-membership table,
 * skipping team_members entirely. Used by the chat-side
 * InviteMembersDialog so invitees show under the "Other" group.
 */
export async function inviteProjectMemberByEmail(
  projectId: string,
  email: string,
  role: "admin" | "editor" | "viewer" = "editor",
): Promise<ProjectMember> {
  const res = await apiFetch(`/projects/${projectId}/members/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to invite member");
  }
  return res.json();
}

export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: "admin" | "editor" | "viewer",
): Promise<{ updated: true; role: string }> {
  const res = await apiFetch(`/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update role");
  }
  return res.json();
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ removed: true }> {
  const res = await apiFetch(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to remove member");
  }
  return res.json();
}

// Non-streaming sendChatMessage has been removed in favour of
// streamChatMessage (below). The streaming endpoint is the only
// chat path; consumers walk the SSE event iterable and concatenate
// `delta` events if they need the final blob.

/**
 * Discriminated union mirroring the BE SSE event shapes from
 * `chat.controller.chatStream`. Consumers tag-switch on `type` to
 * drive UI state (delta appends, replace overwrites, reasoning pane,
 * done finalizer, blocked/error humanization).
 */
/**
 * Optional follow-up suggestion the BE may attach to the `done`
 * event. When set, the FE renders a small "we think X would work
 * better — Try It" bubble below the assistant turn. Field is purely
 * additive on the SSE shape; absent / undefined means no suggestion.
 */
export interface AlternativeModelSuggestion {
  id: string;
  label: string;
  reason: string;
}

export interface WebCitation {
  url: string;
  title?: string;
}

/**
 * Validate an untrusted citations array (SSE payload or persisted message
 * metadata) into safe WebCitation objects:
 *  - drops entries whose `url` isn't a string,
 *  - keeps only http(s) urls so a `javascript:` / `data:` link can never
 *    reach an anchor `href`,
 *  - coerces a non-string `title` to undefined so React never receives an
 *    object as a child (which would throw at render time).
 */
export function parseCitations(value: unknown): WebCitation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (c): c is { url: string; title?: unknown } =>
        !!c &&
        typeof c === "object" &&
        typeof (c as { url?: unknown }).url === "string",
    )
    .filter((c) => /^https?:\/\//i.test(c.url))
    .map((c) => ({
      url: c.url,
      title: typeof c.title === "string" ? c.title : undefined,
    }));
}

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "replace"; text: string }
  | { type: "blocked"; rule: string; validator: string }
  | { type: "citations"; citations: WebCitation[] }
  | { type: "error"; message: string; status?: number }
  | {
      type: "done";
      totalTokens?: number;
      costUsd?: number | null;
      partial?: boolean;
      alternativeModel?: AlternativeModelSuggestion;
      /** Model that actually answered (a fallback when it differs from the
       *  requested one), and the originally-requested model. */
      model?: string;
      requestedModel?: string;
    };

/**
 * Stream an assistant response token-by-token from POST /chat/stream.
 *
 * Uses `fetch` + `ReadableStream` rather than `EventSource` so we can
 * keep the existing cookie-based auth (POST + credentials: 'include'
 * via apiFetch) and pass an AbortController for the Stop button.
 *
 * The BE emits standard SSE blocks (`event: <name>\ndata: <json>\n\n`).
 * We buffer raw bytes, split on the blank-line delimiter, and parse
 * each block into a `ChatStreamEvent`. Yields events in arrival
 * order — caller `for await`s and updates UI state per event type.
 *
 * Cancellation contract:
 *   - signal.abort() → fetch aborts → ReadableStream closes → BE
 *     gets req.close → BE aborts upstream LLM call + persists
 *     whatever was buffered with metadata.partial = true. A final
 *     `done` event with partial: true may still arrive before the
 *     stream actually closes; consumers should treat AbortError as
 *     a clean stop, not a failure.
 */
export async function* streamChatMessage(
  conversationId: string,
  content: string,
  model?: string,
  projectId?: string,
  signal?: AbortSignal,
  attachments?: ChatAttachment[],
  pinnedSkillIds?: string[],
): AsyncIterable<ChatStreamEvent> {
  const res = await apiFetch("/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      content,
      model,
      enableReasoning: true,
      projectId,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
      ...(pinnedSkillIds && pinnedSkillIds.length > 0
        ? { pinnedSkillIds }
        : {}),
    }),
    signal,
  });

  if (!res.ok) {
    // Pre-flight failure (guardrail input block, budget gate, …) —
    // BE returned a JSON 4xx before opening the SSE stream. Surface
    // the same shape as sendChatMessage so the FE humanizer routes
    // it identically.
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

  if (!res.body) {
    throw new Error("Streaming chat response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // parseSSEFrames lives in its own module for unit testability.
      // It returns every complete frame in the buffer and the
      // remaining bytes (a partial frame still waiting on more
      // bytes from the next read).
      const { frames, rest } = parseSSEFrames(buf);
      buf = rest;
      for (const frame of frames) {
        if (!frame.data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          // Malformed JSON in a frame — skip rather than crash the
          // whole stream. The BE shouldn't emit these, but a flaky
          // proxy could.
          continue;
        }

        // Map the wire event name + payload into the discriminated
        // union. Anything unrecognised is dropped silently to keep
        // forward-compat with future BE event types.
        const data = parsed as Record<string, unknown>;
        if (frame.event === "delta" && typeof data.text === "string") {
          yield { type: "delta", text: data.text };
        } else if (
          frame.event === "reasoning" &&
          typeof data.text === "string"
        ) {
          yield { type: "reasoning", text: data.text };
        } else if (
          frame.event === "replace" &&
          typeof data.text === "string"
        ) {
          yield { type: "replace", text: data.text };
        } else if (
          frame.event === "blocked" &&
          typeof data.rule === "string" &&
          typeof data.validator === "string"
        ) {
          yield {
            type: "blocked",
            rule: data.rule,
            validator: data.validator,
          };
        } else if (frame.event === "citations") {
          const citations = parseCitations(data.citations);
          if (citations.length > 0) yield { type: "citations", citations };
        } else if (frame.event === "error") {
          yield {
            type: "error",
            message:
              typeof data.message === "string"
                ? data.message
                : "Stream error",
            status:
              typeof data.status === "number" ? data.status : undefined,
          };
        } else if (frame.event === "done") {
          yield {
            type: "done",
            totalTokens:
              typeof data.totalTokens === "number"
                ? data.totalTokens
                : undefined,
            costUsd:
              typeof data.costUsd === "number" ? data.costUsd : null,
            partial: data.partial === true,
            model: typeof data.model === "string" ? data.model : undefined,
            requestedModel:
              typeof data.requestedModel === "string"
                ? data.requestedModel
                : undefined,
          };
        }
      }
    }
  } finally {
    // Release the reader so cancel propagates cleanly to the BE.
    // For AbortError this no-ops (already cancelled); for a normal
    // close it's a courtesy release.
    reader.releaseLock();
  }
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
  /**
   * True when the user finished Managed-Cloud onboarding (has an
   * OpenRouter key provisioned) but no admin has set a monthly budget
   * yet — they cannot make AI calls until budget is bumped from 0.
   * Drives the "N users awaiting approval" banner on Management → Users.
   */
  pendingBudgetApproval: boolean;
  spentCents: number;
  projectedCents: number;
  createdAt: string;
}

export async function fetchOrgUsers(): Promise<OrgUser[]> {
  const res = await apiFetch("/users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

/** Slim company roster for member-pickers — only id/name/email/picture, no
 *  role/budget. Use this (not fetchOrgUsers) anywhere a non-admin picks a
 *  colleague, so management-only fields aren't shipped to the client. */
export interface Colleague {
  id: string;
  name: string | null;
  email: string;
  picture: string | null;
}

export async function fetchColleagues(): Promise<Colleague[]> {
  const res = await apiFetch("/users/colleagues");
  if (!res.ok) throw new Error("Failed to fetch colleagues");
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update user budget");
  }
  return res.json();
}

export interface UserActivityEvent {
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
  teamId: string | null;
  teamName: string | null;
}

export interface UserActivityResponse {
  total: number;
  page: number;
  pageSize: number;
  events: UserActivityEvent[];
}

export async function fetchUserActivity(
  userId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<UserActivityResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const url = `/users/${userId}/activity${qs.toString() ? `?${qs}` : ""}`;
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to load activity log");
  }
  return res.json();
}

export type OrgRole = "basic" | "advanced" | "admin";

export async function updateUserRole(
  userId: string,
  role: OrgRole,
): Promise<{ id: string; role: OrgRole }> {
  const res = await apiFetch(`/users/${userId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update user role");
  }
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
  /** Custom LLM aliases only: the real model id sent to the upstream
   *  endpoint. `modelIdentifier` is a synthetic `user:…` routing id for
   *  these, so the UI shows `upstreamModel` instead. Null for predefined
   *  aliases (where `modelIdentifier` IS the real id). */
  upstreamModel?: string | null;
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

// ─── Models (full OpenRouter catalog, surfaced everywhere) ─────────────────

export interface AvailableModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export async function fetchAvailableModels(): Promise<AvailableModel[]> {
  const res = await apiFetch("/models/available");
  if (!res.ok) throw new Error("Failed to fetch available models");
  return res.json();
}

export interface EffectiveModel extends AvailableModel {
  source: "alias" | "byok" | "custom";
  /** Where chat-transport will actually route a chat call. Drives the
   *  "(BYOK)" / "(Custom)" marker in pickers so users can tell whose
   *  tokens get billed. */
  routing: "workenai" | "byok" | "custom";
  aliasId?: string;
}

/**
 * Per-user effective model list — drives the model pickers in the arena
 * and project chat. Includes the user's model aliases (Models tab) plus
 * any catalog model for a provider where the user has BYOK enabled.
 */
export async function fetchEffectiveModels(
  /** Narrow the pool for the Create Project picker: "personal" for the
   *  caller's own keys, a team id for that team's enabled keys, or
   *  omitted for the full union (arena / chat). */
  scope?: string,
): Promise<EffectiveModel[]> {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const res = await apiFetch(`/models/effective${qs}`);
  if (!res.ok) throw new Error("Failed to fetch effective models");
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

// Non-streaming sendQuestionToCompareModels was removed in favour
// of streamCompareModels (below). Arena is SSE-only now; consumers
// walk the event iterable and call setEvaluations on the final
// `evaluation` event.

/**
 * Discriminated union mirroring the BE arena SSE event shapes
 * (compare-models.controller.compareModelsStream). Consumer tag-
 * switches on `type` to drive per-model panel state.
 */
export type CompareModelsStreamEvent =
  | { type: "model-delta"; model: string; text: string }
  | { type: "model-replace"; model: string; text: string }
  | { type: "model-error"; model: string; message: string; status?: number }
  | { type: "model-fallback"; model: string; usedModel: string }
  | {
      type: "model-done";
      model: string;
      /** Model that actually answered (differs from `model` on a fallback). */
      usedModel?: string;
      totalTokens?: number;
      costUsd?: number | null;
      time?: number;
    }
  | {
      type: "evaluation";
      comparisonItems: (ModelComparisonEntry & {
        totalTokens?: number;
        totalCost?: number;
        time?: number;
      })[];
      runId?: string;
      /** The judge model that produced these scores. */
      judgeModel?: string;
      /** True when the judge model was also one of the compared models
       *  (it graded its own answer — possible self-evaluation bias). */
      selfJudge?: boolean;
      /** Set when every retry of the evaluator failed. Empty
       *  comparisonItems alone isn't a sufficient signal — a 0-model
       *  response set would also produce empty items legitimately. */
      error?: string;
    }
  | { type: "done" };

/**
 * Stream the arena fan-out from POST /compare-models/stream. Same
 * fetch + ReadableStream pattern as streamChatMessage — every
 * `model-delta` event is keyed by model id so the FE routes deltas
 * to the right panel.
 */
export async function* streamCompareModels(
  models: string[],
  question: string,
  expectedOutput: string,
  context?: string,
  signal?: AbortSignal,
  /** Optional judge-model override (UI selector). Omitted → the BE
   *  falls back to ARENA_JUDGE_MODEL env / its default. */
  judgeModel?: string,
  /** Skills pinned in the arena composer — injected into every panel. */
  pinnedSkillIds?: string[],
): AsyncIterable<CompareModelsStreamEvent> {
  const res = await apiFetch(`/compare-models/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      models,
      question,
      expectedOutput,
      context,
      ...(judgeModel ? { judgeModel } : {}),
      ...(pinnedSkillIds && pinnedSkillIds.length > 0
        ? { pinnedSkillIds }
        : {}),
    }),
    signal,
  });

  if (!res.ok) {
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
  if (!res.body) {
    throw new Error("Streaming arena response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const { frames, rest } = parseSSEFrames(buf);
      buf = rest;
      for (const frame of frames) {
        if (!frame.data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.data);
        } catch {
          continue;
        }
        const data = parsed as Record<string, unknown>;
        if (frame.event === "model-delta") {
          yield {
            type: "model-delta",
            model: data.model as string,
            text: data.text as string,
          };
        } else if (frame.event === "model-replace") {
          yield {
            type: "model-replace",
            model: data.model as string,
            text: data.text as string,
          };
        } else if (frame.event === "model-error") {
          yield {
            type: "model-error",
            model: data.model as string,
            message: data.message as string,
            status: typeof data.status === "number" ? data.status : undefined,
          };
        } else if (frame.event === "model-fallback") {
          yield {
            type: "model-fallback",
            model: data.model as string,
            usedModel: data.usedModel as string,
          };
        } else if (frame.event === "model-done") {
          yield {
            type: "model-done",
            model: data.model as string,
            usedModel:
              typeof data.usedModel === "string" ? data.usedModel : undefined,
            totalTokens:
              typeof data.totalTokens === "number"
                ? data.totalTokens
                : undefined,
            costUsd:
              typeof data.costUsd === "number" ? data.costUsd : null,
            time: typeof data.time === "number" ? data.time : undefined,
          };
        } else if (frame.event === "evaluation") {
          yield {
            type: "evaluation",
            comparisonItems: Array.isArray(data.comparisonItems)
              ? (data.comparisonItems as CompareModelsStreamEvent extends {
                  type: "evaluation";
                  comparisonItems: infer T;
                }
                  ? T
                  : never)
              : [],
            runId:
              typeof data.runId === "string" ? data.runId : undefined,
            error:
              typeof data.error === "string" ? data.error : undefined,
          };
        } else if (frame.event === "done") {
          yield { type: "done" };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface ArenaRunSummary {
  id: string;
  question: string;
  /** Model identifiers the run was executed against. The dashboard
   *  card stack and the sidebar history list both render avatars
   *  from these without a second round-trip to /runs/:id. */
  models: string[];
  createdAt: string;
}

export interface ArenaRunDetail {
  id: string;
  question: string;
  expectedOutput: string;
  models: string[];
  responses: ModelResponse[];
  comparison: ModelComparisonEntry[];
  /** Model the user marked as best for this run (null = none). */
  favoriteModel?: string | null;
  /** Judge model that scored this run (null for legacy runs). */
  judgeModel?: string | null;
  createdAt: string;
}

export async function fetchArenaRuns(): Promise<ArenaRunSummary[]> {
  const res = await apiFetch(`/compare-models/runs`);
  if (!res.ok) throw new Error("Failed to load arena history");
  return res.json();
}

/** The judge model used when no per-run override is picked — resolved
 *  live on the BE so the UI can name it without hardcoding. */
export async function fetchArenaJudgeDefault(): Promise<{
  id: string;
  name: string;
}> {
  const res = await apiFetch(`/compare-models/judge-default`);
  if (!res.ok) throw new Error("Failed to load default judge model");
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

/** Persist (or clear with null) the user's "best answer" pick for a run. */
export async function updateArenaRunFavorite(
  id: string,
  favoriteModel: string | null,
): Promise<void> {
  const res = await apiFetch(`/compare-models/runs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favoriteModel }),
  });
  if (!res.ok) throw new Error("Failed to save best answer");
}

export async function parseArenaAttachment(
  file: File,
): Promise<{ name: string; content: string }> {
  const form = new FormData();
  form.append("file", file);
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

// Skills — instructional "how we do X here" recipes the chat/arena
// auto-selects per turn and injects into the model's context.

export type SkillVisibility = "all" | "admins" | "teams" | "project";

export interface Skill {
  id: string;
  userId: string;
  name: string;
  description: string;
  instructions: string;
  scope: "personal" | "company";
  visibility: SkillVisibility;
  isActive: boolean;
  source: "manual" | "import";
  createdAt: string;
  updatedAt: string;
  /** Current link sets — only populated by fetchSkill (the detail endpoint),
   *  used to prefill the edit dialog's team / project pickers. */
  teamIds?: string[];
  projectIds?: string[];
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
  visibility?: SkillVisibility;
  teamIds?: string[];
  projectIds?: string[];
}

export async function fetchSkills(): Promise<Skill[]> {
  const res = await apiFetch(`/skills`);
  if (!res.ok) throw new Error("Failed to load skills");
  return res.json();
}

export async function fetchSkill(id: string): Promise<Skill> {
  const res = await apiFetch(`/skills/${id}`);
  if (!res.ok) throw new Error("Failed to load skill");
  return res.json();
}

/** A skill the caller may pin in a given context (composer picker). */
export interface PinnableSkill {
  id: string;
  name: string;
  description: string;
}

/**
 * Skills pinnable in THIS context — own (non-project) + company-shared +
 * project-scoped skills linked to `projectId`. Omit `projectId` for the
 * project-less arena. Mirrors the router's accessible-skills query, so a
 * project's skill never shows for pinning in a different project.
 */
export async function fetchPinnableSkills(
  projectId?: string,
): Promise<PinnableSkill[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const res = await apiFetch(`/skills/pinnable${qs}`);
  if (!res.ok) throw new Error("Failed to load skills");
  return res.json();
}

export async function createSkill(input: SkillInput): Promise<Skill> {
  const res = await apiFetch(`/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to create skill"));
  }
  return res.json();
}

export async function importSkill(
  content: string,
  overrides?: Partial<SkillInput>,
): Promise<Skill> {
  const res = await apiFetch(`/skills/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ...overrides }),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to import skill"));
  }
  return res.json();
}

export async function updateSkill(
  id: string,
  input: Partial<SkillInput>,
): Promise<Skill> {
  const res = await apiFetch(`/skills/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to update skill"));
  }
  return res.json();
}

export async function updateSkillVisibility(
  id: string,
  visibility: SkillVisibility,
  teamIds?: string[],
  projectIds?: string[],
): Promise<Skill> {
  const res = await apiFetch(`/skills/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility, teamIds, projectIds }),
  });
  if (!res.ok) {
    throw new Error(
      await extractErrorMessage(res, "Failed to update skill visibility"),
    );
  }
  return res.json();
}

export async function deleteSkill(id: string): Promise<void> {
  const res = await apiFetch(`/skills/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete skill");
}

// AI Tools (admin-configured callable plugins — external HTTP APIs the AI
// can call during chat). Company-wide catalog; only admins mutate. The
// encrypted API key is never returned — `hasApiKey` reports whether one is set.

export type ToolVisibility = "all" | "admins" | "teams" | "project";
export type ToolAuthType =
  | "none"
  | "api_key_header"
  | "api_key_query"
  | "bearer";
export type ToolHttpMethod = "GET" | "POST";

export interface AiTool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  httpMethod: string;
  urlTemplate: string;
  headersTemplate: Record<string, string>;
  queryTemplate: Record<string, string>;
  bodyTemplate: Record<string, unknown>;
  authType: string;
  authParamName: string | null;
  hasApiKey: boolean;
  responsePath: string | null;
  visibility: string;
  isEnabled: boolean;
  monthlyCallLimit: number | null;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  /** Only populated by fetchTool (detail) — prefills the visibility pickers. */
  teamIds?: string[];
  projectIds?: string[];
}

export interface AiToolInput {
  name: string;
  displayName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  httpMethod?: string;
  urlTemplate: string;
  headersTemplate?: Record<string, string>;
  queryTemplate?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  authType?: string;
  /** undefined = leave, null = clear, string = set (write-only). */
  authParamName?: string | null;
  apiKey?: string | null;
  responsePath?: string | null;
  visibility?: string;
  isEnabled?: boolean;
  monthlyCallLimit?: number | null;
  timeoutMs?: number;
  teamIds?: string[];
  projectIds?: string[];
}

export async function fetchTools(): Promise<AiTool[]> {
  const res = await apiFetch(`/tools`);
  if (!res.ok) throw new Error("Failed to load tools");
  return res.json();
}

export async function fetchTool(id: string): Promise<AiTool> {
  const res = await apiFetch(`/tools/${id}`);
  if (!res.ok) throw new Error("Failed to load tool");
  return res.json();
}

export async function createTool(input: AiToolInput): Promise<AiTool> {
  const res = await apiFetch(`/tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to create tool"));
  }
  return res.json();
}

export async function updateTool(
  id: string,
  input: Partial<AiToolInput>,
): Promise<AiTool> {
  const res = await apiFetch(`/tools/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to update tool"));
  }
  return res.json();
}

export async function deleteTool(id: string): Promise<void> {
  const res = await apiFetch(`/tools/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await extractErrorMessage(res, "Failed to delete tool"));
  }
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
  /** Top-level folders return null; nested folders carry the id of
   *  their parent. The KC root view lists only top-level folders;
   *  children surface inside their parent's detail page. */
  parentFolderId: string | null;
  fileCount: number;
  totalBytes: number;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeFileVisibility =
  | "all"
  | "admins"
  | "none"
  | "teams"
  | "project"
  | "schedule";

/**
 * Compact representation of a team link on a knowledge file. Carries
 * just enough to render the row badge ("Teams: HR, Sales") without
 * the FE having to lookup names from a separate query.
 */
export interface KnowledgeFileTeamRef {
  id: string;
  name: string;
}

/**
 * Same shape as KnowledgeFileTeamRef but for the project visibility
 * tier — the row badge can resolve project names without a second
 * round-trip.
 */
export interface KnowledgeFileProjectRef {
  id: string;
  name: string;
}

/**
 * Same shape again for the schedule visibility tier (AI Cron) — the row
 * badge names the schedule(s) the file is attached to.
 */
export interface KnowledgeFileScheduleRef {
  id: string;
  name: string;
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
  // Status of the chunk + embed pipeline so chat RAG can search
  // this file. Surfaced as a badge on the folder detail page.
  ingestionStatus: IngestionDocStatus;
  ingestionError: string | null;
  // Secondary visibility within company scope:
  //   - 'all'     : every company user
  //   - 'admins'  : role='admin' only
  //   - 'teams'   : members of the linked team set
  //   - 'project' : visible only in the chat of linked project(s);
  //                 NEVER in the org-wide RAG.
  visibility: KnowledgeFileVisibility;
  // Populated only when visibility='teams' / 'project'; empty array
  // otherwise. Drives the row badge that names the teams / projects
  // with access.
  teams: KnowledgeFileTeamRef[];
  projects: KnowledgeFileProjectRef[];
  // Populated when the file is attached to AI Cron schedule(s); names the
  // schedule(s). visibility='schedule' files are scoped to these.
  schedules: KnowledgeFileScheduleRef[];
  createdAt: string;
}

export interface KnowledgeFolderDetail {
  id: string;
  name: string;
  ownerId: string;
  /** Null when this is a top-level folder. */
  parentFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  files: KnowledgeFile[];
  /** Direct child folders (one level deep). FE renders them above
   *  the files table as folder cards, same shape as the root view. */
  children: KnowledgeFolder[];
  /** Lineage from root → parent (excluding this folder itself).
   *  Empty for top-level folders. Drives the breadcrumb. */
  breadcrumb: { id: string; name: string }[];
}

export interface KnowledgeRecentFile {
  id: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  folderName: string;
  uploadedByName: string | null;
  ingestionStatus: IngestionDocStatus;
  ingestionError: string | null;
  visibility: KnowledgeFileVisibility;
  teams: KnowledgeFileTeamRef[];
  projects: KnowledgeFileProjectRef[];
  schedules: KnowledgeFileScheduleRef[];
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

/**
 * Sentinel folder id for the virtual "All Files" view on
 * /knowledge-core. NOT a real `knowledge_folders` row — it can't
 * collide with one (real ids are uuids). The folder grid pins a card
 * with this id, and the detail route swaps to fetchAllKnowledgeFiles()
 * when its `[folderId]` param equals this, so a file shows up both in
 * its real folder AND in "All Files" without ever being duplicated.
 */
export const ALL_FILES_FOLDER_ID = "__all__";

/** Real folder that dropzone uploads from the /knowledge-core root
 *  land in, now that "All Files" is a virtual view rather than a real
 *  upload target. Created on demand. Persisted name — not translated. */
export const UPLOADS_FOLDER_NAME = "Uploads";

/**
 * Flat list of every KC file the user owns, across all folders —
 * backs the "All files" option in the Manage Context attach picker
 * AND the virtual "All Files" folder on /knowledge-core. Same file
 * shape as `KnowledgeFolderDetail.files`.
 */
export async function fetchAllKnowledgeFiles(): Promise<KnowledgeFile[]> {
  const res = await apiFetch("/knowledge-core/files");
  if (!res.ok) throw new Error("Failed to fetch files");
  return res.json();
}

export async function createKnowledgeFolder(
  name: string,
  parentFolderId?: string | null,
): Promise<
  Pick<
    KnowledgeFolder,
    "id" | "name" | "ownerId" | "parentFolderId" | "createdAt" | "updatedAt"
  >
> {
  const res = await apiFetch("/knowledge-core/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parentFolderId: parentFolderId ?? null }),
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

/**
 * Per-file duplicate descriptor returned by the upload endpoint when
 * the same SHA-256 content is already in the uploader's Knowledge
 * Core. `existing.id` is null when the duplicate is detected against
 * another file in the same upload batch (no row to link to yet —
 * only the first occurrence got inserted).
 */
export interface KnowledgeUploadDuplicate {
  name: string;
  existing: {
    id: string | null;
    name: string;
    folderId: string;
    folderName: string;
  };
}

/**
 * Surfaced by the BE when an upload hits a same-name-different-bytes
 * row in the *same folder*, under the same uploader. Content-hash
 * duplicates land in `duplicates` instead — these are the cases
 * where the user is plausibly uploading a new revision of a doc and
 * needs to pick what happens to the prior copy.
 */
export interface KnowledgeUploadNameConflict {
  name: string;
  existing: { id: string };
}

export type NameConflictAction = "overwrite" | "keep_both" | "skip";

export interface KnowledgeUploadResult {
  uploaded: Omit<KnowledgeFile, "uploadedByName">[];
  duplicates: KnowledgeUploadDuplicate[];
  nameConflicts: KnowledgeUploadNameConflict[];
}

export async function uploadKnowledgeFiles(
  folderId: string,
  files: File[],
  visibility: KnowledgeFileVisibility = "all",
  teamIds: string[] = [],
  projectIds: string[] = [],
  // Per-name decisions the user picked on the resolution dialog.
  // Keys are the original `File.name` values; values are the action
  // the BE should take for that specific file. Missing entries are
  // treated as 'skip' BE-side, so the safe default is "no map → no
  // overwrite", and the BE will simply bounce conflicts back to the
  // FE again.
  nameConflictActions?: Record<string, NameConflictAction>,
  scheduleIds: string[] = [],
): Promise<KnowledgeUploadResult> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  // Multipart field for the visibility flag. BE enforces that only
  // admins can set 'admins'; non-admin callers can pick 'all',
  // 'teams', 'project', or 'schedule'. 'teams' requires teamIds
  // non-empty; 'project' requires projectIds; 'schedule' requires
  // scheduleIds.
  form.append("visibility", visibility);
  // Append each id as a repeated field — multer parses repeats into
  // an array on the body, matching the controller's expected
  // `string | string[]` shape.
  if (visibility === "teams") {
    teamIds.forEach((id) => form.append("teamIds", id));
  }
  if (visibility === "project") {
    projectIds.forEach((id) => form.append("projectIds", id));
  }
  if (visibility === "schedule") {
    scheduleIds.forEach((id) => form.append("scheduleIds", id));
  }
  if (nameConflictActions && Object.keys(nameConflictActions).length > 0) {
    // Multipart can't carry an object natively; serialise to JSON.
    // The controller parses + validates.
    form.append("nameConflictActions", JSON.stringify(nameConflictActions));
  }
  const res = await apiFetch(`/knowledge-core/folders/${folderId}/files`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to upload files");
  }
  return res.json();
}

/**
 * Flip a knowledge file between 'all' and 'admins' visibility.
 * Admin-only — non-admin callers will get a 403 from the BE.
 */
export async function updateKnowledgeFileVisibility(
  fileId: string,
  visibility: KnowledgeFileVisibility,
  teamIds: string[] = [],
  projectIds: string[] = [],
  scheduleIds: string[] = [],
): Promise<{
  id: string;
  visibility: KnowledgeFileVisibility;
  teamIds: string[];
  projectIds: string[];
  scheduleIds: string[];
}> {
  const res = await apiFetch(
    `/knowledge-core/files/${fileId}/visibility`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // UNION model: `visibility` is the base tier ('all'/'admins'/'none')
      // and the three link sets are independent + additive, so ship them all.
      // The BE replaces each set authoritatively (empty array = clear).
      body: JSON.stringify({ visibility, teamIds, projectIds, scheduleIds }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update visibility");
  }
  return res.json();
}

/**
 * Re-run chunk + embed on a single file so it's available to chat /
 * arena again. Owner-only at the BE; FE just kicks the request and
 * refetches to surface the new "Queued" / "Adding" badge.
 *
 * The endpoint path is still `/reingest` (and the in-memory function
 * keeps that name) — only the user-visible copy was renamed; user
 * surfaces always talk about adding the file to context now.
 */
export async function reingestKnowledgeFile(
  fileId: string,
): Promise<{ id: string; ingestionStatus: "pending" }> {
  const res = await apiFetch(`/knowledge-core/files/${fileId}/reingest`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to include this file in context");
  }
  return res.json();
}

/**
 * Wipe a file's embeddings without deleting the upload. Inverse of
 * `reingestKnowledgeFile` — chunks go away, the file row stays so
 * download still works, and chat-time RAG stops surfacing it until
 * the owner re-includes it.
 *
 * The endpoint path is still `/untrain` (legacy name kept on the BE
 * to avoid a coordinated rename) — user-visible copy now says
 * "Exclude from context".
 */
export async function untrainKnowledgeFile(
  fileId: string,
): Promise<{ id: string; ingestionStatus: "untrained" }> {
  const res = await apiFetch(`/knowledge-core/files/${fileId}/untrain`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to exclude this file from context");
  }
  return res.json();
}

/**
 * Bulk visibility flip — one round-trip, single BE transaction.
 * Admin-only at the BE. Used by the multi-select action bar.
 */
export async function updateKnowledgeFilesVisibilityBulk(
  fileIds: string[],
  visibility: KnowledgeFileVisibility,
): Promise<{
  visibility: KnowledgeFileVisibility;
  affectedIds: string[];
  /** Files skipped because they were mid-ingestion at the time of the
   *  call — BE refuses to flip during processing to avoid leaving
   *  knowledge_files.visibility out of sync with the chunks the
   *  worker is about to insert. Admin can retry once they finish. */
  skippedIds: string[];
}> {
  // Bulk only flips the base tier (UNION model); per-file scopes stay intact.
  const res = await apiFetch(`/knowledge-core/files/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileIds, visibility }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to update visibility");
  }
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

export interface GuardrailTeamLink {
  id: string;
  name: string;
  /** Per-team toggle. Both this AND the rule's master `isActive` must
   *  be true for the evaluator to load the rule for this team. */
  isActive: boolean;
}

export interface GuardrailItem {
  id: string;
  name: string;
  type: string;
  severity: "high" | "medium" | "low";
  triggers: number;
  isActive: boolean;
  /** Org-wide scope — when true, the rule applies to every chat by
   *  every user in the owner's company and the per-team links are
   *  bypassed by the evaluator. `teams` may still be populated (the
   *  links stay in the DB) but the FE treats them as inert while
   *  this flag is on. */
  isOrgWide: boolean;
  validatorType: string | null;
  entities: string[] | null;
  /** Free-form regex string for validatorType === 'regex_match'. Null
   *  for other validators. */
  pattern: string | null;
  target: string | null;
  onFail: string | null;
  templateSource: string | null;
  /** Teams this rule is linked to. Many-to-many — a single rule can
   *  apply to multiple teams, and a team can have multiple rules. */
  teams: GuardrailTeamLink[];
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
  /** Required when validatorType === 'regex_match'. */
  pattern?: string;
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

export async function updateGuardrailItem(
  id: string,
  data: {
    name?: string;
    type?: string;
    severity?: "high" | "medium" | "low";
    validatorType?: string;
    entities?: string[];
    pattern?: string;
    target?: "input" | "output" | "both";
    onFail?: "fix" | "exception";
  },
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Failed to update guardrail");
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

export async function toggleGuardrailOrgWide(
  guardrailId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(
    `/guardrails-section/${guardrailId}/toggle-org-wide`,
    { method: "PATCH" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Failed to toggle org-wide scope");
  }
  return res.json();
}

export async function toggleGuardrailTeamActive(
  guardrailId: string,
  teamId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${guardrailId}/toggle-team`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
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
  teamId: string,
): Promise<GuardrailItem> {
  const res = await apiFetch(`/guardrails-section/${guardrailId}/unassign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teamId }),
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
  /** Subscription plan — every user has at least 'free'. */
  plan: "free" | (string & {});
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
    fileType: string | null;
    createdAt: string;
  }>;
}

export async function fetchOnboardingProfile(): Promise<OnboardingProfile> {
  const res = await apiFetch("/onboarding/profile");
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

/**
 * Edit the company-branch fields (name + companyName + industry +
 * teamSize) after onboarding has completed. Drives the Pencil flow on
 * the Company tab — backed by PATCH /onboarding/profile, which only
 * accepts company-profile users.
 */
export async function updateOnboardingProfile(input: {
  name?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
}): Promise<OnboardingProfile> {
  const res = await apiFetch("/onboarding/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to update profile");
  }
  return res.json();
}

/**
 * Tear down the workspace: drops every team + team-scoped integration
 * and resets the company-shaped onboarding fields on every user.
 * Admin-only. Returns counts so the FE can show what was actually
 * removed in the success toast.
 */
export async function deleteCompanyProfile(): Promise<{
  deletedTeamCount: number;
  affectedUserCount: number;
}> {
  const res = await apiFetch("/onboarding/company", { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to delete company");
  }
  return res.json();
}

// ─── Org-level settings (singleton, currently just monthly budget) ──

export interface OrgSettings {
  id: string;
  /**
   * Monthly company-wide budget target (cents). Tri-state, mirrors
   * team_members.monthlyCapCents:
   *   - null → no target set (gate silent-passes, UI shows "No target")
   *   - 0    → org-wide chat suspended (gate 402s)
   *   - >0   → enforced when org spend + estimate >= cap
   */
  monthlyBudgetCents: number | null;
  /** Org-wide default for whether projects may use web search. */
  webSearchEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchOrgSettings(): Promise<OrgSettings> {
  const res = await apiFetch("/org-settings");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to fetch org settings");
  }
  return res.json();
}

export async function updateOrgSettings(input: {
  /** undefined → leave alone; null → clear target (no enforcement);
   *  0 → suspend org-wide chat; >0 → enforced cap. */
  monthlyBudgetCents?: number | null;
  /** Org-wide web-search capability toggle. */
  webSearchEnabled?: boolean;
}): Promise<OrgSettings> {
  const res = await apiFetch("/org-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to update org settings");
  }
  return res.json();
}

/**
 * Resume-flow draft. Mirrors the BE `OnboardingDraft` — every field
 * optional, no API keys, no files. Persisted server-side per user
 * (PK = userId) and dropped once onboarding completes.
 */
export interface OnboardingDraft {
  profileType?: "company" | "personal";
  fullName?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
  infraChoice?: "managed" | "on-premise";
}

export async function fetchOnboardingDraft(): Promise<OnboardingDraft | null> {
  const res = await apiFetch("/onboarding/draft", { skipAuthRedirect: true });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { draft: OnboardingDraft | null };
  return body.draft ?? null;
}

export async function updateOnboardingDraft(
  draft: OnboardingDraft,
): Promise<OnboardingDraft> {
  const res = await apiFetch("/onboarding/draft", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error("Failed to save onboarding draft");
  const body = (await res.json()) as { draft: OnboardingDraft };
  return body.draft;
}

export async function deleteOnboardingDraft(): Promise<void> {
  await apiFetch("/onboarding/draft", { method: "DELETE" });
}

/**
 * Escape hatch for a user stuck mid-onboarding. Wipes the BE user
 * row + clears the auth cookies; the caller is responsible for the
 * client-side redirect (typically to /register so the freed email
 * can be re-used).
 */
export async function abortOnboarding(): Promise<void> {
  const res = await apiFetch("/onboarding/abort", { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message || "Failed to abort onboarding");
  }
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
  /** Azure-only companion to apiKeys.azure: endpoint + api-version +
   *  deployments. The BE drops the azure key if this is incomplete. */
  azureConfig?: IntegrationConfig;
  /** Visibility for the knowledge files uploaded in step 6. Only
   *  honoured for `profileType: "company"` — personal uploads are
   *  owner-only via the scope filter regardless. Defaults to 'all'. */
  knowledgeVisibility?: KnowledgeFileVisibility;
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

export type IngestionDocStatus =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "untrained";

export interface IngestionStatusResponse {
  total: number;
  pending: number;
  processing: number;
  done: number;
  failed: number;
  inProgress: boolean;
  documents: Array<{
    id: string;
    filename: string;
    status: IngestionDocStatus;
    error: string | null;
  }>;
}

/**
 * Polled by step-6 progress UI after `completeOnboarding`. Returns the
 * aggregated ingestion state for the caller's knowledge documents.
 * `inProgress=false` means the FE can move on (some may still be
 * `failed`, but no new work is queued).
 */
export async function getOnboardingIngestionStatus(): Promise<IngestionStatusResponse> {
  const res = await apiFetch("/onboarding/ingestion-status");
  if (!res.ok) throw new Error("Failed to load ingestion status");
  return (await res.json()) as IngestionStatusResponse;
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

/**
 * Un-paginated event fetch used by the CSV export button. Same
 * filter shape as `fetchObservabilityEvents` minus pagination — the
 * BE caps the result at `maxRows` (currently 10k) and sets
 * `truncated=true` when the cap was hit so the FE can warn the user
 * to narrow the filter before re-exporting.
 */
export interface ObservabilityEventsExport {
  range: ObservabilityRange;
  total: number;
  truncated: boolean;
  maxRows: number;
  events: ObservabilityEvent[];
}

export interface ObservabilityEventsExportQuery {
  range: ObservabilityRange;
  search?: string;
  eventType?: string;
}

export function fetchObservabilityEventsExport(
  query: ObservabilityEventsExportQuery,
): Promise<ObservabilityEventsExport> {
  const params = new URLSearchParams({ range: query.range });
  if (query.search?.trim()) params.set("search", query.search.trim());
  if (query.eventType) params.set("eventType", query.eventType);
  return fetchObservability(
    `/observability/events/export?${params.toString()}`,
  );
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

/** One Azure OpenAI deployment (Azure-side name + picker label). */
export interface AzureDeployment {
  deploymentName: string;
  label: string;
}

/** Provider-specific config. `{}` for everything except Azure OpenAI. */
export interface IntegrationConfig {
  azureEndpoint?: string;
  azureApiVersion?: string;
  azureDeployments?: AzureDeployment[];
}

export interface IntegrationCard {
  id: string | null; // null when no DB row exists yet (untouched predefined)
  providerId: string;
  displayName: string;
  description: string;
  iconHint: string;
  apiUrl: string | null;
  /** Custom only: the real upstream model id, to seed the edit form. */
  upstreamModel?: string | null;
  hasApiKey: boolean;
  isEnabled: boolean;
  isCustom: boolean;
  /** Provider-specific config. `{}` except for Azure OpenAI. */
  config: IntegrationConfig;
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
  /**
   * When true, members of teams this key is linked into may also use it
   * in their own personal projects/chats — not just inside the team.
   */
  allowPersonalUse: boolean;
  /**
   * Monthly usage cap for this key, counted in tokens. null = no limit,
   * 0 = paused, >0 = enforced (chat blocked once month-to-date tokens
   * cross it). $ figures are display-only and only known for providers
   * with catalog pricing.
   */
  monthlyTokenLimit: number | null;
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
  /** Required when providerId === "custom": the friendly name shown
   *  in the model picker. The BE auto-creates a bound model_configs
   *  alias so adding a Custom LLM lands in one step. */
  customName?: string;
  /** Required when providerId === "custom": the real model id the
   *  endpoint expects (e.g. "Qwen3.6-35B-A3B-FP8"), sent as `model`
   *  in the upstream chat call. */
  customModel?: string;
  /** Required when providerId === "azure": endpoint + api-version +
   *  deployments. */
  config?: IntegrationConfig;
  /** Allow members of linked teams to use this key in personal scope. */
  allowPersonalUse?: boolean;
  /** Monthly token usage cap (null = no limit, 0 = paused, >0 = enforced). */
  monthlyTokenLimit?: number | null;
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
  input: {
    isEnabled?: boolean;
    apiKey?: string | null;
    config?: IntegrationConfig;
    allowPersonalUse?: boolean;
    monthlyTokenLimit?: number | null;
    // Custom LLM field edits (ignored for predefined/azure).
    customName?: string;
    apiUrl?: string;
    customModel?: string;
  },
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

/** Month-to-date usage of a single key, broken down per user. Owner-only. */
export interface KeyUsage {
  integrationId: string;
  monthlyTokenLimit: number | null;
  totalTokens: number;
  totalCostUsd: number;
  perUser: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    tokens: number;
    costUsd: number;
    calls: number;
  }>;
}

export async function fetchKeyUsage(id: string): Promise<KeyUsage> {
  const res = await apiFetch(`/integrations/${id}/usage`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to fetch key usage");
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

// ─── Team-scoped integrations (BYOK keys shared across team members) ──────

// ── Integration links (new picker model) ──────────────────────────
//
// Replaces the legacy team-scoped integrations endpoints above:
// admins manage their personal BYOK keys on /teams?tab=integration,
// then link them into one or more teams via these endpoints. The
// FE picker on team-details only uses these — the legacy helpers
// above are kept for the transition.

export interface TeamIntegrationLink {
  integrationId: string;
  // Identity of the integration owner — lets the FE picker tell
  // "my key" (editable checkbox + trash) apart from "someone else's
  // key" (read-only with per-team toggle only). Pair with the
  // caller's user id from the auth store.
  ownerId: string;
  ownerName: string | null;
  providerId: string;
  isCustom: boolean;
  displayName: string;
  apiUrl: string | null;
  hasApiKey: boolean;
  // Per-team toggle. False ⇒ chat-time routing for this team skips
  // this key even if the underlying integration is on.
  linkEnabled: boolean;
  // Master switch on the integration owner's personal /teams?tab=
  // integration tab. False ⇒ key is off everywhere; team toggle
  // becomes a no-op until the owner re-enables it.
  integrationEnabled: boolean;
  linkedAt: string;
  linkedBy: string | null;
}

export interface LinkableIntegration {
  integrationId: string;
  providerId: string;
  isCustom: boolean;
  displayName: string;
  apiUrl: string | null;
  hasApiKey: boolean;
  integrationEnabled: boolean;
  alreadyLinked: boolean;
  // Predefined-provider-only: another integration already occupies
  // this provider slot for the team. FE disables the checkbox +
  // explains in tooltip ("One Anthropic key per team").
  blockedByProvider: boolean;
}

export async function fetchTeamIntegrationLinks(
  teamId: string,
): Promise<TeamIntegrationLink[]> {
  const res = await apiFetch(`/teams/${teamId}/integration-links`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to fetch team integration links");
  }
  return res.json();
}

export async function fetchLinkableIntegrations(
  teamId: string,
): Promise<LinkableIntegration[]> {
  const res = await apiFetch(`/teams/${teamId}/integration-links/linkable`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to fetch linkable integrations");
  }
  return res.json();
}

/**
 * Replace the team's link set atomically. Pass the complete list of
 * integrationIds that should be linked after the save; the BE
 * computes the delta and adds/removes accordingly. Returns the new
 * link list so the caller can update local state without a second
 * round-trip.
 */
export async function setTeamIntegrationLinks(
  teamId: string,
  integrationIds: string[],
): Promise<TeamIntegrationLink[]> {
  const res = await apiFetch(`/teams/${teamId}/integration-links`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ integrationIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to save integration links");
  }
  return res.json();
}

export async function setTeamIntegrationLinkEnabled(
  teamId: string,
  integrationId: string,
  isEnabled: boolean,
): Promise<TeamIntegrationLink[]> {
  const res = await apiFetch(
    `/teams/${teamId}/integration-links/${integrationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to toggle integration link");
  }
  return res.json();
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

// ─── Notifications ───────────────────────────────────────────────────

/**
 * Discriminated `type` values the BE emits. Loose-typed string at
 * the wire so a new type added on the BE doesn't break the FE; the
 * union covers the renderer-aware ones.
 */
export type NotificationType =
  | "team_invite"
  | "org_invite"
  | "budget_alert"
  | "budget_changed"
  | "team_renamed"
  | "team_role_changed"
  | "team_member_added"
  | "team_member_removed"
  | "team_deleted"
  | "account_role_changed"
  | "account_budget_changed"
  | "member_cap_changed"
  | "file_ingestion_failed"
  | "knowledge_import_complete"
  | "project_created"
  | "project_deleted"
  | "guardrail_added"
  | (string & {});

export type NotificationStatus = "pending" | "acted" | "dismissed";

/**
 * State of the underlying team_members row for a `team_invite`
 * notification. The BE joins this on list so the popover can swap
 * the Accept/Decline buttons for an Accepted/Declined/Expired pill
 * even when the invite was finalised through a different channel
 * (email link, owner revoke, expiry sweep). Undefined for non-
 * invite types and orphaned rows.
 */
export type TeamInviteState =
  | "pending"
  | "accepted"
  | "declined"
  | "expired";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Discriminated payload — schema depends on `type`. Renderers
   *  cast within their branch. */
  data: Record<string, unknown>;
  status: NotificationStatus;
  readAt: string | null;
  createdAt: string;
  /** Set only for `type === 'team_invite'`. See TeamInviteState. */
  inviteState?: TeamInviteState;
}

export async function fetchNotifications(): Promise<Notification[]> {
  const res = await apiFetch("/notifications");
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function fetchNotificationsUnreadCount(): Promise<{ count: number }> {
  const res = await apiFetch("/notifications/unread-count");
  if (!res.ok) throw new Error("Failed to fetch unread count");
  return res.json();
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const res = await apiFetch(`/notifications/${id}/read`, { method: "PATCH" });
  if (!res.ok) throw new Error("Failed to mark notification read");
  return res.json();
}

export async function markAllNotificationsRead(): Promise<{ markedCount: number }> {
  const res = await apiFetch("/notifications/read-all", { method: "PATCH" });
  if (!res.ok) throw new Error("Failed to mark all read");
  return res.json();
}

export async function acceptNotification(id: string): Promise<{
  type: NotificationType;
  teamId?: string;
  /**
   * True when the BE caught a terminal-state error from the
   * underlying invite (already accepted via another channel,
   * expired, revoked) and resolved the notification idempotently.
   * Lets the caller swap the success toast for an "already resolved"
   * variant instead of misleading the user.
   */
  alreadyResolved?: boolean;
  terminalState?: TeamInviteState;
}> {
  const res = await apiFetch(`/notifications/${id}/accept`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to accept");
  }
  return res.json();
}

export async function declineNotification(id: string): Promise<{ ok: true }> {
  const res = await apiFetch(`/notifications/${id}/decline`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to decline");
  }
  return res.json();
}

export async function dismissNotification(id: string): Promise<{ id: string }> {
  const res = await apiFetch(`/notifications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to dismiss notification");
  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// Google Drive — Knowledge Core integration
// ──────────────────────────────────────────────────────────────────

export interface DriveStatus {
  connected: boolean;
  accountEmail?: string;
  status?: "active" | "reauth_required";
  scope?: string;
  lastSyncedAt?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

export interface DriveSource {
  id: string;
  scope: "all" | "folder";
  driveFolderId: string | null;
  driveFolderName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface DriveImportResult {
  added: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  /** Files skipped at import time because Drive reported a size above
   *  the per-file cap. Surfaced in the post-import toast so the user
   *  knows why fewer files than expected ended up in KC. */
  skippedTooLarge: number;
  sources: { id: string; driveFolderName: string }[];
}

export type DriveImportScope = (
  | { kind: "all" }
  | { kind: "folders"; folderIds: string[] }
) & {
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
};

export async function fetchDriveStatus(): Promise<DriveStatus> {
  const res = await apiFetch("/google-drive/status");
  if (!res.ok) throw new Error("Failed to fetch Drive status");
  return res.json();
}

/**
 * Kick off the OAuth flow. Hard-redirects the browser to the API's
 * connect endpoint, which 302s on to Google's consent screen. Google
 * sends the user back to /google-drive/callback, and the API in turn
 * 302s back to `/knowledge-core?drive=connected | ?drive=error=...`.
 *
 * Uses the same BASE_URL the rest of api.ts uses (with the same
 * `http://localhost:3001` dev fallback) so this routes to the API
 * even when NEXT_PUBLIC_API_URL isn't set — a missing env var would
 * otherwise resolve to the FE's own origin and the user would land
 * on a Next.js 404 instead of Google's consent screen.
 */
export function connectDrive(): void {
  window.location.href = `${BASE_URL}/google-drive/connect`;
}

export async function disconnectDrive(): Promise<void> {
  const res = await apiFetch("/google-drive/connection", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect Google Drive");
}

export async function fetchDriveFolders(
  parentId?: string,
): Promise<DriveFolder[]> {
  const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
  const res = await apiFetch(`/google-drive/folders${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list Drive folders");
  }
  return res.json();
}

export async function importFromDrive(
  scope: DriveImportScope,
): Promise<DriveImportResult> {
  const res = await apiFetch("/knowledge-core/drive/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to import from Drive");
  }
  return res.json();
}

export async function fetchDriveSources(): Promise<DriveSource[]> {
  const res = await apiFetch("/knowledge-core/drive/sources");
  if (!res.ok) throw new Error("Failed to list Drive sources");
  return res.json();
}

export async function resyncDriveSource(
  sourceId: string,
): Promise<DriveImportResult> {
  const res = await apiFetch(
    `/knowledge-core/drive/sources/${sourceId}/resync`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to re-sync Drive source");
  }
  return res.json();
}

export async function deleteDriveSource(sourceId: string): Promise<void> {
  const res = await apiFetch(`/knowledge-core/drive/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete Drive source");
}

/**
 * One-page estimate of how many files the Entire Drive import would pick
 * up. Fast (< 1 s for most users). `hasMore: true` means the Drive has
 * more than 1 000 importable files — fall back to the generic cap message.
 */
export async function fetchDriveFileCount(): Promise<{
  count: number;
  hasMore: boolean;
}> {
  const res = await apiFetch("/knowledge-core/drive/file-count");
  if (!res.ok) throw new Error("Failed to estimate Drive file count");
  return res.json();
}

// ── Async (progress-tracked) Entire-Drive import ──────────────────

export interface DriveImportProgress {
  phase: "scanning" | "importing" | "done" | "cancelled" | "error";
  /** Files seen during the Drive list-API scan. */
  scanned: number;
  /**
   * New files ready to insert after filtering + dedup.
   * Zero until scanning completes.
   */
  total: number;
  /** Rows inserted so far. */
  imported: number;
  /** Set when phase === "error". */
  error?: string;
}

/**
 * Kick off a background Entire-Drive import. Returns immediately with
 * `{ started: true }`; poll `fetchDriveImportProgress` every ~2s to
 * track the job.
 */
export async function startDriveImportAsync(
  scope: {
    kind: "all";
    visibility?: KnowledgeFileVisibility;
    teamIds?: string[];
    projectIds?: string[];
    scheduleIds?: string[];
  },
): Promise<{ started: true }> {
  const res = await apiFetch("/knowledge-core/drive/import/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to start Drive import");
  }
  return res.json();
}

/**
 * Fetch the current progress of an in-flight async Drive import.
 * Returns null when no job is active for this user.
 */
export async function fetchDriveImportProgress(): Promise<DriveImportProgress | null> {
  const res = await apiFetch("/knowledge-core/drive/import/progress");
  if (!res.ok) throw new Error("Failed to fetch import progress");
  const body = (await res.json()) as { progress: DriveImportProgress | null };
  return body.progress;
}

/**
 * Cancel the user's running async import and roll back all inserted
 * rows. Silently succeeds if no import is active.
 */
export async function cancelDriveImport(): Promise<{ cancelled: true }> {
  const res = await apiFetch("/knowledge-core/drive/import/active", {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to cancel Drive import");
  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// Confluence (Atlassian) — Knowledge Core integration
// ──────────────────────────────────────────────────────────────────

export interface ConfluenceStatus {
  connected: boolean;
  accountEmail?: string;
  status?: "active" | "reauth_required";
  scope?: string;
  lastSyncedAt?: string;
}

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
}

export interface ConfluencePage {
  id: string;
  title: string;
  parentId: string | null;
  hasChildren: boolean;
  webUrl: string | null;
}

export interface ConfluenceSource {
  id: string;
  scope: "space" | "page";
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  pageId: string | null;
  pageTitle: string | null;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface ConfluenceImportResult {
  added: number;
  skippedDuplicates: number;
  sources: { id: string; spaceName: string }[];
}

export type ConfluenceImportScope = (
  | { kind: "space"; spaceId: string }
  | { kind: "pages"; spaceId: string; pageIds: string[] }
) & {
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
};

export interface ConfluenceImportProgress {
  phase: "scanning" | "importing" | "done" | "cancelled" | "error";
  scanned: number;
  total: number;
  imported: number;
  error?: string;
}

export async function fetchConfluenceStatus(): Promise<ConfluenceStatus> {
  const res = await apiFetch("/confluence/status");
  if (!res.ok) throw new Error("Failed to fetch Confluence status");
  return res.json();
}

/**
 * Kick off the Atlassian OAuth flow. Hard-redirects the browser to the API's
 * connect endpoint, which 302s on to Atlassian's consent screen. The API
 * redirects back to `/knowledge-core?confluence=connected | =error=...`.
 * Uses BASE_URL (with the same localhost:3001 dev fallback) so this routes
 * to the API even when NEXT_PUBLIC_API_URL isn't set.
 */
export function connectConfluence(): void {
  window.location.href = `${BASE_URL}/confluence/connect`;
}

export async function disconnectConfluence(): Promise<void> {
  const res = await apiFetch("/confluence/connection", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect Confluence");
}

export async function fetchConfluenceSpaces(): Promise<ConfluenceSpace[]> {
  const res = await apiFetch("/confluence/spaces");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list Confluence spaces");
  }
  return res.json();
}

export async function fetchConfluencePages(
  spaceId: string,
): Promise<ConfluencePage[]> {
  const res = await apiFetch(
    `/confluence/spaces/${encodeURIComponent(spaceId)}/pages`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list Confluence pages");
  }
  return res.json();
}

export async function importFromConfluence(
  scope: ConfluenceImportScope,
): Promise<ConfluenceImportResult> {
  const res = await apiFetch("/knowledge-core/confluence/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to import from Confluence");
  }
  return res.json();
}

export async function fetchConfluenceSources(): Promise<ConfluenceSource[]> {
  const res = await apiFetch("/knowledge-core/confluence/sources");
  if (!res.ok) throw new Error("Failed to list Confluence sources");
  return res.json();
}

export async function resyncConfluenceSource(
  sourceId: string,
): Promise<ConfluenceImportResult> {
  const res = await apiFetch(
    `/knowledge-core/confluence/sources/${sourceId}/resync`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to re-sync Confluence source");
  }
  return res.json();
}

export async function deleteConfluenceSource(sourceId: string): Promise<void> {
  const res = await apiFetch(`/knowledge-core/confluence/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete Confluence source");
}

/**
 * Page-count estimate for a space — powers the "Entire space" warning banner.
 * `hasMore: true` means the space exceeds the import cap.
 */
export async function fetchConfluenceSpaceFileCount(
  spaceId: string,
): Promise<{ count: number; hasMore: boolean }> {
  const res = await apiFetch(
    `/knowledge-core/confluence/spaces/${encodeURIComponent(spaceId)}/file-count`,
  );
  if (!res.ok) throw new Error("Failed to estimate Confluence page count");
  return res.json();
}

/**
 * Kick off a background whole-space import. Returns immediately with
 * `{ started: true }`; poll `fetchConfluenceImportProgress` to track it.
 */
export async function startConfluenceImportAsync(scope: {
  kind: "space";
  spaceId: string;
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
}): Promise<{ started: true }> {
  const res = await apiFetch("/knowledge-core/confluence/import/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to start Confluence import");
  }
  return res.json();
}

export async function fetchConfluenceImportProgress(): Promise<ConfluenceImportProgress | null> {
  const res = await apiFetch("/knowledge-core/confluence/import/progress");
  if (!res.ok) throw new Error("Failed to fetch import progress");
  const body = (await res.json()) as {
    progress: ConfluenceImportProgress | null;
  };
  return body.progress;
}

export async function cancelConfluenceImport(): Promise<{ cancelled: true }> {
  const res = await apiFetch("/knowledge-core/confluence/import/active", {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to cancel Confluence import");
  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// SharePoint (Microsoft Graph) — Knowledge Core integration
// ──────────────────────────────────────────────────────────────────

export interface SharePointStatus {
  connected: boolean;
  accountEmail?: string;
  status?: "active" | "reauth_required";
  scope?: string;
  lastSyncedAt?: string;
  /**
   * Whether the underlying Microsoft connection row exists at all
   * (regardless of which products are enabled). Lets the FE decide
   * whether the Connect button needs a full OAuth round-trip or can
   * just toggle the per-product feature flag via /enable.
   */
  connectionExists?: boolean;
  /**
   * Whether the OTHER Microsoft product (OneDrive in this case) is
   * currently enabled on the same connection. Drives the confirm
   * dialog's mode selection (initial / addon / disconnect).
   */
  otherProductEnabled?: boolean;
}

export interface SharePointSite {
  id: string;
  name: string;
  displayName: string;
  webUrl?: string;
}

export interface SharePointDrive {
  id: string;
  name: string;
  driveType?: string;
  webUrl?: string;
}

export interface SharePointFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

export interface SharePointSource {
  id: string;
  scope: "site" | "folder";
  siteId: string;
  siteName: string;
  driveId: string | null;
  driveName: string | null;
  folderId: string | null;
  folderName: string | null;
  /** Human-readable label for the chip — site name or folder name. */
  displayName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface SharePointImportResult {
  added: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  skippedTooLarge: number;
  sources: { id: string; displayName: string }[];
}

export type SharePointImportScope = (
  | { kind: "site"; siteId: string }
  | {
      kind: "folder";
      siteId: string;
      driveId: string;
      folderIds: string[];
    }
) & {
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
};

export async function fetchSharePointStatus(): Promise<SharePointStatus> {
  const res = await apiFetch("/sharepoint/status");
  if (!res.ok) throw new Error("Failed to fetch SharePoint status");
  return res.json();
}

/**
 * Kick off the Microsoft OAuth flow for SharePoint. `products`
 * encodes the confirm-dialog choice: `['sharepoint']` for "Just
 * SharePoint" or `['sharepoint', 'onedrive']` for "Both products".
 * Defaults to `['sharepoint']`.
 */
export function connectSharePoint(
  products: ("sharepoint" | "onedrive")[] = ["sharepoint"],
): void {
  const qs = products.join(",");
  window.location.href = `${BASE_URL}/sharepoint/connect?products=${encodeURIComponent(qs)}`;
}

/**
 * Enable the SharePoint feature on an EXISTING Microsoft connection
 * (no OAuth round-trip). Throws 400 if no connection exists. Used by
 * the "Microsoft already connected via OneDrive — just enable SP"
 * confirm-dialog branch.
 */
export async function enableSharePoint(): Promise<void> {
  const res = await apiFetch("/sharepoint/enable", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to enable SharePoint");
  }
}

/**
 * Disconnect SharePoint. `both=true` deletes the whole Microsoft
 * connection row (also disconnects OneDrive if enabled). `both=false`
 * (default) only flips the SharePoint feature flag off.
 */
export async function disconnectSharePoint(both = false): Promise<void> {
  const url = `/sharepoint/connection${both ? "?both=true" : ""}`;
  const res = await apiFetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect SharePoint");
}

/**
 * Why the BE returned zero SharePoint sites. The FE picks an
 * empty-state message based on this code instead of showing a
 * fuzzy "could be one of these" list of possibilities.
 *
 *   - `msa`         : Personal Microsoft account — no SharePoint.
 *   - `none_found`  : Both Graph endpoints returned 0 sites. User
 *                     hasn't followed any sites yet and tenant-wide
 *                     search is also empty.
 *   - `graph_error` : Microsoft Graph returned an error
 *                     (typically `generalException` for tenants
 *                     without SP licence / provisioning). `detail`
 *                     carries the raw error + request-id.
 */
export type SharePointSitesEmptyReason = "msa" | "none_found" | "graph_error";

export interface SharePointSitesResponse {
  sites: SharePointSite[];
  /** Set only when `sites` is empty. */
  emptyReason?: SharePointSitesEmptyReason;
  /** Raw Graph error for `graph_error` — contains request-id when present. */
  detail?: string;
}

export async function fetchSharePointSites(): Promise<SharePointSitesResponse> {
  const res = await apiFetch("/sharepoint/sites");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list SharePoint sites");
  }
  return res.json();
}

export async function fetchSharePointDrives(
  siteId: string,
): Promise<SharePointDrive[]> {
  const res = await apiFetch(
    `/sharepoint/sites/${encodeURIComponent(siteId)}/drives`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list SharePoint drives");
  }
  return res.json();
}

export async function fetchSharePointFolders(
  siteId: string,
  driveId: string,
  parentId?: string,
): Promise<SharePointFolder[]> {
  const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
  const res = await apiFetch(
    `/sharepoint/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/folders${qs}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list SharePoint folders");
  }
  return res.json();
}

export async function importFromSharePoint(
  scope: SharePointImportScope,
): Promise<SharePointImportResult> {
  const res = await apiFetch("/knowledge-core/sharepoint/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to import from SharePoint");
  }
  return res.json();
}

export async function fetchSharePointSources(): Promise<SharePointSource[]> {
  const res = await apiFetch("/knowledge-core/sharepoint/sources");
  if (!res.ok) throw new Error("Failed to list SharePoint sources");
  return res.json();
}

export async function resyncSharePointSource(
  sourceId: string,
): Promise<SharePointImportResult> {
  const res = await apiFetch(
    `/knowledge-core/sharepoint/sources/${sourceId}/resync`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to re-sync SharePoint source");
  }
  return res.json();
}

export async function deleteSharePointSource(sourceId: string): Promise<void> {
  const res = await apiFetch(
    `/knowledge-core/sharepoint/sources/${sourceId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete SharePoint source");
}

export async function fetchSharePointSiteFileCount(
  siteId: string,
): Promise<{ count: number; hasMore: boolean }> {
  const res = await apiFetch(
    `/knowledge-core/sharepoint/sites/${encodeURIComponent(siteId)}/file-count`,
  );
  if (!res.ok) throw new Error("Failed to estimate SharePoint file count");
  return res.json();
}

// ── Async (progress-tracked) whole-site import ────────────────────

export interface SharePointImportProgress {
  phase: "scanning" | "importing" | "done" | "cancelled" | "error";
  scanned: number;
  total: number;
  imported: number;
  error?: string;
}

export async function startSharePointImportAsync(scope: {
  kind: "site";
  siteId: string;
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
}): Promise<{ started: true }> {
  const res = await apiFetch("/knowledge-core/sharepoint/import/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to start SharePoint import");
  }
  return res.json();
}

export async function fetchSharePointImportProgress(): Promise<SharePointImportProgress | null> {
  const res = await apiFetch("/knowledge-core/sharepoint/import/progress");
  if (!res.ok) throw new Error("Failed to fetch import progress");
  const body = (await res.json()) as {
    progress: SharePointImportProgress | null;
  };
  return body.progress;
}

export async function cancelSharePointImport(): Promise<{ cancelled: true }> {
  const res = await apiFetch("/knowledge-core/sharepoint/import/active", {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to cancel SharePoint import");
  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// OneDrive — Knowledge Core integration (shares Microsoft connection)
// ──────────────────────────────────────────────────────────────────

export interface OneDriveStatus {
  connected: boolean;
  accountEmail?: string;
  status?: "active" | "reauth_required";
  scope?: string;
  lastSyncedAt?: string;
  connectionExists?: boolean;
  otherProductEnabled?: boolean;
}

export interface OneDriveFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

export interface OneDriveSource {
  id: string;
  scope: "all" | "folder";
  onedriveFolderId: string | null;
  onedriveFolderName: string;
  lastSyncedAt: string;
  fileCountAtLastSync: number;
  createdAt: string;
}

export interface OneDriveImportResult {
  added: number;
  skippedDuplicates: number;
  skippedUnsupported: number;
  skippedTooLarge: number;
  sources: { id: string; onedriveFolderName: string }[];
}

export type OneDriveImportScope = (
  | { kind: "all" }
  | { kind: "folders"; folderIds: string[] }
) & {
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
};

export async function fetchOneDriveStatus(): Promise<OneDriveStatus> {
  const res = await apiFetch("/onedrive/status");
  if (!res.ok) throw new Error("Failed to fetch OneDrive status");
  return res.json();
}

/**
 * Kick off the Microsoft OAuth flow for OneDrive. `products` encodes
 * the confirm-dialog choice; defaults to `['onedrive']`.
 */
export function connectOneDrive(
  products: ("sharepoint" | "onedrive")[] = ["onedrive"],
): void {
  const qs = products.join(",");
  window.location.href = `${BASE_URL}/onedrive/connect?products=${encodeURIComponent(qs)}`;
}

/**
 * Enable the OneDrive feature on an EXISTING Microsoft connection
 * (no OAuth round-trip). Used by the "Microsoft already connected
 * via SharePoint — just enable OneDrive" confirm-dialog branch.
 */
export async function enableOneDrive(): Promise<void> {
  const res = await apiFetch("/onedrive/enable", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to enable OneDrive");
  }
}

export async function disconnectOneDrive(both = false): Promise<void> {
  const url = `/onedrive/connection${both ? "?both=true" : ""}`;
  const res = await apiFetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect OneDrive");
}

export async function fetchOneDriveFolders(
  parentId?: string,
): Promise<OneDriveFolder[]> {
  const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
  const res = await apiFetch(`/onedrive/folders${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to list OneDrive folders");
  }
  return res.json();
}

export async function importFromOneDrive(
  scope: OneDriveImportScope,
): Promise<OneDriveImportResult> {
  const res = await apiFetch("/knowledge-core/onedrive/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to import from OneDrive");
  }
  return res.json();
}

export async function fetchOneDriveSources(): Promise<OneDriveSource[]> {
  const res = await apiFetch("/knowledge-core/onedrive/sources");
  if (!res.ok) throw new Error("Failed to list OneDrive sources");
  return res.json();
}

export async function resyncOneDriveSource(
  sourceId: string,
): Promise<OneDriveImportResult> {
  const res = await apiFetch(
    `/knowledge-core/onedrive/sources/${sourceId}/resync`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to re-sync OneDrive source");
  }
  return res.json();
}

export async function deleteOneDriveSource(sourceId: string): Promise<void> {
  const res = await apiFetch(`/knowledge-core/onedrive/sources/${sourceId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete OneDrive source");
}

export async function fetchOneDriveFileCount(): Promise<{
  count: number;
  hasMore: boolean;
}> {
  const res = await apiFetch("/knowledge-core/onedrive/file-count");
  if (!res.ok) throw new Error("Failed to estimate OneDrive file count");
  return res.json();
}

export interface OneDriveImportProgress {
  phase: "scanning" | "importing" | "done" | "cancelled" | "error";
  scanned: number;
  total: number;
  imported: number;
  error?: string;
}

export async function startOneDriveImportAsync(scope: {
  kind: "all";
  visibility?: KnowledgeFileVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
}): Promise<{ started: true }> {
  const res = await apiFetch("/knowledge-core/onedrive/import/async", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || "Failed to start OneDrive import");
  }
  return res.json();
}

export async function fetchOneDriveImportProgress(): Promise<OneDriveImportProgress | null> {
  const res = await apiFetch("/knowledge-core/onedrive/import/progress");
  if (!res.ok) throw new Error("Failed to fetch import progress");
  const body = (await res.json()) as {
    progress: OneDriveImportProgress | null;
  };
  return body.progress;
}

export async function cancelOneDriveImport(): Promise<{ cancelled: true }> {
  const res = await apiFetch("/knowledge-core/onedrive/import/active", {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to cancel OneDrive import");
  return res.json();
}

// ---------------------------------------------------------------------------
// AI Cron — scheduled prompts
// ---------------------------------------------------------------------------

export interface ScheduledPrompt {
  id: string;
  ownerId: string;
  teamId: string | null;
  name: string;
  prompt: string;
  context: string | null;
  modelIdentifier: string;
  cronExpression: string;
  timezone: string;
  useKnowledgeCore: boolean;
  knowledgeFolderId: string | null;
  useWebSearch: boolean;
  deliverInApp: boolean;
  deliverEmail: boolean;
  deliverWebhook: boolean;
  emailRecipients: string[] | null;
  /** Extra in-app notification recipients (company member user ids). */
  notifyUserIds: string[] | null;
  webhookUrl: string | null;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPromptRun {
  id: string;
  scheduledPromptId: string;
  status: "pending" | "running" | "success" | "failed";
  triggeredBy: "schedule" | "manual";
  startedAt: string | null;
  finishedAt: string | null;
  output: string | null;
  errorMessage: string | null;
  model: string | null;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: string | null;
  latencyMs: number | null;
  deliveryStatus: Record<string, string> | null;
  createdAt: string;
}

export interface ScheduledPromptInput {
  name: string;
  prompt: string;
  context?: string | null;
  modelIdentifier: string;
  cronExpression: string;
  timezone?: string;
  teamId?: string | null;
  useKnowledgeCore?: boolean;
  knowledgeFolderId?: string | null;
  useWebSearch?: boolean;
  deliverInApp?: boolean;
  deliverEmail?: boolean;
  deliverWebhook?: boolean;
  emailRecipients?: string[];
  /** Extra in-app notification recipients (company member user ids). */
  notifyUserIds?: string[];
  webhookUrl?: string | null;
  isEnabled?: boolean;
}

export interface CronDescription {
  valid: boolean;
  error?: string;
  description?: string;
  nextRuns?: string[];
  minIntervalMinutes?: number;
}

export async function fetchScheduledPrompts(): Promise<ScheduledPrompt[]> {
  const res = await apiFetch("/ai-cron");
  if (!res.ok) throw new Error("Failed to fetch scheduled prompts");
  return res.json();
}

export async function fetchScheduledPrompt(
  id: string,
): Promise<ScheduledPrompt> {
  const res = await apiFetch(`/ai-cron/${id}`);
  if (!res.ok) throw new Error("Failed to fetch scheduled prompt");
  return res.json();
}

export async function createScheduledPrompt(
  data: ScheduledPromptInput,
): Promise<ScheduledPrompt> {
  const res = await apiFetch("/ai-cron", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create scheduled prompt");
  return res.json();
}

export async function updateScheduledPrompt(
  id: string,
  data: Partial<ScheduledPromptInput>,
): Promise<ScheduledPrompt> {
  const res = await apiFetch(`/ai-cron/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update scheduled prompt");
  return res.json();
}

export async function deleteScheduledPrompt(id: string): Promise<void> {
  const res = await apiFetch(`/ai-cron/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete scheduled prompt");
}

export async function toggleScheduledPrompt(
  id: string,
  isEnabled: boolean,
): Promise<ScheduledPrompt> {
  const res = await apiFetch(`/ai-cron/${id}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isEnabled }),
  });
  if (!res.ok) throw new Error("Failed to toggle scheduled prompt");
  return res.json();
}

export async function runScheduledPromptNow(
  id: string,
): Promise<ScheduledPromptRun> {
  const res = await apiFetch(`/ai-cron/${id}/run-now`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to run scheduled prompt");
  return res.json();
}

export async function fetchScheduledPromptRuns(
  id: string,
  limit = 50,
  offset = 0,
): Promise<ScheduledPromptRun[]> {
  const res = await apiFetch(
    `/ai-cron/${id}/runs?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error("Failed to fetch run history");
  return res.json();
}

export async function validateCronExpression(
  cronExpression: string,
  timezone?: string,
): Promise<CronDescription> {
  const res = await apiFetch("/ai-cron/validate-cron", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cronExpression, timezone }),
  });
  if (!res.ok) throw new Error("Failed to validate cron expression");
  return res.json();
}

export interface ScheduleFile {
  fileId: string;
  name: string;
  fileType: string | null;
  sizeBytes: number;
  ingestionStatus: string;
  ingestionError: string | null;
  attachedAt: string;
}

export async function fetchScheduleFiles(id: string): Promise<ScheduleFile[]> {
  const res = await apiFetch(`/ai-cron/${id}/files`);
  if (!res.ok) throw new Error("Failed to fetch schedule files");
  return res.json();
}

export async function detachScheduleFile(
  id: string,
  fileId: string,
): Promise<void> {
  const res = await apiFetch(`/ai-cron/${id}/files/${fileId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to detach file");
}

export async function uploadScheduleFiles(
  id: string,
  files: File[],
): Promise<{ uploaded: { id: string; name: string }[] }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  // No explicit Content-Type — the browser sets the multipart boundary.
  const res = await apiFetch(`/ai-cron/${id}/files/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Failed to upload files");
  return res.json();
}
