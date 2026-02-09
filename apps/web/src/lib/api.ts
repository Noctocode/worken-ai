const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  const res = await fetch(`${BASE_URL}/projects`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProject(id: string): Promise<Project> {
  const res = await fetch(`${BASE_URL}/projects/${id}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

export async function createProject(
  input: CreateProjectInput,
): Promise<Project> {
  const res = await fetch(`${BASE_URL}/projects`, {
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
  const res = await fetch(`${BASE_URL}/projects/${projectId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to create document");
  return res.json();
}

export async function fetchDocuments(projectId: string): Promise<Document[]> {
  const res = await fetch(`${BASE_URL}/projects/${projectId}/documents`);
  if (!res.ok) throw new Error("Failed to fetch documents");
  return res.json();
}
