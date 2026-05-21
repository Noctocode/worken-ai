import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
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
  teamMembers,
  companies,
  integrations,
  knowledgeFiles,
  knowledgeFolders,
  onboardingDrafts,
  tenders,
  tenderTeamMembers,
  modelConfigs,
  guardrails,
  conversations,
  projects,
  messages,
  documents as documentsTable,
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

  const cleaned = lastSegment
    // \x00-\x1f are exactly what we want to strip — control bytes can
    // hide path-traversal payloads and are filesystem-illegal on
    // Windows, so the control-char range is the entire point of this
    // class.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '');
  return cleaned || 'file';
}

// knowledge_files doesn't carry a mime_type column (KC uploads only
// retain extension), so reconstruct one for downloads. Covers the
// onboarding-allowed types plus a sensible default.
function mimeFromExtension(fileType: string | null, filename: string): string {
  const ext = (fileType ?? extname(filename).replace('.', '')).toLowerCase();
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

  /**
   * Escape hatch for a mid-onboarding user who can't (or won't)
   * complete the wizard. Wipes their `users` row plus every
   * row that would otherwise be FK-orphaned, freeing the email
   * for re-registration.
   *
   * Hard-gated on `onboarding_completed_at IS NULL`: an already-
   * onboarded user with real teams / chats / projects must go
   * through the normal "delete my account" admin path (a future
   * follow-up); this endpoint only covers the "I got stuck in
   * the wizard" case where the row is mostly empty.
   *
   * Companies-row cleanup: in practice a mid-onboarding row has
   * `company_id = NULL` because `completeInner` mints the
   * `companies` row inside the same transaction that stamps
   * `onboarding_completed_at`. But we defensively delete the
   * tenant row anyway if the caller is the only member — protects
   * against a future race or a support-action that cleared
   * `onboarding_completed_at` without touching `company_id`.
   */
  async abortOnboarding(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Lock + re-check inside the transaction so a concurrent
      // /onboarding/complete can't stamp onboardingCompletedAt
      // between our gate and the cascade. Checking outside the tx
      // left a window where a racing complete-then-abort would
      // succeed against a now-fully-onboarded user — `FOR UPDATE`
      // serialises the two writers on the users row.
      const [current] = await tx
        .select({
          id: users.id,
          companyId: users.companyId,
          onboardingCompletedAt: users.onboardingCompletedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');

      if (!current) throw new NotFoundException('User not found');
      if (current.onboardingCompletedAt) {
        throw new BadRequestException(
          'Onboarding already completed — this endpoint only covers interrupted setup. ' +
            'Contact support to delete a fully-onboarded account.',
        );
      }

      const companyId = current.companyId;

      // Owned teams shouldn't exist mid-onboarding (team creation
      // requires a finished profile), but tear them down anyway in
      // case a future flow or a support action created one.
      // Mirrors UsersService.remove so the FK web stays consistent
      // regardless of which path nukes a user.
      const ownedTeams = await tx
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.ownerId, userId));
      const ownedTeamIds = ownedTeams.map((t) => t.id);
      if (ownedTeamIds.length > 0) {
        await tx
          .update(projects)
          .set({ teamId: null })
          .where(inArray(projects.teamId, ownedTeamIds));
        await tx
          .delete(teamMembers)
          .where(inArray(teamMembers.teamId, ownedTeamIds));
        await tx.delete(teams).where(inArray(teams.id, ownedTeamIds));
      }

      await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
      await tx
        .delete(tenderTeamMembers)
        .where(eq(tenderTeamMembers.userId, userId));
      await tx.delete(tenders).where(eq(tenders.ownerId, userId));
      await tx
        .delete(knowledgeFolders)
        .where(eq(knowledgeFolders.ownerId, userId));
      await tx.delete(modelConfigs).where(eq(modelConfigs.ownerId, userId));
      await tx.delete(guardrails).where(eq(guardrails.ownerId, userId));
      await tx.delete(conversations).where(eq(conversations.userId, userId));

      // documents.project_id is ON DELETE NO ACTION, so a project
      // with attached documents would 23503-fail the projects
      // delete below. Nuke documents owned by this user's projects
      // first. Mid-onboarding rows almost never have any (projects
      // aren't reachable from the wizard), but a future flow or a
      // support-cleared `onboardingCompletedAt` could leave some
      // behind — the explicit cleanup keeps abort robust.
      const ownedProjects = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.userId, userId));
      const ownedProjectIds = ownedProjects.map((p) => p.id);
      if (ownedProjectIds.length > 0) {
        await tx
          .delete(documentsTable)
          .where(inArray(documentsTable.projectId, ownedProjectIds));
      }

      await tx.delete(projects).where(eq(projects.userId, userId));
      await tx.delete(integrations).where(eq(integrations.ownerId, userId));

      // Files uploaded mid-onboarding (e.g., the user reached step 6
      // and attached docs before bailing) — null the FK so the row
      // stays around if it was attached to a folder we just deleted
      // cascades correctly. Folders are owned by the user and
      // already deleted above; their files cascade out too. Keep
      // this NULL-update for any straggler from a future flow.
      await tx
        .update(knowledgeFiles)
        .set({ uploadedById: null })
        .where(eq(knowledgeFiles.uploadedById, userId));

      await tx
        .update(messages)
        .set({ userId: null })
        .where(eq(messages.userId, userId));

      await tx
        .delete(onboardingDrafts)
        .where(eq(onboardingDrafts.userId, userId));

      await tx.delete(users).where(eq(users.id, userId));

      // Tenant cleanup: drop the companies row if this user was the
      // sole member. Check AFTER the user delete so the LIMIT 1
      // probe doesn't accidentally count the deleted row.
      if (companyId) {
        const [otherMember] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.companyId, companyId))
          .limit(1);
        if (!otherMember) {
          await tx.delete(companies).where(eq(companies.id, companyId));
        }
      }
    });
  }

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
      // Tenant identity for company-profile completions. We *always*
      // mint a fresh `companies` row here — no name-based dedupe.
      // Same display name on two different `company_id`s is the
      // explicit design: two self-signups that happen to pick the
      // same name are two distinct tenants, isolated from each
      // other by UUID. Invitees never reach this branch because
      // their `companies.id` is inherited at invite time and their
      // first login lands them on /dashboard, not /setup-profile.
      //
      // Re-running onboarding (support-cleared
      // `onboardingCompletedAt`) does still hit this branch and
      // creates a *new* `companies` row — the prior row plus its
      // teams already got torn down by the support action, so
      // there's nothing to reconcile against.
      let companyId: string | null = null;
      if (payload.profileType === 'company' && payload.companyName?.trim()) {
        const [created] = await tx
          .insert(companies)
          .values({
            name: payload.companyName.trim(),
            industry: payload.industry ?? null,
            teamSize: payload.teamSize ?? null,
            infraChoice: payload.infraChoice,
          })
          .returning({ id: companies.id });
        companyId = created.id;
      }

      await tx
        .update(users)
        .set({
          profileType: payload.profileType,
          name:
            payload.profileType === 'personal' && payload.fullName
              ? payload.fullName
              : current.name,
          // companyId is the tenant identifier; the columns below are
          // display caches kept in sync on every write so /auth/me
          // and tenant-scoped listings don't need to join companies.
          companyId,
          companyName:
            payload.profileType === 'company' ? payload.companyName : null,
          industry: payload.profileType === 'company' ? payload.industry : null,
          teamSize: payload.profileType === 'company' ? payload.teamSize : null,
          infraChoice: payload.infraChoice,
          // Self-signup → admin of the freshly-created tenant
          // (company profile) OR sole owner of their own workspace
          // (personal profile). Both branches arrive here from
          // /setup-profile, which is reachable only by users who
          // *weren't* pre-seeded by an invite flow (invitees get
          // their role + companyId from the inviter and bypass the
          // wizard entirely on first login). Default is 'basic' on
          // the users row; we promote to 'admin' so the new tenant
          // owner can immediately invite + manage their org without
          // a second user having to grant them the role.
          role: 'admin',
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
          if (!SUPPORTED_FOR_INTEGRATION_TABLE.includes(provider as Provider)) {
            this.logger.warn(
              `Onboarding step-5: ${provider} key supplied but no matching predefined provider — skipping. User ${userId} can finish setup in Management → Integration.`,
            );
            continue;
          }
          // onConflictDoNothing on the partial unique index
          // `(owner_id, provider_id) WHERE api_url IS NULL AND
          // team_id IS NULL` so a re-run of onboarding (e.g. support
          // action that cleared `onboarding_completed_at` after the
          // legacy backfill SQL was applied) doesn't crash the whole
          // transaction with 23505 and orphan the just-uploaded
          // knowledge documents. The existing row is left as-is —
          // the user can update keys from Management → Integration.
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
              // Index inference rule for partial unique indexes:
              // the ON CONFLICT WHERE clause must IMPLY the index's
              // predicate (i.e. be at least as restrictive). The
              // matching index here is
              // `integrations_owner_provider_predef_unique` defined
              // as (owner_id, provider_id) WHERE api_url IS NULL AND
              // team_id IS NULL — so this predicate must also include
              // team_id IS NULL. Earlier the WHERE only carried
              // api_url IS NULL, which is *less* restrictive than the
              // index predicate; Postgres rejected it with 42P10
              // ("no unique or exclusion constraint matching the ON
              // CONFLICT specification"), surfacing as a 500 on
              // /onboarding/complete the moment a user supplied an
              // OpenAI / Anthropic key in step-5.
              where: sql`${integrations.apiUrl} IS NULL AND ${integrations.teamId} IS NULL`,
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
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
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
        companyId: users.companyId,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!current) throw new NotFoundException('User not found');
    if (current.profileType !== 'company') {
      throw new BadRequestException(
        'Profile editing here only applies to company-profile accounts.',
      );
    }

    // Updates split across two rows:
    //   - `userUpdates` writes the display-cache columns on the
    //     caller's `users` row (so /auth/me reads cheap).
    //   - `companyUpdates` mirrors the same change onto the tenant
    //     row + every co-tenant's cached columns, so a rename or
    //     industry change is visible to other members on next
    //     refetch instead of going stale until they re-login.
    const userUpdates: Record<string, unknown> = { updatedAt: new Date() };
    const companyUpdates: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      // Empty name is permitted — clears it. Onboarding "fullName"
      // wasn't required for company branch, so don't enforce here.
      // Personal display name only — not propagated to other members.
      userUpdates.name = trimmed.length > 0 ? trimmed : null;
    }
    if (input.companyName !== undefined) {
      const trimmed = input.companyName.trim();
      if (!trimmed) {
        throw new BadRequestException('Company name cannot be empty.');
      }
      userUpdates.companyName = trimmed;
      companyUpdates.name = trimmed;
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
      const normalised = trimmed.length > 0 ? trimmed : null;
      userUpdates.industry = normalised;
      companyUpdates.industry = normalised;
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
      const normalised = trimmed.length > 0 ? trimmed : null;
      userUpdates.teamSize = normalised;
      companyUpdates.teamSize = normalised;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(users).set(userUpdates).where(eq(users.id, userId));

      // Propagate the company-shaped fields to the tenant row and
      // every co-tenant's display cache. Guarded on `companyId`
      // because pre-migration users (or self-signups still
      // mid-onboarding) may not have a tenant row yet — the patch
      // still updates the caller's own cache columns, but there's
      // nothing to mirror.
      if (current.companyId && Object.keys(companyUpdates).length > 0) {
        await tx
          .update(companies)
          .set({ ...companyUpdates, updatedAt: new Date() })
          .where(eq(companies.id, current.companyId));

        // Co-tenant cache refresh. Excludes the caller (already
        // updated above) so we don't re-trigger their updatedAt.
        const coTenantUpdates: Record<string, unknown> = {
          updatedAt: new Date(),
        };
        if (companyUpdates.name !== undefined) {
          coTenantUpdates.companyName = companyUpdates.name;
        }
        if (companyUpdates.industry !== undefined) {
          coTenantUpdates.industry = companyUpdates.industry;
        }
        if (companyUpdates.teamSize !== undefined) {
          coTenantUpdates.teamSize = companyUpdates.teamSize;
        }
        await tx
          .update(users)
          .set(coTenantUpdates)
          .where(
            and(
              eq(users.companyId, current.companyId),
              sql`${users.id} <> ${userId}`,
            ),
          );
      }
    });

    return this.getProfile(userId);
  }

  /**
   * "Delete company" tear-down for the Trash button on the Company
   * tab. Tenant-scoped: wipes the *caller's* company only — other
   * tenants on the same deployment are untouched. Drops the tenant's
   * `companies` row, every team owned by a tenant member (cascades
   * also nuke team_members + team-scoped integrations), and clears
   * the company-shaped onboarding fields on every member so they
   * land on /setup-profile next render. User accounts, roles, plans,
   * personal API keys, personal chats / conversations / projects
   * survive.
   *
   * Admin-only, company-profile-only, and requires the caller to
   * actually have a `company_id` — a personal-profile caller or a
   * mid-onboarding user has nothing to delete.
   */
  async deleteCompany(userId: string): Promise<{
    deletedTeamCount: number;
    affectedUserCount: number;
  }> {
    const [caller] = await this.db
      .select({
        role: users.role,
        profileType: users.profileType,
        companyId: users.companyId,
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
    if (!caller.companyId) {
      throw new BadRequestException(
        'No company tenant is linked to this account.',
      );
    }
    const companyId = caller.companyId;

    // Atomic tear-down: wrapping the destructive sequence in one
    // transaction keeps the tenant from landing in a half-deleted
    // state if any step fails (e.g. teams partially deleted but
    // users.profileType still set, or parentTeamId cleared but the
    // teams themselves still around because the DELETE timed out).
    return await this.db.transaction(async (tx) => {
      // Snapshot the tenant's user ids first — needed both as the
      // scope filter for the team delete (teams have no companyId
      // column; their tenant is the owner's tenant) and for the
      // post-deletion counts shown in the success toast.
      const tenantUsers = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.companyId, companyId));
      const tenantUserIds = tenantUsers.map((u) => u.id);
      const affectedUserCount = tenantUserIds.length;

      // No tenant users means the companies row is orphaned. Delete
      // it and short-circuit — the team / user updates below have
      // nothing to do.
      if (tenantUserIds.length === 0) {
        await tx.delete(companies).where(eq(companies.id, companyId));
        return { deletedTeamCount: 0, affectedUserCount: 0 };
      }

      // Break parent→child team edges before the bulk delete. PG can
      // trip on a single DELETE that touches both ends of the
      // self-reference even though parent_team_id is `set null`; pre-
      // clearing keeps the cascade well-defined. Scoped to teams
      // whose owner sits in the tenant.
      await tx
        .update(teams)
        .set({ parentTeamId: null })
        .where(inArray(teams.ownerId, tenantUserIds));

      const deletedTeams = await tx
        .delete(teams)
        .where(inArray(teams.ownerId, tenantUserIds))
        .returning({ id: teams.id });

      // Reset company-shaped fields for tenant members. profileType
      // and onboardingCompletedAt cleared so each lands on
      // /setup-profile on next render — fresh start. Bumping
      // updatedAt so audit consumers see the change. companyId
      // null'd explicitly even though the FK is ON DELETE SET NULL
      // below, so the post-condition is uniform regardless of which
      // path actually clears it.
      await tx
        .update(users)
        .set({
          profileType: null,
          companyId: null,
          companyName: null,
          industry: null,
          teamSize: null,
          infraChoice: null,
          onboardingCompletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.companyId, companyId));

      await tx.delete(companies).where(eq(companies.id, companyId));

      return {
        deletedTeamCount: deletedTeams.length,
        affectedUserCount,
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
