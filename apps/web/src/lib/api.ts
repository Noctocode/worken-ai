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

export interface Project {
  id: string;
  name: string;
  description: string | null;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  model: string;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await apiFetch("/projects");
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
