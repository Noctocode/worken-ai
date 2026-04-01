import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users, teamMembers, teams } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll() {
    const allUsers = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        picture: users.picture,
        monthlyBudgetCents: users.monthlyBudgetCents,
        createdAt: users.createdAt,
      })
      .from(users);

    // Get team memberships for all users
    const memberships = await this.db
      .select({
        userId: teamMembers.userId,
        teamName: teams.name,
        role: teamMembers.role,
        status: teamMembers.status,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id));

    const userTeams = new Map<
      string,
      { teams: string[]; highestRole: string; status: string }
    >();
    for (const m of memberships) {
      if (!m.userId) continue;
      const entry = userTeams.get(m.userId) ?? {
        teams: [],
        highestRole: 'basic',
        status: 'pending',
      };
      entry.teams.push(m.teamName);
      // Promote role: admin > advanced > basic
      if (
        m.role === 'advanced' &&
        entry.highestRole === 'basic'
      ) {
        entry.highestRole = 'advanced';
      }
      if (m.status === 'accepted') {
        entry.status = 'accepted';
      }
      userTeams.set(m.userId, entry);
    }

    // Check which users are team owners (they get "admin" role)
    const ownedTeams = await this.db
      .select({ ownerId: teams.ownerId })
      .from(teams);
    const ownerIds = new Set(ownedTeams.map((t) => t.ownerId));

    return allUsers.map((u) => {
      const membership = userTeams.get(u.id);
      let role = membership?.highestRole ?? 'basic';
      if (ownerIds.has(u.id)) role = 'admin';

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        picture: u.picture,
        role,
        status: membership?.status ?? 'accepted',
        teams: membership?.teams ?? [],
        monthlyBudgetCents: u.monthlyBudgetCents,
        spentCents: 0, // TODO: integrate with OpenRouter usage API
        projectedCents: 0, // TODO: integrate with OpenRouter usage API
        createdAt: u.createdAt,
      };
    });
  }

  async remove(userId: string) {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Remove from all teams
    await this.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, userId));

    // Delete user
    await this.db.delete(users).where(eq(users.id, userId));

    return { success: true };
  }
}
