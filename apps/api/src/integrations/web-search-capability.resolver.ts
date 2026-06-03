import { eq } from 'drizzle-orm';
import { companies, teams, users } from '@worken/database/schema';
import type { Database } from '../database/database.module.js';
import { effectiveWebSearchCapability } from './web-search-capability.js';

/**
 * Resolve the effective org/team web-search capability for a user from the
 * DB. The org default (`companies.web_search_enabled`) is the master
 * switch — when it's off, web search is off everywhere; when it's on the
 * team setting (`teams.web_search_enabled`) decides, defaulting to the org
 * value when the team has no explicit choice.
 *
 * Shared by ChatController (the chat path) and ProjectsService (the FE
 * toggle) so the two never drift — the pure decision rule lives in
 * `effectiveWebSearchCapability`; this is the DB-bound lookup around it.
 * The org default is always fetched because Org Off overrides the team.
 */
export async function resolveWebSearchCapability(
  db: Database,
  userId: string,
  teamId: string | null,
): Promise<boolean> {
  let teamFlag: boolean | null | undefined;
  if (teamId) {
    const [team] = await db
      .select({ flag: teams.webSearchEnabled })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1);
    teamFlag = team?.flag;
  }
  // Org default always matters now — Org Off is a hard override that
  // disables web search even when a team explicitly turned it on.
  let companyFlag: boolean | null | undefined;
  const [u] = await db
    .select({ companyId: users.companyId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (u?.companyId) {
    const [company] = await db
      .select({ flag: companies.webSearchEnabled })
      .from(companies)
      .where(eq(companies.id, u.companyId))
      .limit(1);
    companyFlag = company?.flag;
  }
  return effectiveWebSearchCapability(teamFlag, companyFlag);
}
