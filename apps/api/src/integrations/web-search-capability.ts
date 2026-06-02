/**
 * Decide whether web search is ALLOWED for a project, given the
 * per-team override and the org default.
 *
 * Resolution rule (mirrored by ChatController + ProjectsService, which
 * supply the two flags from the DB):
 *   - A non-null team override (`teams.web_search_enabled`) wins —
 *     `true` forces on, `false` forces off — regardless of the org.
 *   - When the team override is null/undefined (inherit) the org
 *     default (`companies.web_search_enabled`) applies.
 *   - Missing org default (no company, or unset) → disabled.
 *
 * Pure + dependency-free so the rule can be unit-tested without a DB.
 */
export function effectiveWebSearchCapability(
  teamFlag: boolean | null | undefined,
  companyFlag: boolean | null | undefined,
): boolean {
  if (teamFlag != null) return teamFlag;
  return companyFlag ?? false;
}
