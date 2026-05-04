import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { apiKeys } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

export const API_KEY_PREFIX = 'sk-wai-';

/**
 * 32 random url-safe chars after the prefix → ~190 bits of entropy. Far
 * beyond the ~80 bits a brute-forcer needs to make hash lookups in our
 * unique index pointless to attack online.
 */
const SECRET_LEN = 32;

function generatePlaintext(): string {
  // base64url → letters + digits + `-_`. Slice to fixed length so the
  // user-visible token has a predictable shape.
  const raw = randomBytes(48).toString('base64url').slice(0, SECRET_LEN);
  return `${API_KEY_PREFIX}${raw}`;
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  /** Last 4 chars of plaintext, for "ends in …xyz9" display. */
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface MintedApiKey extends ApiKeyMetadata {
  /** Full plaintext — returned ONCE on creation, never stored or re-derivable. */
  plaintext: string;
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(ownerId: string): Promise<ApiKeyMetadata[]> {
    const rows = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.ownerId, ownerId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return rows;
  }

  async mint(ownerId: string, name: string): Promise<MintedApiKey> {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Name is required');
    if (trimmed.length > 80) {
      throw new BadRequestException('Name must be 80 characters or fewer');
    }

    const plaintext = generatePlaintext();
    const hash = hashApiKey(plaintext);
    const prefix = plaintext.slice(-4);

    const [row] = await this.db
      .insert(apiKeys)
      .values({ ownerId, name: trimmed, hash, prefix })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
      });

    return { ...row, plaintext };
  }

  /**
   * Soft-revoke (sets revoked_at). Hard delete would orphan future
   * audit log lookups by id; soft-revoke also makes hash lookups in the
   * auth guard naturally fail because the guard filters on `revoked_at
   * IS NULL`.
   */
  async revoke(ownerId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.ownerId, ownerId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    if (!row) throw new NotFoundException('API key not found');
  }

  /**
   * Used by the auth guard. Looks up by hash (unique index → O(log n)),
   * returns owner id if found and not revoked. Caller is responsible
   * for fire-and-forget `lastUsedAt` update.
   */
  async findActiveByHash(
    hash: string,
  ): Promise<{ id: string; ownerId: string } | null> {
    const [row] = await this.db
      .select({
        id: apiKeys.id,
        ownerId: apiKeys.ownerId,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.hash, hash))
      .limit(1);
    if (!row || row.revokedAt) return null;
    return { id: row.id, ownerId: row.ownerId };
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }
}
