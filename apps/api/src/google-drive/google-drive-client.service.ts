import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';

import {
  GoogleDriveOAuthService,
  ReauthRequiredError,
} from './google-drive-oauth.service.js';

/**
 * One imported Drive file as the KC import path sees it. `name` is
 * the final filename we'll write to the KC row — Google native formats
 * get a synthetic extension (`.docx`/`.xlsx`/`.pdf`) so the existing
 * KC parser dispatch in DocumentsService can route on extension as
 * usual.
 */
export interface DriveFileMeta {
  /** Drive's `fileId`. Stable across renames/moves, persisted as `external_id`. */
  id: string;
  name: string;
  /**
   * Effective MIME type after Google-native conversion. For uploaded
   * binaries this is whatever Drive reported; for Google Docs / Sheets
   * / Slides this is the export target (DOCX / XLSX / PDF).
   */
  mimeType: string;
  /** Original Drive MIME — kept so `downloadFile` can pick the right path. */
  driveMimeType: string;
  /** Last modification time per Drive, ISO string. Not used yet, but
   *  surfaced for a future "re-ingest changed files" feature. */
  modifiedTime?: string;
  /** Drive's "Open in Drive" link. Persisted as `external_url`. */
  webViewLink?: string;
  /**
   * Byte size as Drive reports it. NULL for Google native formats
   * (Drive doesn't surface a meaningful size for those until export).
   */
  sizeBytes: number | null;
}

export interface DriveFolderMeta {
  id: string;
  name: string;
  /** True when this folder has at least one subfolder. Cheap signal so the
   *  FE can render an expand caret without a second round-trip. */
  hasChildren: boolean;
}

/**
 * Result of `downloadFile`. Buffer is the file's bytes, mimeType is
 * what the buffer is actually encoded as (matches DriveFileMeta.mimeType
 * — i.e. after Google-native export).
 */
export interface DriveDownload {
  buffer: Buffer;
  mimeType: string;
  /** Final filename including a synthetic extension for native formats. */
  filename: string;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Google native → export target mapping. Keys are Drive's native MIME
 * types, values are the MIME we ask Drive to export to AND the
 * extension we append to the filename so KC's parser dispatch (which
 * works on extension) routes correctly.
 *
 * Form / Site / Map don't have a sensible export target — they're
 * dropped at list time so they never reach the ingestion path.
 */
const NATIVE_EXPORTS: Record<
  string,
  { exportMimeType: string; ext: string } | undefined
> = {
  'application/vnd.google-apps.document': {
    exportMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    exportMimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    exportMimeType: 'application/pdf',
    ext: '.pdf',
  },
  'application/vnd.google-apps.drawing': {
    exportMimeType: 'application/pdf',
    ext: '.pdf',
  },
};

/**
 * Drop these MIME types from list results — Drive native formats with
 * no useful export target. We could surface them as "unsupported" rows
 * with an ingestion_error, but the user gains nothing from a row
 * they can't open or train on.
 */
const SKIP_NATIVE_MIMES = new Set([
  'application/vnd.google-apps.form',
  'application/vnd.google-apps.site',
  'application/vnd.google-apps.map',
  'application/vnd.google-apps.script',
  'application/vnd.google-apps.shortcut',
  'application/vnd.google-apps.fusiontable',
]);

@Injectable()
export class GoogleDriveClientService {
  private readonly logger = new Logger(GoogleDriveClientService.name);

  constructor(private readonly oauth: GoogleDriveOAuthService) {}

  /**
   * Build a `drive_v3.Drive` client bound to `userId`'s tokens. The
   * client refreshes via `getValidAccessToken` on every call site, so
   * each request gets a fresh token if needed — no caching of an
   * about-to-expire one.
   */
  private async driveClient(userId: string): Promise<drive_v3.Drive> {
    const accessToken = await this.oauth.getValidAccessToken(userId);
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
  }

  /**
   * Run a Drive API call with one automatic retry on 401. Drive
   * sometimes returns 401 for a token that *just* expired in flight
   * (clock skew, edge cache); refreshing once and retrying is cheaper
   * than padding REFRESH_EARLY_MARGIN_SECONDS even further.
   */
  private async runWithRetry<T>(
    userId: string,
    op: (drive: drive_v3.Drive) => Promise<T>,
  ): Promise<T> {
    try {
      return await op(await this.driveClient(userId));
    } catch (err) {
      if (this.isUnauthorized(err)) {
        return op(await this.driveClient(userId));
      }
      throw err;
    }
  }

  private isUnauthorized(err: unknown): boolean {
    if (err instanceof ReauthRequiredError) return false; // already flagged
    // googleapis throws Gaxios errors with this shape; avoid importing
    // gaxios directly (it's a transitive dep that pnpm doesn't expose
    // to the api package).
    const gax = err as { response?: { status?: number } };
    return gax?.response?.status === 401;
  }

  /**
   * Resolve "what is the user's My Drive root folderId?". Needed for
   * scope='all' walks so we can BFS from a real folderId instead of
   * the magic string 'root' (the page-1 walk works with 'root', but
   * downstream we'd lose the ability to display a stable folder id).
   */
  async getRootFolderId(userId: string): Promise<string> {
    return this.runWithRetry(userId, async (drive) => {
      const res = await drive.files.get({
        fileId: 'root',
        fields: 'id',
      });
      if (!res.data.id) {
        throw new Error("Drive didn't return a root folder id");
      }
      return res.data.id;
    });
  }

  /**
   * List immediate folder children of `parentId`. Used by the FE
   * folder picker for lazy expansion. `parentId='root'` lists the
   * top level of the user's My Drive.
   */
  async listFolders(
    userId: string,
    parentId = 'root',
  ): Promise<DriveFolderMeta[]> {
    return this.runWithRetry(userId, async (drive) => {
      const folders: DriveFolderMeta[] = [];
      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
          fields: 'nextPageToken, files(id, name)',
          pageSize: 200,
          pageToken,
          orderBy: 'name',
        });
        for (const f of res.data.files ?? []) {
          if (!f.id || !f.name) continue;
          folders.push({ id: f.id, name: f.name, hasChildren: false });
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      // Second pass: mark which folders have subfolders so the FE can
      // render an expand caret. Done as a single batched OR query to
      // keep this O(1) round-trips even with hundreds of folders.
      if (folders.length > 0) {
        const orClause = folders
          .map((f) => `'${f.id}' in parents`)
          .join(' or ');
        const probeRes = await drive.files.list({
          q: `(${orClause}) and mimeType = '${FOLDER_MIME}' and trashed = false`,
          fields: 'files(parents)',
          pageSize: 1000,
        });
        const withChildren = new Set<string>();
        for (const f of probeRes.data.files ?? []) {
          for (const p of f.parents ?? []) withChildren.add(p);
        }
        for (const f of folders) {
          if (withChildren.has(f.id)) f.hasChildren = true;
        }
      }
      return folders;
    });
  }

  /**
   * Collect every importable file under the given scope.
   *
   *   - scope = { kind: 'all' } → every non-folder file in the user's
   *     My Drive (corpora=user), excluding trashed.
   *   - scope = { kind: 'folders', folderIds } → BFS each folder,
   *     collecting all descendant non-folder files. Folders that
   *     don't belong to the user (shared shortcuts, etc.) are
   *     gracefully skipped.
   *
   * Drive-native formats with no useful export target (forms, sites,
   * maps, …) are filtered out here so they never reach the ingestion
   * path. Folders themselves are excluded.
   *
   * @param fileLimit - Optional early-exit cap. Listing stops as soon
   *   as the collected array exceeds this number. The caller (Drive
   *   import service) is expected to enforce the hard cap on the
   *   returned array; passing `MAX_IMPORT_FILES + 1` here lets the
   *   size check fail fast without walking the rest of a huge Drive.
   */
  async listFiles(
    userId: string,
    scope: { kind: 'all' } | { kind: 'folders'; folderIds: string[] },
    fileLimit?: number,
  ): Promise<DriveFileMeta[]> {
    if (scope.kind === 'all') {
      return this.runWithRetry(userId, (drive) =>
        this.listFilesGlobal(drive, fileLimit),
      );
    }
    return this.runWithRetry(userId, (drive) =>
      this.listFilesUnderFolders(drive, scope.folderIds, fileLimit),
    );
  }

  private async listFilesGlobal(
    drive: drive_v3.Drive,
    fileLimit?: number,
  ): Promise<DriveFileMeta[]> {
    const out: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `mimeType != '${FOLDER_MIME}' and trashed = false`,
        corpora: 'user',
        fields:
          'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)',
        pageSize: 1000,
        pageToken,
      });
      for (const f of res.data.files ?? []) {
        const meta = this.toMeta(f);
        if (meta) out.push(meta);
      }
      pageToken = res.data.nextPageToken ?? undefined;
      // Early exit: stop fetching pages once we've seen more than the
      // caller's cap so a huge Drive fails fast rather than exhausting
      // all pages before the BadRequestException fires.
      if (fileLimit !== undefined && out.length > fileLimit) break;
    } while (pageToken);
    return out;
  }

  private async listFilesUnderFolders(
    drive: drive_v3.Drive,
    folderIds: string[],
    fileLimit?: number,
  ): Promise<DriveFileMeta[]> {
    const out: DriveFileMeta[] = [];
    const visited = new Set<string>();
    const queue = [...folderIds];

    outer: while (queue.length > 0) {
      const folderId = queue.shift()!;
      if (visited.has(folderId)) continue;
      visited.add(folderId);

      let pageToken: string | undefined;
      do {
        const res = await drive.files.list({
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, size)',
          pageSize: 1000,
          pageToken,
        });
        for (const f of res.data.files ?? []) {
          if (!f.id) continue;
          if (f.mimeType === FOLDER_MIME) {
            queue.push(f.id);
            continue;
          }
          const meta = this.toMeta(f);
          if (meta) out.push(meta);
        }
        pageToken = res.data.nextPageToken ?? undefined;
        // Early exit: stop the entire BFS once we're over the cap.
        if (fileLimit !== undefined && out.length > fileLimit) break outer;
      } while (pageToken);
    }
    return out;
  }

  /**
   * Translate a raw Drive file into our `DriveFileMeta`, filtering
   * out unsupported native formats and resolving native → export
   * target. Returns `null` to skip the file entirely.
   */
  private toMeta(f: drive_v3.Schema$File): DriveFileMeta | null {
    if (!f.id || !f.name || !f.mimeType) return null;
    if (SKIP_NATIVE_MIMES.has(f.mimeType)) return null;

    const native = NATIVE_EXPORTS[f.mimeType];
    if (native) {
      return {
        id: f.id,
        name: this.appendExtIfMissing(f.name, native.ext),
        mimeType: native.exportMimeType,
        driveMimeType: f.mimeType,
        modifiedTime: f.modifiedTime ?? undefined,
        webViewLink: f.webViewLink ?? undefined,
        sizeBytes: null, // Drive doesn't size native formats reliably
      };
    }

    // Uploaded binary — pass MIME through. KC ingestion will decide if
    // it can parse it; unsupported MIMEs fail with ingestion_error.
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      driveMimeType: f.mimeType,
      modifiedTime: f.modifiedTime ?? undefined,
      webViewLink: f.webViewLink ?? undefined,
      sizeBytes: f.size ? Number(f.size) : null,
    };
  }

  /**
   * Add the synthetic extension for Google-native exports only when
   * the user hasn't already named their Doc/Sheet with it. Avoids
   * "Quarterly Report.docx.docx" double-extension noise on import.
   */
  private appendExtIfMissing(name: string, ext: string): string {
    return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
  }

  /**
   * Download the file's bytes. Resolves the Drive MIME with a single
   * `files.get` round-trip up-front so callers don't have to persist
   * it — the ingestion path stores only `external_id` on the KC row
   * and looks up the current MIME at download time (also covers the
   * edge case of a Drive file's type changing between import and
   * ingestion).
   *
   * For Google-native formats this hits `files.export`; for uploaded
   * binaries, `files.get?alt=media`. Both return the bytes as a
   * Buffer ready for write-to-disk + KC parse.
   */
  async downloadFile(userId: string, fileId: string): Promise<DriveDownload> {
    return this.runWithRetry(userId, async (drive) => {
      const meta = await drive.files.get({
        fileId,
        fields: 'name, mimeType',
      });
      const driveMimeType = meta.data.mimeType ?? '';
      const driveName = meta.data.name ?? 'untitled';
      const native = NATIVE_EXPORTS[driveMimeType];

      if (native) {
        const res = await drive.files.export(
          { fileId, mimeType: native.exportMimeType },
          { responseType: 'arraybuffer' },
        );
        return {
          buffer: Buffer.from(res.data as ArrayBuffer),
          mimeType: native.exportMimeType,
          filename: this.appendExtIfMissing(driveName, native.ext),
        };
      }

      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      return {
        buffer: Buffer.from(res.data as ArrayBuffer),
        mimeType: driveMimeType,
        filename: driveName,
      };
    });
  }

  /**
   * Resolve a Drive folder's display name directly via files.get.
   * More reliable than scanning root-level children (which misses
   * nested folders). Falls back to a synthetic slug on error.
   */
  async getFolderName(userId: string, folderId: string): Promise<string> {
    try {
      return await this.runWithRetry(userId, async (drive) => {
        const res = await drive.files.get({
          fileId: folderId,
          fields: 'name',
        });
        return res.data.name ?? `Folder (${folderId.slice(0, 8)}…)`;
      });
    } catch {
      return `Folder (${folderId.slice(0, 8)}…)`;
    }
  }
}
