import { Injectable, Logger } from '@nestjs/common';

import {
  ReauthRequiredError,
  SharePointOAuthService,
} from './sharepoint-oauth.service.js';

/**
 * A SharePoint site as the FE picker sees it. `id` is Graph's
 * site identifier (composite `{hostname},{site-collection-id},{site-id}`
 * shape) — opaque from our side, just round-trips back to Graph.
 */
export interface SharePointSiteMeta {
  id: string;
  /** Internal short name (URL segment). */
  name: string;
  /** Human-readable display name. Use this in the picker UI. */
  displayName: string;
  /** Direct link to the site in SharePoint. */
  webUrl?: string;
}

/**
 * A drive (document library) inside a SharePoint site.
 * Most sites have a single default "Documents" drive; some have many.
 */
export interface SharePointDriveMeta {
  id: string;
  name: string;
  driveType?: string;
  webUrl?: string;
}

/**
 * A folder inside a SharePoint drive, as the folder-picker sees it.
 * `hasChildren` comes inline from Graph (folder.childCount), no
 * second round-trip needed — easier than the Drive case.
 */
export interface SharePointFolderMeta {
  id: string;
  name: string;
  hasChildren: boolean;
}

/**
 * One importable SharePoint file as the KC import path sees it.
 * `driveId` is required for download — SharePoint item ids alone are
 * not globally unique across drives, so we always pair (driveId, id).
 */
export interface SharePointFileMeta {
  id: string;
  driveId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  sizeBytes: number | null;
}

/** Result of `downloadFile`. Buffer is the file's bytes. */
export interface SharePointDownload {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Safety cap on full-site walks. Each Graph page is up to 200 items,
 * so 20 pages ≈ 4 000 raw items per drive — enough for any sane
 * site, and the import-cap guard catches anything beyond that.
 */
const MAX_PAGES = 20;

/** Match the Drive ceiling — 50 MB. KC ingestion can't handle larger. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface GraphErrorBody {
  error?: { code?: string; message?: string };
}

interface GraphPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface GraphSite {
  id: string;
  name?: string;
  displayName?: string;
  webUrl?: string;
}

interface GraphDrive {
  id: string;
  name: string;
  driveType?: string;
  webUrl?: string;
}

interface GraphDriveItem {
  id: string;
  name?: string;
  webUrl?: string;
  size?: number;
  lastModifiedDateTime?: string;
  parentReference?: { driveId?: string };
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  '@microsoft.graph.downloadUrl'?: string;
}

@Injectable()
export class SharePointGraphService {
  private readonly logger = new Logger(SharePointGraphService.name);

  constructor(private readonly oauth: SharePointOAuthService) {}

  /**
   * GET against the Graph API with the user's access token, one
   * automatic retry on 401 (clock skew — token just-expired in
   * flight) and one retry on 429 with Retry-After respected.
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

    // 401 → refresh once and retry. The token may have expired
    // mid-flight (clock skew between us and Microsoft); the next
    // getValidAccessToken refreshes if needed.
    if (res.status === 401) {
      token = await this.oauth.getValidAccessToken(userId);
      res = await doFetch(token);
    }

    // 429 → respect Retry-After, single retry. Graph rate-limits
    // more aggressively than Drive (especially on `/sites?search=*`).
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '2');
      const waitMs = Math.min(Math.max(retryAfter, 1), 30) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      res = await doFetch(token);
    }

    if (res.status === 401) {
      // Still 401 after refresh — flag for reauth so the FE prompts
      // a reconnect.
      throw new ReauthRequiredError(
        'SharePoint connection needs reauthorization.',
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as GraphErrorBody;
      const detail = body.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`Microsoft Graph error: ${detail}`);
    }

    return (await res.json()) as T;
  }

  /**
   * Paginate a Graph collection endpoint, capped at MAX_PAGES so a
   * pathological tenant can't make us walk a million items.
   */
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
      const page = await this.graphGet<GraphPage<T>>(userId, next);
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
   * List SharePoint sites the user can access. Uses the
   * `/sites?search=*` endpoint which returns every site visible to
   * the signed-in user (Graph filters by delegated permissions).
   *
   * Capped at MAX_PAGES (≈ 4000 sites). Practically unreachable in
   * sane tenants; very large tenants get a "showing first N" hint
   * in the FE.
   */
  async listSites(userId: string): Promise<SharePointSiteMeta[]> {
    const { items } = await this.paginate<GraphSite>(
      userId,
      '/sites?search=*&$select=id,name,displayName,webUrl&$top=200',
    );
    return items.map((s) => ({
      id: s.id,
      name: s.name ?? '',
      displayName: s.displayName ?? s.name ?? 'Untitled site',
      webUrl: s.webUrl,
    }));
  }

  /**
   * List document libraries (drives) inside a SharePoint site.
   * Almost every site has at least one default "Documents" drive;
   * some sites add custom drives for ops-specific document sets.
   */
  async listDrives(
    userId: string,
    siteId: string,
  ): Promise<SharePointDriveMeta[]> {
    const { items } = await this.paginate<GraphDrive>(
      userId,
      `/sites/${siteId}/drives?$select=id,name,driveType,webUrl&$top=200`,
    );
    return items.map((d) => ({
      id: d.id,
      name: d.name,
      driveType: d.driveType,
      webUrl: d.webUrl,
    }));
  }

  /**
   * List immediate folder children of `parentItemId` inside the
   * given drive. `parentItemId` defaults to the drive root.
   *
   * Unlike Drive, Graph returns `folder.childCount` inline on every
   * item, so we can compute `hasChildren` without a second batch
   * query.
   */
  async listFolders(
    userId: string,
    driveId: string,
    parentItemId?: string,
  ): Promise<SharePointFolderMeta[]> {
    const anchor = parentItemId ? `items/${parentItemId}` : 'root';
    // We can't `$filter=folder ne null` reliably across all tenants
    // (older endpoints reject the filter), so we fetch everything
    // and filter client-side — small extra payload, much better
    // compatibility.
    const { items } = await this.paginate<GraphDriveItem>(
      userId,
      `/drives/${driveId}/${anchor}/children?$select=id,name,folder&$top=200`,
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
   * Collect every importable file under the given scope.
   *
   *   - scope = { kind: 'site', siteId } → BFS every drive on the
   *     site, then BFS each drive's root.
   *   - scope = { kind: 'folder', driveId, folderIds } → BFS each
   *     folder in `folderIds` (all under the same drive).
   *
   * `fileLimit` lets the import service fail fast on a too-large
   * site without walking the whole tree.
   */
  async listFiles(
    userId: string,
    scope:
      | { kind: 'site'; siteId: string }
      | { kind: 'folder'; driveId: string; folderIds: string[] },
    fileLimit?: number,
    onProgress?: (count: number) => void,
  ): Promise<SharePointFileMeta[]> {
    const out: SharePointFileMeta[] = [];
    const reportProgress = () => onProgress?.(out.length);

    if (scope.kind === 'site') {
      const drives = await this.listDrives(userId, scope.siteId);
      for (const drive of drives) {
        const collected = await this.walkDriveSubtree(
          userId,
          drive.id,
          ['root'],
          fileLimit !== undefined ? fileLimit - out.length : undefined,
          reportProgress,
        );
        out.push(...collected);
        if (fileLimit !== undefined && out.length > fileLimit) break;
      }
      return out;
    }

    return this.walkDriveSubtree(
      userId,
      scope.driveId,
      scope.folderIds,
      fileLimit,
      reportProgress,
    );
  }

  /**
   * BFS a list of starting folder ids inside a single drive. Either
   * pass `['root']` to walk the whole drive, or explicit folder ids
   * to walk specific subtrees. Returns every non-folder descendant.
   */
  private async walkDriveSubtree(
    userId: string,
    driveId: string,
    startFolderIds: string[],
    fileLimit: number | undefined,
    onProgress: () => void,
  ): Promise<SharePointFileMeta[]> {
    const out: SharePointFileMeta[] = [];
    const visited = new Set<string>();
    const queue = [...startFolderIds];

    outer: while (queue.length > 0) {
      const folderId = queue.shift()!;
      if (visited.has(folderId)) continue;
      visited.add(folderId);

      const anchor = folderId === 'root' ? 'root' : `items/${folderId}`;
      let next: string | undefined =
        `/drives/${driveId}/${anchor}/children?$select=id,name,size,file,folder,webUrl,lastModifiedDateTime,parentReference&$top=200`;
      let pages = 0;

      while (next && pages < MAX_PAGES) {
        const page = await this.graphGet<GraphPage<GraphDriveItem>>(
          userId,
          next,
        );
        for (const item of page.value) {
          if (item.folder) {
            queue.push(item.id);
            continue;
          }
          if (!item.file) continue; // skip "neither" (rare drive items)
          out.push({
            id: item.id,
            driveId,
            name: item.name ?? 'Untitled',
            mimeType: item.file.mimeType ?? 'application/octet-stream',
            modifiedTime: item.lastModifiedDateTime,
            webViewLink: item.webUrl,
            sizeBytes: typeof item.size === 'number' ? item.size : null,
          });
          onProgress();
        }
        if (fileLimit !== undefined && out.length > fileLimit) break outer;
        next = page['@odata.nextLink'];
        pages++;
      }
    }
    return out;
  }

  /**
   * Download the file's bytes. Re-fetches metadata for a fresh
   * `@microsoft.graph.downloadUrl` (those URLs are short-lived,
   * ~1 hour) — matches the Drive integration's "look up current
   * MIME at download time" guarantee.
   *
   * Unlike Drive, SharePoint stores Office files as binary .docx /
   * .xlsx already, so there is no native-export step here.
   */
  async downloadFile(
    userId: string,
    driveId: string,
    itemId: string,
  ): Promise<SharePointDownload> {
    const meta = await this.graphGet<GraphDriveItem>(
      userId,
      `/drives/${driveId}/items/${itemId}?$select=id,name,size,file,@microsoft.graph.downloadUrl`,
    );
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) {
      throw new Error('SharePoint did not return a download URL.');
    }
    const mimeType = meta.file?.mimeType ?? 'application/octet-stream';
    const filename = meta.name ?? 'untitled';

    // The downloadUrl is pre-authenticated — no Authorization header,
    // and it's a different host (sharepoint.com / live.com CDN).
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(
        `SharePoint download failed: ${res.status} ${res.statusText}`,
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
   * Full-site scan used by the import-dialog warning banner.
   * Walks every drive on the site, applies the same size filter as
   * the actual import (50 MB ceiling), and returns a list of
   * matching filenames.
   *
   * Cap matches MAX_PAGES per drive — same safety guarantee as
   * Drive's estimateFileCount.
   */
  async estimateFileCountForSite(
    userId: string,
    siteId: string,
  ): Promise<{ fileNames: string[]; hasMore: boolean }> {
    const fileNames: string[] = [];
    let hasMore = false;
    const drives = await this.listDrives(userId, siteId);
    for (const drive of drives) {
      const visited = new Set<string>();
      const queue: string[] = ['root'];
      let pages = 0;
      while (queue.length > 0 && pages < MAX_PAGES) {
        const folderId = queue.shift()!;
        if (visited.has(folderId)) continue;
        visited.add(folderId);

        const anchor = folderId === 'root' ? 'root' : `items/${folderId}`;
        let next: string | undefined =
          `/drives/${drive.id}/${anchor}/children?$select=id,name,size,file,folder&$top=200`;
        while (next && pages < MAX_PAGES) {
          const page = await this.graphGet<GraphPage<GraphDriveItem>>(
            userId,
            next,
          );
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
      // If any drive on the site had more pages than MAX_PAGES we
      // can't claim an exact count.
      if (queue.length > 0) hasMore = true;
    }
    return { fileNames, hasMore };
  }

  /**
   * Resolve a SharePoint folder's display name. Falls back to a
   * synthetic slug on error, mirroring Drive's getFolderName.
   */
  async getFolderName(
    userId: string,
    driveId: string,
    itemId: string,
  ): Promise<string> {
    try {
      const meta = await this.graphGet<GraphDriveItem>(
        userId,
        `/drives/${driveId}/items/${itemId}?$select=name`,
      );
      return meta.name ?? `Folder (${itemId.slice(0, 8)}…)`;
    } catch {
      return `Folder (${itemId.slice(0, 8)}…)`;
    }
  }

  /** Resolve a SharePoint site's display name. */
  async getSiteName(userId: string, siteId: string): Promise<string> {
    try {
      const meta = await this.graphGet<GraphSite>(
        userId,
        `/sites/${siteId}?$select=displayName,name`,
      );
      return meta.displayName ?? meta.name ?? `Site (${siteId.slice(0, 8)}…)`;
    } catch {
      return `Site (${siteId.slice(0, 8)}…)`;
    }
  }

  /** Resolve a SharePoint drive's display name. */
  async getDriveName(
    userId: string,
    siteId: string,
    driveId: string,
  ): Promise<string> {
    try {
      const drives = await this.listDrives(userId, siteId);
      const match = drives.find((d) => d.id === driveId);
      return match?.name ?? 'Documents';
    } catch {
      return 'Documents';
    }
  }
}
