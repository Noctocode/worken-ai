import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { projects, teams, users } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from './encryption.service.js';
import { OpenRouterProvisioningService } from './openrouter-provisioning.service.js';

@Injectable()
export class KeyResolverService {
  private readonly logger = new Logger(KeyResolverService.name);
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

  private requireKey(key: string, context: string): string {
    if (!key) {
      throw new Error(
        `No OpenRouter key available for ${context}. Set OPENROUTER_API_KEY as a fallback, or configure OPENROUTER_PROVISIONING_KEY so per-user/team keys can be created.`,
      );
    }
    return key;
  }

  private safeDecrypt(encrypted: string, context: string): string {
    try {
      return this.encryptionService.decrypt(encrypted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to decrypt stored OpenRouter key for ${context}: ${msg}. OPENROUTER_ENCRYPTION_KEY may have changed since the key was stored.`,
      );
    }
  }

  async resolveForProject(projectId: string, userId: string): Promise<string> {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      return this.requireKey(this.fallbackKey, `project ${projectId} (not found)`);
    }

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

    if (!team) {
      return this.requireKey(this.fallbackKey, `team ${teamId} (not found)`);
    }

    if (team.openrouterKeyEncrypted) {
      return this.safeDecrypt(team.openrouterKeyEncrypted, `team ${teamId}`);
    }

    return this.requireKey(
      this.fallbackKey,
      `team ${teamId} (no stored key, no fallback)`,
    );
  }

  async resolveUserKey(userId: string): Promise<string> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return this.requireKey(this.fallbackKey, `user ${userId} (not found)`);
    }

    if (user.openrouterKeyEncrypted) {
      return this.safeDecrypt(user.openrouterKeyEncrypted, `user ${userId}`);
    }

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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Lazy provisioning failed for user ${userId}: ${msg}`,
      );
      if (this.fallbackKey) {
        this.logger.warn(
          `Using OPENROUTER_API_KEY fallback for user ${userId} because provisioning failed.`,
        );
        return this.fallbackKey;
      }
      throw new Error(
        `Could not obtain an OpenRouter key for user ${userId}. Provisioning failed (${msg}) and OPENROUTER_API_KEY fallback is not set.`,
      );
    }
  }
}
