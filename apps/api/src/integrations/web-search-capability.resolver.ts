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
 * The company flag is fetched only when the team hasn't explicitly opted
 * out (an explicit team Off is already final).
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
  // Team explicitly Off → off everywhere, regardless of the org master
  // switch. Short-circuit before the company lookup — this resolver runs on
  // the chat hot path, so skip the two extra queries when the answer is
  // already settled.
  if (teamFlag === false) return false;

  // Otherwise the org default decides: Org Off is a hard override, and Org On
  // with an unset team defaults to on. Org Off matters even when the team
  // turned it on, so the company flag is fetched here.
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
