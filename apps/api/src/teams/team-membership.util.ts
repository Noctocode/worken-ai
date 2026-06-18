import { and, eq } from 'drizzle-orm';
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
