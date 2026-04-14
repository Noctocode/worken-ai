import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdir, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
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
    this.validate(payload);

    const [current] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!current) throw new BadRequestException('User not found');
    if (current.onboardingCompletedAt) {
      throw new ConflictException('Onboarding already completed');
    }

    // Write files to disk first — if this fails we haven't touched the DB.
    // Stored paths are relative to the api process's cwd so they survive
    // restarts without env-dependent absolute paths.
    const userDir = join(UPLOADS_ROOT, userId);
    await mkdir(userDir, { recursive: true });
    const writtenFiles: Array<{
      filename: string;
      storagePath: string;
      sizeBytes: number;
      mimeType: string | null;
    }> = [];
    for (const file of files) {
      const storedName = `${randomUUID()}-${file.originalname}`;
      const absolutePath = join(userDir, storedName);
      await writeFile(absolutePath, file.buffer);
      writtenFiles.push({
        filename: file.originalname,
        storagePath: join('uploads', 'knowledge', userId, storedName),
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
