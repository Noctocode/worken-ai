import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { copyFile, mkdir, rename, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join, posix as pathPosix } from 'path';
import {
  users,
  userLlmCredentials,
  knowledgeDocuments,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

type ProfileType = 'company' | 'personal';
type InfraChoice = 'managed' | 'on-premise';
type Provider = 'openai' | 'azure' | 'anthropic' | 'private-vpc';

export interface OnboardingPayload {
  profileType: ProfileType;
  // Step 2 (Company branch) or Step 3 (Private Pro branch)
  fullName?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
  // Step 4
  infraChoice: InfraChoice;
  // Step 5 — each key is optional; omitted/empty means "skipped"
  apiKeys?: Partial<Record<Provider, string>>;
}

const VALID_PROVIDERS: Provider[] = [
  'openai',
  'azure',
  'anthropic',
  'private-vpc',
];
const UPLOADS_ROOT = join(process.cwd(), 'uploads', 'knowledge');

// Defense-in-depth against path traversal: multer's originalname is whatever
// the client sent (can contain ../, /, \, or NULs). Keep just the last path
// segment, strip characters disallowed on Windows filesystems + control
// bytes + leading dots.
function sanitizeFilename(raw: string): string {
  const lastSegment = raw.replace(/^.*[\\/]/, '');
  // eslint-disable-next-line no-control-regex
  const cleaned = lastSegment
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '');
  return cleaned || 'file';
}

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryption: EncryptionService,
  ) {}

  async complete(
    userId: string,
    payload: OnboardingPayload,
    files: Express.Multer.File[],
  ) {
    // Track absolute paths of files we've moved into the user's permanent
    // dir. If the DB transaction (or anything after the moves) fails, these
    // would orphan on disk without cleanup.
    const movedPaths: string[] = [];
    try {
      await this.completeInner(userId, payload, files, movedPaths);
    } catch (err) {
      // Two classes of leftovers to clean up:
      //  1. multer tmp files that never got moved (validation / pre-move
      //     failure) — unlink by `file.path`.
      //  2. files already renamed into the user dir but whose DB writes
      //     rolled back — unlink by the tracked movedPaths.
      await Promise.all([
        ...files.map((f) => unlink(f.path).catch(() => undefined)),
        ...movedPaths.map((p) => unlink(p).catch(() => undefined)),
      ]);
      throw err;
    }
  }

  private async completeInner(
    userId: string,
    payload: OnboardingPayload,
    files: Express.Multer.File[],
    movedPaths: string[],
  ) {
    this.validate(payload);

    const [current] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!current) throw new BadRequestException('User not found');
    if (current.onboardingCompletedAt) {
      throw new ConflictException('Onboarding already completed');
    }

    // Write files to disk first. If the subsequent DB transaction rolls
    // back we unlink everything we moved via `movedPaths` in the caller.
    const userDir = join(UPLOADS_ROOT, userId);
    await mkdir(userDir, { recursive: true });
    const writtenFiles: Array<{
      filename: string;
      storagePath: string;
      sizeBytes: number;
      mimeType: string | null;
    }> = [];
    for (const file of files) {
      const safeName = sanitizeFilename(file.originalname);
      const storedName = `${randomUUID()}-${safeName}`;
      const absolutePath = join(userDir, storedName);
      // Files arrive on disk via multer.diskStorage; move them into the
      // user's permanent dir. rename is atomic on the same filesystem;
      // cross-device moves (e.g. /tmp on a different mount) need copy +
      // unlink as a fallback.
      try {
        await rename(file.path, absolutePath);
      } catch (err: unknown) {
        const errno = (err as NodeJS.ErrnoException)?.code;
        if (errno === 'EXDEV') {
          await copyFile(file.path, absolutePath);
          await unlink(file.path).catch(() => {
            /* best-effort cleanup */
          });
        } else {
          throw err;
        }
      }
      movedPaths.push(absolutePath);
      writtenFiles.push({
        // Preserve the original display name (post-sanitize) so the /account
        // page shows something the user recognises.
        filename: safeName,
        // POSIX separators in the DB so storage paths are portable between
        // dev (Windows) and prod (Linux) without per-OS quirks.
        storagePath: pathPosix.join(
          'uploads',
          'knowledge',
          userId,
          storedName,
        ),
        sizeBytes: file.size,
        mimeType: file.mimetype || null,
      });
    }

    // Single transaction so users row, credentials, and document rows are
    // all-or-nothing.
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          profileType: payload.profileType,
          name:
            payload.profileType === 'personal' && payload.fullName
              ? payload.fullName
              : current.name,
          companyName:
            payload.profileType === 'company' ? payload.companyName : null,
          industry:
            payload.profileType === 'company' ? payload.industry : null,
          teamSize:
            payload.profileType === 'company' ? payload.teamSize : null,
          infraChoice: payload.infraChoice,
          onboardingCompletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      if (payload.apiKeys) {
        for (const [provider, key] of Object.entries(payload.apiKeys)) {
          if (!key || !key.trim()) continue;
          if (!VALID_PROVIDERS.includes(provider as Provider)) continue;
          await tx.insert(userLlmCredentials).values({
            userId,
            provider,
            apiKeyEncrypted: this.encryption.encrypt(key.trim()),
          });
        }
      }

      for (const f of writtenFiles) {
        await tx.insert(knowledgeDocuments).values({
          userId,
          ...f,
        });
      }
    });
  }

  async getProfile(userId: string) {
    const [u] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!u) throw new NotFoundException('User not found');

    const providers = await this.db
      .select({
        id: userLlmCredentials.id,
        provider: userLlmCredentials.provider,
        createdAt: userLlmCredentials.createdAt,
      })
      .from(userLlmCredentials)
      .where(eq(userLlmCredentials.userId, userId));

    const documents = await this.db
      .select({
        id: knowledgeDocuments.id,
        filename: knowledgeDocuments.filename,
        sizeBytes: knowledgeDocuments.sizeBytes,
        mimeType: knowledgeDocuments.mimeType,
        createdAt: knowledgeDocuments.createdAt,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.userId, userId));

    return {
      name: u.name,
      email: u.email,
      picture: u.picture,
      profileType: u.profileType as 'company' | 'personal' | null,
      companyName: u.companyName,
      industry: u.industry,
      teamSize: u.teamSize,
      infraChoice: u.infraChoice as 'managed' | 'on-premise' | null,
      onboardingCompletedAt: u.onboardingCompletedAt?.toISOString() ?? null,
      providers,
      documents,
    };
  }

  private validate(p: OnboardingPayload) {
    if (p.profileType !== 'company' && p.profileType !== 'personal') {
      throw new BadRequestException(
        'profileType must be "company" or "personal"',
      );
    }
    if (p.infraChoice !== 'managed' && p.infraChoice !== 'on-premise') {
      throw new BadRequestException(
        'infraChoice must be "managed" or "on-premise"',
      );
    }
    if (p.profileType === 'company') {
      if (!p.companyName?.trim()) {
        throw new BadRequestException('companyName is required for Company');
      }
    }
    if (p.profileType === 'personal' && !p.fullName?.trim()) {
      throw new BadRequestException('fullName is required for Personal');
    }
  }
}
