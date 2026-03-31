"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchProject, fetchTeam } from "@/lib/api";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

export function useBreadcrumbs(): BreadcrumbSegment[] {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // /teams/[id]
  const isTeamDetail = segments[0] === "teams" && segments.length === 2;
  const teamId = isTeamDetail ? segments[1] : undefined;

  // /projects/[id]
  const isProjectDetail = segments[0] === "projects" && segments.length === 2;
  const projectId = isProjectDetail ? segments[1] : undefined;

  // /users/[id]
  const isUserDetail = segments[0] === "users" && segments.length === 2;
  const userId = isUserDetail ? segments[1] : undefined;

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId!),
    enabled: !!projectId,
  });

  // TODO: replace with real API when backend returns full team data
  const DEMO_TEAM_NAMES: Record<string, string> = {
    "1": "Marketing Team",
    "2": "Design Team",
    "3": "Legal department",
  };

  const { data: team } = useQuery({
    queryKey: ["teams", teamId],
    queryFn: () => fetchTeam(teamId!),
    enabled: false, // disabled for demo
  });

  const teamName = teamId
    ? (team?.name ?? DEMO_TEAM_NAMES[teamId] ?? "Team")
    : undefined;

  // TODO: replace with real API when backend returns full user data
  const DEMO_USER_NAMES: Record<string, string> = {
    "1": "Bessie Cooper",
    "2": "Kathryn Murphy",
    "3": "Robert Fox",
    "4": "Dianne Russell",
    "5": "Jacob Jones",
  };

  const userName = userId ? (DEMO_USER_NAMES[userId] ?? "User") : undefined;

  const crumbs: BreadcrumbSegment[] = [{ label: "Workspace", href: "/" }];

  if (segments[0] === "teams") {
    if (isTeamDetail) {
      crumbs.push({ label: "Teams", href: "/teams" });
      crumbs.push({ label: teamName ?? "Team" });
    } else {
      crumbs.push({ label: "Teams" });
    }
  } else if (isUserDetail) {
    crumbs.push({ label: "Users", href: "/teams" });
    crumbs.push({ label: userName ?? "User" });
  } else if (isProjectDetail) {
    crumbs.push({ label: "Projects", href: "/" });
    crumbs.push({ label: project?.name ?? "Loading..." });
  } else {
    crumbs.push({ label: "Projects" });
  }

  return crumbs;
}
