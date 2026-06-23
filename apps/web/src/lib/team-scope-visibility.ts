/**
 * Single predicate for "hide team-scoped UI" — the All/Personal/Team
 * chat-history filter and the Project Details "Team Members" section.
 *
 * Hidden when team data can't exist (or isn't known yet):
 *   - `isPersonal`     — a personal profile has no teammates.
 *   - `!projectHasTeam` — a personal project (teamId === null) has only
 *                         personal conversations and no members.
 *   - `projectLoading`  — the project (hence its team status) isn't
 *                         resolved yet; stay hidden so team UI doesn't
 *                         flash in before we know it's a team project.
 *
 * Shared by ChatHistorySidebar and ProjectDetailsPanel so the rule
 * stays in one place (and is unit-testable without a DOM).
 */
export function hideTeamScopeUi(input: {
  isPersonal: boolean;
  projectHasTeam: boolean;
  projectLoading?: boolean;
}): boolean {
  return input.isPersonal || !!input.projectLoading || !input.projectHasTeam;
}
