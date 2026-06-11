import { Injectable, Logger } from '@nestjs/common';

import {
  MicrosoftOAuthService,
  ReauthRequiredError,
} from '../microsoft/microsoft-oauth.service.js';

/**
 * A OneDrive folder as the FE picker sees it. `id` is the Graph
 * driveItem id (an opaque string from our side, just round-trips
 * back to Graph). `hasChildren` comes inline from `folder.childCount`,
 * no second round-trip needed.
 */
export interface OneDriveFolderMeta {
  id: string;
  name: string;
  hasChildren: boolean;
}

/**
 * One importable OneDrive file as the KC import path sees it.
 * OneDrive is single-drive (every user has exactly one `/me/drive`),
 * so unlike SharePoint we don't carry a driveId — the storage key is
 * just `itemId`.
 */
export interface OneDriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  sizeBytes: number | null;
}

/** Result of `downloadFile`. Buffer is the file's bytes. */
export interface OneDriveDownload {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Safety cap on full-drive walks — matches the SharePoint cap. */
const MAX_PAGES = 20;

/** Match the Drive ceiling — 50 MB. KC ingestion can't handle larger. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface GraphErrorBody {
  error?: {
    code?: string;
    message?: string;
    innerError?: {
      code?: string;
      message?: string;
      'request-id'?: string;
      date?: string;
    };
  };
}

interface GraphPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface GraphDriveItem {
  id: string;
  name?: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  '@microsoft.graph.downloadUrl'?: string;
}

@Injectable()
export class OneDriveGraphService {
  private readonly logger = new Logger(OneDriveGraphService.name);

  constructor(private readonly oauth: MicrosoftOAuthService) {}

  /**
   * GET against the Graph API with the user's access token. Mirrors
   * the SharePoint helper: one auto-retry on 401 (clock skew —
   * token just-expired in flight) and one retry on 429 with
   * Retry-After respected.
   */
  private async graphGet<T>(userId: string, path: string): Promise<T> {
    const doFetch = async (token: string): Promise<Response> => {
      const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
      return fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    };

    let token = await this.oauth.getValidAccessToken(userId);
    let res = await doFetch(token);

    if (res.status === 401) {
      token = await this.oauth.getValidAccessToken(userId);
      res = await doFetch(token);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '2');
      const waitMs = Math.min(Math.max(retryAfter, 1), 30) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await doFetch(token);
    }

    if (res.status === 401) {
      throw new ReauthRequiredError(
        'OneDrive connection needs reauthorization.',
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as GraphErrorBody;
      const code = body.error?.code;
      const message = body.error?.message ?? `${res.status} ${res.statusText}`;
      const innerCode = body.error?.innerError?.code;
      const requestId = body.error?.innerError?.['request-id'];
      const detail = [
        message,
        code ? `code=${code}` : null,
        innerCode ? `innerCode=${innerCode}` : null,
        requestId ? `request-id=${requestId}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
      throw new Error(`Microsoft Graph error: ${detail}`);
    }

    return (await res.json()) as T;
  }

  /** Paginate a Graph collection endpoint, capped at MAX_PAGES. */
  private async paginate<T>(
    userId: string,
    firstPath: string,
    onProgress?: (count: number) => void,
    fileLimit?: number,
  ): Promise<{ items: T[]; hasMore: boolean }> {
    const items: T[] = [];
    let next: string | undefined = firstPath;
    let pages = 0;
    while (next && pages < MAX_PAGES) {
      const page: GraphPage<T> = await this.graphGet<GraphPage<T>>(
        userId,
        next,
      );
      for (const v of page.value) {
        items.push(v);
        onProgress?.(items.length);
      }
      if (fileLimit !== undefined && items.length > fileLimit) {
        return { items, hasMore: !!page['@odata.nextLink'] };
      }
      next = page['@odata.nextLink'];
      pages++;
    }
    return { items, hasMore: !!next };
  }

  /**
   * List immediate folder children of `parentItemId` inside the
   * user's OneDrive. `parentItemId` defaults to the drive root.
   * `hasChildren` is computed from `folder.childCount > 0` inline.
   *
   * Personal MSA accounts may not have a working `/me/drive` — Graph
   * returns "This API is not supported for MSA accounts". Caller
   * surfaces empty list with the same MSA short-circuit used in
   * SharePoint.
   */
  async listFolders(
    userId: string,
    parentItemId?: string,
  ): Promise<OneDriveFolderMeta[]> {
    const anchor = parentItemId ? `items/${parentItemId}` : 'root';
    const { items } = await this.paginate<GraphDriveItem>(
      userId,
      `/me/drive/${anchor}/children?$select=id,name,folder&$top=200`,
    );
    return items
      .filter((it) => it.folder != null)
      .map((it) => ({
        id: it.id,
        name: it.name ?? 'Untitled folder',
        hasChildren: (it.folder?.childCount ?? 0) > 0,
      }));
  }

  /**
   * Collect every importable file under the given scope:
   *   - scope = { kind: 'all' } → BFS from /me/drive root.
   *   - scope = { kind: 'folders', folderIds } → BFS each folder.
   *
   * No drive dimension — every call hits /me/drive (single user
   * drive). `fileLimit` lets the import service fail fast on
   * runaway counts.
   */
  async listFiles(
    userId: string,
    scope: { kind: 'all' } | { kind: 'folders'; folderIds: string[] },
    fileLimit?: number,
    onProgress?: (count: number) => void,
  ): Promise<OneDriveFileMeta[]> {
    const startFolders: string[] =
      scope.kind === 'all' ? ['root'] : scope.folderIds;
    onProgress?.(0);
    return this.walkSubtree(userId, startFolders, fileLimit);
  }

  /**
   * BFS the given starting folder ids inside /me/drive. Returns every
   * non-folder descendant.
   */
  private async walkSubtree(
    userId: string,
    startFolderIds: string[],
    fileLimit: number | undefined,
  ): Promise<OneDriveFileMeta[]> {
    const out: OneDriveFileMeta[] = [];
    const visited = new Set<string>();
    const queue = [...startFolderIds];

    outer: while (queue.length > 0) {
      const folderId = queue.shift()!;
      if (visited.has(folderId)) continue;
      visited.add(folderId);

      const anchor = folderId === 'root' ? 'root' : `items/${folderId}`;
      let next: string | undefined =
        `/me/drive/${anchor}/children?$select=id,name,size,file,folder,webUrl,lastModifiedDateTime&$top=200`;
      let pages = 0;

      while (next && pages < MAX_PAGES) {
        const page: GraphPage<GraphDriveItem> = await this.graphGet<
          GraphPage<GraphDriveItem>
        >(userId, next);
        for (const item of page.value) {
          if (item.folder) {
            queue.push(item.id);
            continue;
          }
          if (!item.file) continue;
          out.push({
            id: item.id,
            name: item.name ?? 'Untitled',
            mimeType: item.file.mimeType ?? 'application/octet-stream',
            modifiedTime: item.lastModifiedDateTime,
            webViewLink: item.webUrl,
            sizeBytes: typeof item.size === 'number' ? item.size : null,
          });
        }
        if (fileLimit !== undefined && out.length > fileLimit) break outer;
        next = page['@odata.nextLink'];
        pages++;
      }
    }
    return out;
  }

  /**
   * Download the file's bytes. Fetches the full driveItem (NOT with
   * $select — the @microsoft.graph.downloadUrl annotation is stripped
   * by Graph when $select is used). The pre-authenticated downloadUrl
   * is short-lived (~1h) so we always re-fetch at download time.
   */
  async downloadFile(
    userId: string,
    itemId: string,
  ): Promise<OneDriveDownload> {
    const meta = await this.graphGet<GraphDriveItem>(
      userId,
      `/me/drive/items/${itemId}`,
    );
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      throw new Error(
        'OneDrive did not return a download URL for this item. ' +
          'The item may be a folder, a placeholder, or the user lost ' +
          'read access between scan and download time.',
      );
    }
    const mimeType = meta.file?.mimeType ?? 'application/octet-stream';
    const filename = meta.name ?? 'untitled';

    // downloadUrl is pre-authenticated — no Authorization header.
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(
        `OneDrive download failed: ${res.status} ${res.statusText}`,
      );
    }
    const ab = await res.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      mimeType,
      filename,
    };
  }

  /**
   * Cheap scan used by the import-dialog warning banner. Walks
   * /me/drive root, applies the 50 MB size filter, returns matching
   * filenames. Cap at MAX_PAGES per the SharePoint precedent.
   */
  async estimateFileCount(
    userId: string,
  ): Promise<{ fileNames: string[]; hasMore: boolean }> {
    const fileNames: string[] = [];
    let hasMore = false;
    const visited = new Set<string>();
    const queue: string[] = ['root'];
    let pages = 0;

    while (queue.length > 0 && pages < MAX_PAGES) {
      const folderId = queue.shift()!;
      if (visited.has(folderId)) continue;
      visited.add(folderId);

      const anchor = folderId === 'root' ? 'root' : `items/${folderId}`;
      let next: string | undefined =
        `/me/drive/${anchor}/children?$select=id,name,size,file,folder&$top=200`;
      while (next && pages < MAX_PAGES) {
        const page: GraphPage<GraphDriveItem> = await this.graphGet<
          GraphPage<GraphDriveItem>
        >(userId, next);
        for (const item of page.value) {
          if (item.folder) {
            queue.push(item.id);
            continue;
          }
          if (!item.file || !item.name) continue;
          if (typeof item.size === 'number' && item.size > MAX_FILE_BYTES)
            continue;
          fileNames.push(item.name);
        }
        next = page['@odata.nextLink'];
        pages++;
      }
    }
    if (queue.length > 0) hasMore = true;
    return { fileNames, hasMore };
  }

  /** Resolve a OneDrive folder's display name. */
  async getFolderName(userId: string, itemId: string): Promise<string> {
    try {
      const meta = await this.graphGet<GraphDriveItem>(
        userId,
        `/me/drive/items/${itemId}?$select=name`,
      );
      return meta.name ?? `Folder (${itemId.slice(0, 8)}…)`;
    } catch {
      return `Folder (${itemId.slice(0, 8)}…)`;
    }
  }
}
