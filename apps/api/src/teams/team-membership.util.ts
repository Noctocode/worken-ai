import { and, eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { teamMembers, teams } from '@worken/database/schema';
import type { Database } from '../database/database.module.js';

/**
 * The set of team ids a user is associated with: every team they have an
 * accepted membership in, plus every team they own. Deduped.
 *
 * This exact union (accepted memberships ∪ owned teams) is the canonical
 * "which teams is this user in" answer used across model-scope resolution,
 * the effective-model picker, and the personal-use shared-key fallback —
 * keeping it in one place stops those call sites from drifting apart when
 * membership semantics change.
 */
export async function resolveUserTeamIds(
  db: Database,
  userId: string,
): Promise<string[]> {
  const memberRows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.userId, userId), eq(teamMembers.status, 'accepted')),
    );
  const ownedRows = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.ownerId, userId));
  return Array.from(
    new Set([
      ...memberRows.map((r) => r.teamId),
      ...ownedRows.map((r) => r.id),
    ]),
  );
}

/**
 * SQL predicate: the user identified by `ownerIdColumn` is still
 * associated with the team identified by `teamIdColumn` — i.e. has an
 * accepted membership in it OR owns it. Emitted as raw correlated EXISTS
 * subqueries (no query-builder call) so it composes into a larger WHERE
 * that already references those columns (e.g. a
 * team_integration_links ⨝ integrations join) without itself touching the
 * `db` (keeps it side-effect-free for query construction + test mocks).
 *
 * Used to gate shared-key access on the key owner still being on the
 * linked team: a stale `team_integration_links` row left behind after
 * the owner leaves the team must NOT keep the key reachable.
 */
export function ownerStillOnTeam(
  teamIdColumn: AnyColumn | SQL,
  ownerIdColumn: AnyColumn | SQL,
): SQL {
  return sql`(exists (select 1 from ${teamMembers} where ${teamMembers.teamId} = ${teamIdColumn} and ${teamMembers.userId} = ${ownerIdColumn} and ${teamMembers.status} = 'accepted') or exists (select 1 from ${teams} where ${teams.id} = ${teamIdColumn} and ${teams.ownerId} = ${ownerIdColumn}))`;
}
