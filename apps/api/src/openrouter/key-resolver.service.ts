import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { projects, teams, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from './encryption.service.js';
import { OpenRouterProvisioningService } from './openrouter-provisioning.service.js';

@Injectable()
export class KeyResolverService {
  private readonly fallbackKey: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryptionService: EncryptionService,
    private readonly provisioningService: OpenRouterProvisioningService,
    private readonly configService: ConfigService,
  ) {
    this.fallbackKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ?? '';
  }

  async resolveForProject(projectId: string, userId: string): Promise<string> {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) return this.fallbackKey;

    if (project.teamId) {
      return this.resolveTeamKey(project.teamId);
    }

    return this.resolveUserKey(userId);
  }

  async resolveTeamKey(teamId: string): Promise<string> {
    const [team] = await this.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));

    if (!team) return this.fallbackKey;

    if (team.openrouterKeyEncrypted) {
      return this.encryptionService.decrypt(team.openrouterKeyEncrypted);
    }

    return this.fallbackKey;
  }

  async resolveUserKey(userId: string): Promise<string> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) return this.fallbackKey;

    if (user.openrouterKeyEncrypted) {
      return this.encryptionService.decrypt(user.openrouterKeyEncrypted);
    }

    // Lazy provision
    try {
      const { key, hash } = await this.provisioningService.createKey(
        `user-${userId}`,
        10,
      );
      const encrypted = this.encryptionService.encrypt(key);
      await this.db
        .update(users)
        .set({ openrouterKeyId: hash, openrouterKeyEncrypted: encrypted })
        .where(eq(users.id, userId));
      return key;
    } catch (err) {
      console.error('Failed to provision user OpenRouter key:', err);
      return this.fallbackKey;
    }
  }
}
