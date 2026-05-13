import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { createReadStream } from 'fs';
import {
  extname,
  isAbsolute,
  join,
  posix as pathPosix,
  relative,
  resolve,
} from 'path';
import { randomUUID } from 'crypto';
import {
  users,
  teams,
  integrations,
  knowledgeFiles,
  knowledgeFolders,
  onboardingDrafts,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import { sha256File } from '../knowledge-core/knowledge-core.service.js';

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
  // Step 6 — visibility for the knowledge files uploaded in this
  // batch. Only meaningful when profileType === 'company' (where
  // 'admins' restricts access to admin role only). Personal-profile
  // uploads land as scope='personal' (owner-only) regardless, so
  // visibility is effectively moot there. Optional; defaults to
  // 'all'.
  knowledgeVisibility?: 'all' | 'admins';
}

/**
 * Subset of the onboarding state safe to round-trip through the BE
 * draft. Mirrors `OnboardingPayload` but with every field optional —
 * a draft can be saved any time during the wizard.
 *
 * `apiKeys` is deliberately absent: keys are an XSS exfiltration
 * vector if persisted server-side without strong scoping, and the
 * wizard collects them only on the very last step before completion
 * anyway. Files are also absent — they'd need multipart, not JSON.
 */
export interface OnboardingDraft {
  profileType?: ProfileType;
  fullName?: string;
  companyName?: string;
  industry?: string;
  teamSize?: string;
  infraChoice?: InfraChoice;
}

const VALID_PROVIDERS: Provider[] = [
  'openai',
  'azure',
  'anthropic',
  'private-vpc',
];

// Subset of step-5 providers that 1:1 map to predefined providers in
// the Integration tab catalog, and so can flow straight into the
// `integrations` table on onboarding completion. Azure / private-vpc
// need extra fields (deployment URL, VPC endpoint) the wizard never
// collects, so their keys are deliberately dropped — see comment in
// completeInner where this list is consulted.
const SUPPORTED_FOR_INTEGRATION_TABLE: Provider[] = ['openai', 'anthropic'];

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

// Onboarding uploads now live in the same directory as
// post-onboarding Knowledge Core uploads so `knowledge_files.storage_path`
// is uniform regardless of source. The legacy `uploads/knowledge/<userId>/`
// tree stays put for already-migrated rows (the backfill script copies,
// not moves) — once the backfill is verified on prod that tree can be
// deleted in a follow-up PR.
const UPLOADS_ROOT = join(process.cwd(), 'uploads', 'knowledge-core');

// Name of the auto-created per-user folder onboarding uploads land in.
// Find-or-create on completion: stable name so a user who re-runs
// onboarding (after a support-action reset) reuses the same folder
// rather than spawning duplicates. If the user happens to already have
// a folder named 'Onboarding' for unrelated purposes, the files land
// there — acceptable; users own their folder names and this collision
// is rare in practice.
const ONBOARDING_FOLDER_NAME = 'Onboarding';

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

// knowledge_files doesn't carry a mime_type column (KC uploads only
// retain extension), so reconstruct one for downloads. Covers the
// onboarding-allowed types plus a sensible default.
function mimeFromExtension(
  fileType: string | null,
  filename: string,
): string {
  const ext = (
    fileType ?? extname(filename).replace('.', '')
  ).toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryption: EncryptionService,
    private readonly knowledgeIngestion: KnowledgeIngestionService,
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
      // Kick off ingestion AFTER the transaction commits — the worker
      // queries `knowledge_files` and would see nothing if invoked
      // mid-transaction. Fire-and-forget so the HTTP response returns
      // immediately; the FE polls /onboarding/ingestion-status to
      // surface progress.
      if (files.length > 0) {
        this.knowledgeIngestion.ingestPendingFilesForUser(userId);
      }
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
    // Files share the same directory as Knowledge Core uploads (flat
    // `uploads/knowledge-core/`) so storage_path is uniform; the
    // randomUUID prefix prevents collisions across users.
    await mkdir(UPLOADS_ROOT, { recursive: true });
    const writtenFiles: Array<{
      name: string;
      fileType: string;
      storagePath: string;
      sizeBytes: number;
      contentSha256: string;
    }> = [];
    for (const file of files) {
      const safeName = sanitizeFilename(file.originalname);
      const storedName = `${randomUUID()}-${safeName}`;
      const absolutePath = join(UPLOADS_ROOT, storedName);
      // Files arrive on disk via multer.diskStorage; move them into the
      // permanent knowledge-core dir. rename is atomic on the same
      // filesystem; cross-device moves (e.g. /tmp on a different mount)
      // need copy + unlink as a fallback.
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
      // Match KnowledgeCoreService.uploadFiles shape so chunks, badges,
      // and the /knowledge-core UI treat onboarding uploads identically
      // to ones the user adds later via the dropzone.
      const ext = extname(safeName).replace('.', '').toUpperCase();
      // Hash here (post-rename, before the DB insert) so the row goes
      // in with content_sha256 populated. Lets the post-onboarding
      // upload path detect re-uploads of the same bytes against
      // onboarding-time files without a backfill pass.
      const contentSha256 = await sha256File(absolutePath);
      writtenFiles.push({
        // Preserve the original display name (post-sanitize) so the
        // /account page and /knowledge-core list show something the
        // user recognises.
        name: safeName,
        fileType: ext || 'FILE',
        // POSIX separators in the DB so storage paths are portable between
        // dev (Windows) and prod (Linux) without per-OS quirks.
        storagePath: pathPosix.join('uploads/knowledge-core', storedName),
        sizeBytes: file.size,
        contentSha256,
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
          if (
            !SUPPORTED_FOR_INTEGRATION_TABLE.includes(provider as Provider)
          ) {
            this.logger.warn(
              `Onboarding step-5: ${provider} key supplied but no matching predefined provider — skipping. User ${userId} can finish setup in Management → Integration.`,
            );
            continue;
          }
          // onConflictDoNothing on the partial unique index
          // `(owner_id, provider_id) WHERE api_url IS NULL` so a
          // re-run of onboarding (e.g. support-action that cleared
          // onboarding_completed_at after the legacy backfill SQL was
          // applied) doesn't crash the whole transaction with 23505
          // and orphan the just-uploaded knowledge documents. The
          // existing row is left as-is — the user can update keys
          // from Management → Integration.
          await tx
            .insert(integrations)
            .values({
              ownerId: userId,
              providerId: provider,
              apiUrl: null,
              apiKeyEncrypted: this.encryption.encrypt(key.trim()),
              isEnabled: true,
            })
            .onConflictDoNothing({
              target: [integrations.ownerId, integrations.providerId],
              where: sql`${integrations.apiUrl} IS NULL`,
            });
        }
      }

      // Land the uploads in the same tables Knowledge Core uses so
      // they show up in /knowledge-core alongside files the user adds
      // later via the dropzone. One transaction with the user/integration
      // writes above: if folder/file insert fails, the onboarding row
      // doesn't get marked complete and the caller cleans up disk via
      // `movedPaths`.
      //
      // Folder is find-or-create per user. No unique index on
      // (owner_id, name) — concurrent onboarding completion is
      // impossible (gated by `onboardingCompletedAt` 409 above), so a
      // plain SELECT-then-INSERT is race-free here.
      if (writtenFiles.length > 0) {
        let [folder] = await tx
          .select({ id: knowledgeFolders.id })
          .from(knowledgeFolders)
          .where(
            and(
              eq(knowledgeFolders.ownerId, userId),
              eq(knowledgeFolders.name, ONBOARDING_FOLDER_NAME),
            ),
          )
          .limit(1);
        if (!folder) {
          [folder] = await tx
            .insert(knowledgeFolders)
            .values({ ownerId: userId, name: ONBOARDING_FOLDER_NAME })
            .returning({ id: knowledgeFolders.id });
        }

        // RAG visibility: company branch → every deployment user can
        // pull these chunks at chat time; personal branch → only the
        // uploader. Set per-file here (not later) so a re-ingest can't
        // drift the visibility, and so the ingestion worker can copy
        // the value onto each chunk.
        const scope =
          payload.profileType === 'company' ? 'company' : 'personal';

        // Second visibility layer (within company scope only):
        // 'admins' restricts the uploads to admin role users at
        // chat / arena time. Force 'all' for personal profile —
        // owner-only scope already, the second toggle would be
        // misleading. Default 'all' when the payload omits the
        // field (backward-compatible with FE clients that haven't
        // adopted the new field yet).
        const visibility: 'all' | 'admins' =
          payload.profileType === 'company' &&
          payload.knowledgeVisibility === 'admins'
            ? 'admins'
            : 'all';

        await tx.insert(knowledgeFiles).values(
          writtenFiles.map((f) => ({
            folderId: folder.id,
            uploadedById: userId,
            scope,
            visibility,
            ...f,
          })),
        );

        // Bump folder's updatedAt so /knowledge-core sorts it to the top
        // for the user's first visit post-onboarding.
        await tx
          .update(knowledgeFolders)
          .set({ updatedAt: new Date() })
          .where(eq(knowledgeFolders.id, folder.id));
      }
    });

    // Managed Cloud users are NOT provisioned an OpenRouter key here.
    // The original design provisioned with `limit: 0`, but OpenRouter's
    // API treats `limit: 0` ambiguously (and `limit: null` as
    // unenforced — see backfill-openrouter-limits.ts), so a key created
    // up front would be one bypassed gate away from uncapped spend.
    //
    // Instead we leave openrouterKeyId NULL and rely on:
    //   1. The pending-approval banner on Management → Users (predicate
    //      `infraChoice = 'managed' AND monthlyBudgetCents = 0`) to
    //      surface the user to the admin.
    //   2. `users.service.updateBudget` to provision the key the moment
    //      the admin sets a real budget — that path already creates a
    //      key matching the requested limit, so the OpenRouter cap and
    //      our DB stay in sync.
    //   3. `assertManagedBudgetApproved` and the lazy-provision guard
    //      in `key-resolver.resolveUserKey` to make any chat attempt
    //      before approval fail with a 402 + BUDGET_PENDING_APPROVAL
    //      marker rather than silently creating a key.

    // Drop the resume-draft now that the wizard is genuinely done.
    // Kept outside the transaction because failure here is benign —
    // the row would just orphan and can be reaped by cron later, no
    // need to roll back a successful onboarding for it.
    await this.db
      .delete(onboardingDrafts)
      .where(eq(onboardingDrafts.userId, userId))
      .catch(() => undefined);
  }

  /**
   * Resolve a knowledge file owned by `userId` to an absolute path
   * that is provably inside the uploads root, plus the stream +
   * display metadata needed to send it to the client. Backed by
   * `knowledge_files`.
   */
  async openDocumentForUser(fileId: string, userId: string) {
    const [file] = await this.db
      .select({
        name: knowledgeFiles.name,
        fileType: knowledgeFiles.fileType,
        storagePath: knowledgeFiles.storagePath,
        ownerId: knowledgeFolders.ownerId,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(eq(knowledgeFiles.id, fileId));
    if (!file || file.ownerId !== userId) {
      throw new NotFoundException('Document not found');
    }
    if (!file.storagePath) {
      throw new NotFoundException('Document file is missing on disk');
    }

    // storagePath is a POSIX-style relative path. Resolve against cwd
    // and reject anything that would escape the uploads root —
    // defensive check in case of DB tampering. `path.relative` flags
    // every escape: `..`-prefixed when the target sits above the root,
    // absolute when there's no common base (different Windows drive),
    // and empty when the target IS the root (no file to open). This
    // catches both `..` traversal AND suffix collisions like
    // `<root>-secret/...` that a naive `startsWith(rootResolved)`
    // would let through.
    const absolutePath = resolve(process.cwd(), file.storagePath);
    const rootResolved = resolve(UPLOADS_ROOT);
    const rel = relative(rootResolved, absolutePath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new NotFoundException('Document not found');
    }

    try {
      await stat(absolutePath);
    } catch {
      throw new NotFoundException('Document file is missing on disk');
    }

    return {
      stream: createReadStream(absolutePath),
      filename: file.name,
      // knowledge_files doesn't store mimetype; map extension to a
      // sensible Content-Type and fall back to octet-stream. Browsers
      // honour Content-Disposition: attachment regardless, so this
      // only affects in-tab preview for txt/pdf.
      mimeType: mimeFromExtension(file.fileType, file.name),
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

    // Onboarding uploads now live in the user's `Onboarding` folder
    // inside `knowledge_files`. /account keeps the same display shape
    // (`{id, filename, sizeBytes, mimeType, createdAt}`) so the FE
    // download link continues to work — `id` is now a knowledge_files
    // row, openDocumentForUser resolves it.
    const documents = await this.db
      .select({
        id: knowledgeFiles.id,
        filename: knowledgeFiles.name,
        sizeBytes: knowledgeFiles.sizeBytes,
        fileType: knowledgeFiles.fileType,
        createdAt: knowledgeFiles.createdAt,
      })
      .from(knowledgeFiles)
      .innerJoin(
        knowledgeFolders,
        eq(knowledgeFolders.id, knowledgeFiles.folderId),
      )
      .where(
        and(
          eq(knowledgeFolders.ownerId, userId),
          eq(knowledgeFolders.name, ONBOARDING_FOLDER_NAME),
        ),
      );

    return {
      name: u.name,
      email: u.email,
      picture: u.picture,
      plan: u.plan,
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

  /**
   * Read the user's draft if present. Returns null instead of
   * throwing 404 because the FE always tries to hydrate; absence is
   * the common case (fresh signup, or already-completed onboarding
   * which deletes the row).
   */
  async getDraft(userId: string): Promise<OnboardingDraft | null> {
    const [row] = await this.db
      .select({ partial: onboardingDrafts.partial })
      .from(onboardingDrafts)
      .where(eq(onboardingDrafts.userId, userId))
      .limit(1);
    return (row?.partial as OnboardingDraft | undefined) ?? null;
  }

  /**
   * Upsert the draft. Validates the partial against the same enum
   * lists `complete` uses so a malformed POST can't poison the row.
   *
   * Behaviour split: unknown top-level keys (anything outside the
   * OnboardingDraft shape) are silently stripped — the FE always
   * sends the canonical shape, and a future field added to the BE
   * shouldn't break older FEs that don't know about it. But if a
   * known field carries an invalid enum value
   * (industry: 'lol', teamSize: '999', etc.) we 400 — the FE Selects
   * are constrained, so an invalid enum from a programmatic caller
   * is a real bug they want to know about, not silently dropped
   * data.
   */
  async updateDraft(
    userId: string,
    input: OnboardingDraft,
  ): Promise<OnboardingDraft> {
    const sanitized: OnboardingDraft = {};

    if (input.profileType !== undefined) {
      if (input.profileType !== 'company' && input.profileType !== 'personal') {
        throw new BadRequestException(
          'profileType must be "company" or "personal"',
        );
      }
      sanitized.profileType = input.profileType;
    }
    if (typeof input.fullName === 'string') {
      sanitized.fullName = input.fullName.slice(0, 200);
    }
    if (typeof input.companyName === 'string') {
      sanitized.companyName = input.companyName.slice(0, 200);
    }
    if (input.industry !== undefined) {
      if (
        typeof input.industry !== 'string' ||
        !(VALID_INDUSTRIES as readonly string[]).includes(input.industry)
      ) {
        throw new BadRequestException(
          `industry must be one of: ${VALID_INDUSTRIES.join(', ')}`,
        );
      }
      sanitized.industry = input.industry;
    }
    if (input.teamSize !== undefined) {
      if (
        typeof input.teamSize !== 'string' ||
        !(VALID_TEAM_SIZES as readonly string[]).includes(input.teamSize)
      ) {
        throw new BadRequestException(
          `teamSize must be one of: ${VALID_TEAM_SIZES.join(', ')}`,
        );
      }
      sanitized.teamSize = input.teamSize;
    }
    if (input.infraChoice !== undefined) {
      if (
        input.infraChoice !== 'managed' &&
        input.infraChoice !== 'on-premise'
      ) {
        throw new BadRequestException(
          'infraChoice must be "managed" or "on-premise"',
        );
      }
      sanitized.infraChoice = input.infraChoice;
    }

    await this.db
      .insert(onboardingDrafts)
      .values({ userId, partial: sanitized })
      .onConflictDoUpdate({
        target: onboardingDrafts.userId,
        set: { partial: sanitized, updatedAt: new Date() },
      });

    return sanitized;
  }

  /** Soft-delete the draft. Called both from the controller and from
   *  `complete()` after a successful transaction. */
  async deleteDraft(userId: string): Promise<void> {
    await this.db
      .delete(onboardingDrafts)
      .where(eq(onboardingDrafts.userId, userId));
  }

  /**
   * Post-onboarding profile patch. Lets an admin edit the company-
   * branch fields (`name`, `companyName`, `industry`, `teamSize`)
   * after `complete` already ran — drives the Pencil flow on the
   * Company tab so the displayed values stay editable without
   * walking the user back through the wizard.
   *
   * Only company-profile users can hit this path: the Company tab
   * isn't surfaced for personal accounts, and we don't want a
   * personal-profile user to silently flip into company-shaped state.
   */
  async updateProfile(
    userId: string,
    input: {
      name?: string;
      companyName?: string;
      industry?: string;
      teamSize?: string;
    },
  ) {
    const [current] = await this.db
      .select({
        profileType: users.profileType,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!current) throw new NotFoundException('User not found');
    if (current.profileType !== 'company') {
      throw new BadRequestException(
        'Profile editing here only applies to company-profile accounts.',
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      // Empty name is permitted — clears it. Onboarding "fullName"
      // wasn't required for company branch, so don't enforce here.
      updates.name = trimmed.length > 0 ? trimmed : null;
    }
    if (input.companyName !== undefined) {
      const trimmed = input.companyName.trim();
      if (!trimmed) {
        throw new BadRequestException('Company name cannot be empty.');
      }
      updates.companyName = trimmed;
    }
    if (input.industry !== undefined) {
      const trimmed = input.industry.trim();
      if (
        trimmed &&
        !(VALID_INDUSTRIES as readonly string[]).includes(trimmed)
      ) {
        throw new BadRequestException(
          `industry must be one of: ${VALID_INDUSTRIES.join(', ')}`,
        );
      }
      updates.industry = trimmed.length > 0 ? trimmed : null;
    }
    if (input.teamSize !== undefined) {
      const trimmed = input.teamSize.trim();
      if (
        trimmed &&
        !(VALID_TEAM_SIZES as readonly string[]).includes(trimmed)
      ) {
        throw new BadRequestException(
          `teamSize must be one of: ${VALID_TEAM_SIZES.join(', ')}`,
        );
      }
      updates.teamSize = trimmed.length > 0 ? trimmed : null;
    }

    await this.db.update(users).set(updates).where(eq(users.id, userId));
    return this.getProfile(userId);
  }

  /**
   * "Delete company" tear-down for the Trash button on the Company
   * tab. Single-tenant deployment, so there's no real company entity
   * — instead we drop every workspace-shaped structure (teams,
   * sub-teams, team members, team-scoped integrations) and clear the
   * company-shaped onboarding fields (profileType, companyName,
   * industry, teamSize, infraChoice, onboardingCompletedAt) on every
   * user. User accounts, roles, plans, personal API keys, personal
   * chats / conversations / projects all stay; the next admin login
   * just lands on /setup-profile to set up a fresh company.
   *
   * Admin-only and gated on profileType=company so a personal-profile
   * caller can't accidentally wipe somebody else's workspace.
   */
  async deleteCompany(userId: string): Promise<{
    deletedTeamCount: number;
    affectedUserCount: number;
  }> {
    const [caller] = await this.db
      .select({
        role: users.role,
        profileType: users.profileType,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!caller) throw new NotFoundException('User not found');
    if (caller.role !== 'admin') {
      throw new ForbiddenException('Only admins can delete the company.');
    }
    if (caller.profileType !== 'company') {
      throw new BadRequestException(
        'Only company profiles can be deleted from this endpoint.',
      );
    }

    // Atomic tear-down: wrapping the destructive sequence in one
    // transaction keeps the workspace from landing in a half-deleted
    // state if any step fails (e.g. teams partially deleted but
    // users.profileType still set, or parentTeamId cleared but the
    // teams themselves still around because the DELETE timed out).
    return await this.db.transaction(async (tx) => {
      // Snapshot counts before the destructive run so the success
      // toast can show what was actually torn down. Cheaper than
      // returning ids and sidesteps drizzle's loose typing on
      // `.returning()`.
      const [teamAgg] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(teams);
      const [userAgg] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users);

      // Break parent→child team edges before the bulk delete. PG can
      // trip on a single DELETE that touches both ends of the
      // self-reference even though parent_team_id is `set null`; pre-
      // clearing keeps the cascade well-defined.
      await tx.update(teams).set({ parentTeamId: null });

      // Bulk delete every team. Cascades wipe team_members and team-
      // scoped integrations; projects.team_id is `set null`, so chat
      // history under those projects survives but lands in personal
      // scope.
      await tx.delete(teams);

      // Reset company-shaped fields org-wide. profileType=null +
      // onboardingCompletedAt=null means every user (admin and
      // participant) hits /setup-profile on next render — fresh start.
      // Bumping updatedAt so audit consumers see the change.
      await tx.update(users).set({
        profileType: null,
        companyName: null,
        industry: null,
        teamSize: null,
        infraChoice: null,
        onboardingCompletedAt: null,
        updatedAt: new Date(),
      });

      return {
        deletedTeamCount: teamAgg?.count ?? 0,
        affectedUserCount: userAgg?.count ?? 0,
      };
    });
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
      // Cast the readonly tuple down to a plain string[] so `.includes`
      // accepts an arbitrary string at the call site instead of forcing
      // a tuple-narrowing cast on the input.
      if (
        p.industry &&
        !(VALID_INDUSTRIES as readonly string[]).includes(p.industry)
      ) {
        throw new BadRequestException(
          `industry must be one of: ${VALID_INDUSTRIES.join(', ')}`,
        );
      }
      if (
        p.teamSize &&
        !(VALID_TEAM_SIZES as readonly string[]).includes(p.teamSize)
      ) {
        throw new BadRequestException(
          `teamSize must be one of: ${VALID_TEAM_SIZES.join(', ')}`,
        );
      }
    }
    if (p.profileType === 'personal' && !p.fullName?.trim()) {
      throw new BadRequestException('fullName is required for Personal');
    }
    if (
      p.knowledgeVisibility !== undefined &&
      p.knowledgeVisibility !== 'all' &&
      p.knowledgeVisibility !== 'admins'
    ) {
      throw new BadRequestException(
        'knowledgeVisibility must be "all" or "admins"',
      );
    }
  }
}
