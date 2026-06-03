/**
 * Decide whether web search is ALLOWED for a project, given the
 * per-team setting and the org default.
 *
 * Resolution rule (mirrored by ChatController + ProjectsService, which
 * supply the two flags from the DB):
 *   - The org default (`companies.web_search_enabled`) is the master
 *     switch: when it is off, web search is off EVERYWHERE — teams and
 *     projects can't turn it back on. Org Off overrides everything.
 *   - When the org default is on, the team setting decides
 *     (`teams.web_search_enabled`): `true`/`false` force on/off. A
 *     null/undefined team value (no explicit choice) defaults to the
 *     org value (on), which is what the UI shows as the team default.
 *
 * Pure + dependency-free so the rule can be unit-tested without a DB.
 */
export function effectiveWebSearchCapability(
  teamFlag: boolean | null | undefined,
  companyFlag: boolean | null | undefined,
): boolean {
  const company = companyFlag ?? false;
  // Org Off is the hard override — nothing below it can re-enable.
  if (!company) return false;
  // Org On: team setting wins; an unset team defaults to the org value.
  return teamFlag ?? company;
}
