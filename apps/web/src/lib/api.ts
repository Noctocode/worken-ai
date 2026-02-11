const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE_URL}${input}`, {
    ...init,
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
        ...init,
        credentials: "include",
      });
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
  canCreateProject: boolean;
}

export async function fetchCurrentUser(): Promise<User> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

export async function logout(): Promise<void> {
  await apiFetch("/auth/logout", { method: "POST" });
  window.location.href = "/login";
}

// Projects

export interface Project {
  id: string;
  name: string;
  description: string | null;
  model: string;
  status: string;
  teamId: string | null;
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

// Teams

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
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
}

export async function fetchTeams(): Promise<Team[]> {
  const res = await apiFetch("/teams");
  if (!res.ok) throw new Error("Failed to fetch teams");
  return res.json();
}

export async function fetchTeam(id: string): Promise<TeamWithMembers> {
  const res = await apiFetch(`/teams/${id}`);
  if (!res.ok) throw new Error("Failed to fetch team");
  return res.json();
}

export async function createTeam(name: string): Promise<Team> {
  const res = await apiFetch("/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to create team");
  return res.json();
}

export async function inviteTeamMember(
  teamId: string,
  email: string,
  role: "basic" | "advanced",
): Promise<TeamMember> {
  const res = await apiFetch(`/teams/${teamId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error("Failed to invite member");
  return res.json();
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

// Invitations

export interface InviteDetails {
  email: string;
  role: string;
  teamName: string;
  inviterName: string;
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
