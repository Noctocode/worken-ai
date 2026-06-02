import { eq } from 'drizzle-orm';
import { companies, teams, users } from '@worken/database/schema';
import type { Database } from '../database/database.module.js';
import { effectiveWebSearchCapability } from './web-search-capability.js';

/**
 * Resolve the effective org/team web-search capability for a user from the
 * DB. A non-null team override (`teams.web_search_enabled`) wins; otherwise
 * the acting user's org default (`companies.web_search_enabled`) applies.
 *
 * Shared by ChatController (the chat path) and ProjectsService (the FE
 * toggle) so the two never drift — the pure decision rule lives in
 * `effectiveWebSearchCapability`; this is the DB-bound lookup around it.
 * The org default query only runs when the team override doesn't decide it.
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
  // Only hit the org default when the team override doesn't decide it.
  let companyFlag: boolean | null | undefined;
  if (teamFlag == null) {
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
  }
  return effectiveWebSearchCapability(teamFlag, companyFlag);
}
