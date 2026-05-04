import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { join, posix as pathPosix } from 'path';
import {
  users,
  integrations,
  knowledgeDocuments,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { OpenRouterProvisioningService } from '../openrouter/openrouter-provisioning.service.js';

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

// Whitelisted enum values for the company-branch dropdowns. Must stay in
// sync with apps/web/src/app/setup-profile/step-2/page.tsx — the FE
// dropdown values are the source of truth, and the BE enforces them so
// direct API calls can't seed garbage like industry: "anything goes lol".
const VALID_INDUSTRIES = [
  'technology',
  'finance',
  'healthcare',
  'government',
  'manufacturing',
  'retail',
  'other',
] as const;
const VALID_TEAM_SIZES = [
  '1-10',
  '11-50',
  '51-200',
  '201-1000',
  '1000+',
] as const;

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
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryption: EncryptionService,
    private readonly provisioning: OpenRouterProvisioningService,
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

      // Write step-5 keys directly into the `integrations` table so they
      // show up in Management → Integration as enabled rows. Without
      // this, the keys would be stranded — the chat-transport BYOK path
      // and the Integration tab both read from `integrations`, while
      // the legacy `user_llm_credentials` table this used to write to is
      // unused for routing.
      //
      // Mapping note: the step-5 buttons (openai / azure / anthropic /
      // private-vpc) don't all line up with the predefined providers
      // catalog. `openai` and `anthropic` map directly. `azure` and
      // `private-vpc` need extra fields (Azure deployment URL, VPC
      // endpoint) that the wizard doesn't collect — those keys are
      // dropped here and the user must finish setup in the Integration
      // tab. Logged so it's visible in onboarding telemetry.
      if (payload.apiKeys) {
        for (const [provider, key] of Object.entries(payload.apiKeys)) {
          if (!key || !key.trim()) continue;
          if (!VALID_PROVIDERS.includes(provider as Provider)) continue;
          if (provider !== 'openai' && provider !== 'anthropic') {
            this.logger.warn(
              `Onboarding step-5: ${provider} key supplied but no matching predefined provider — skipping. User ${userId} can finish setup in Management → Integration.`,
            );
            continue;
          }
          await tx.insert(integrations).values({
            ownerId: userId,
            providerId: provider,
            apiUrl: null,
            apiKeyEncrypted: this.encryption.encrypt(key.trim()),
            isEnabled: true,
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

    // Managed Cloud provisioning. Runs after the DB transaction so we don't
    // hold the transaction open during the OpenRouter HTTP round-trip.
    //
    // Best-effort, mirroring the teams.create pattern: if OpenRouter is down
    // at this exact moment we still let onboarding succeed — the
    // `updateBudget` self-heal in users.service kicks in the first time an
    // admin sets a real budget, and `key-resolver.service` self-heals on
    // the first chat call too. The key is provisioned with `limit: 0` so
    // no spend is allowed until an admin explicitly raises the budget,
    // which matches the product decision to require manual approval.
    if (
      payload.infraChoice === 'managed' &&
      !current.openrouterKeyId
    ) {
      try {
        const { key, hash } = await this.provisioning.createKey(
          `user-${userId}`,
          0,
        );
        const encrypted = this.encryption.encrypt(key);
        await this.db
          .update(users)
          .set({
            openrouterKeyId: hash,
            openrouterKeyEncrypted: encrypted,
          })
          .where(eq(users.id, userId));
        this.logger.log(
          `Provisioned OpenRouter key for user ${userId} with limit=0 (admin must set budget).`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to provision OpenRouter key for user ${userId} during onboarding: ${msg}. Will self-heal on next updateBudget.`,
        );
      }
    }
  }

  /**
   * Resolve a knowledge document owned by `userId` to an absolute path that
   * is provably inside UPLOADS_ROOT, plus the stream + display metadata
   * needed to send it to the client.
   */
  async openDocumentForUser(documentId: string, userId: string) {
    const [doc] = await this.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, documentId));
    if (!doc || doc.userId !== userId) {
      throw new NotFoundException('Document not found');
    }

    // storagePath is a POSIX-style relative path we wrote. Resolve against
    // cwd and reject anything that would escape UPLOADS_ROOT — defensive
    // check in case of DB tampering.
    const absolutePath = resolve(process.cwd(), doc.storagePath);
    const rootResolved = resolve(UPLOADS_ROOT);
    if (!absolutePath.startsWith(rootResolved)) {
      throw new NotFoundException('Document not found');
    }

    try {
      await stat(absolutePath);
    } catch {
      throw new NotFoundException('Document file is missing on disk');
    }

    return {
      stream: createReadStream(absolutePath),
      filename: doc.filename,
      mimeType: doc.mimeType ?? 'application/octet-stream',
    };
  }

  async getProfile(userId: string) {
    const [u] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!u) throw new NotFoundException('User not found');

    // Connected providers shown on My Account. Read from `integrations`
    // (the same table the Integration tab uses) so this section reflects
    // what the user has actually configured. Filter to predefined
    // providers with a key set — Custom LLMs aren't conceptually
    // "connected providers" in the My Account sense.
    const providers = await this.db
      .select({
        id: integrations.id,
        provider: integrations.providerId,
        createdAt: integrations.createdAt,
      })
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          isNotNull(integrations.apiKeyEncrypted),
          isNull(integrations.apiUrl),
        ),
      );

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
      // industry/teamSize stay optional (Figma shows no asterisk), but
      // when supplied they must be one of the FE dropdown values.
      if (
        p.industry &&
        !VALID_INDUSTRIES.includes(
          p.industry as (typeof VALID_INDUSTRIES)[number],
        )
      ) {
        throw new BadRequestException(
          `industry must be one of: ${VALID_INDUSTRIES.join(', ')}`,
        );
      }
      if (
        p.teamSize &&
        !VALID_TEAM_SIZES.includes(
          p.teamSize as (typeof VALID_TEAM_SIZES)[number],
        )
      ) {
        throw new BadRequestException(
          `teamSize must be one of: ${VALID_TEAM_SIZES.join(', ')}`,
        );
      }
    }
    if (p.profileType === 'personal' && !p.fullName?.trim()) {
      throw new BadRequestException('fullName is required for Personal');
    }
  }
}
