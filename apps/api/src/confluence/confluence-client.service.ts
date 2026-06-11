import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';

import {
  ConfluenceOAuthService,
  ReauthRequiredError,
} from './confluence-oauth.service.js';

/**
 * A Confluence space as the browse / import path sees it.
 *
 * NOTE: `id` carries the space KEY (e.g. "ENG" or "~712020…"), not the
 * numeric id. The v1 REST API addresses a space's content by key, so the key
 * is the stable handle we thread through the import path and persist as the
 * source's spaceId.
 */
export interface ConfluenceSpace {
  /** Space key — used everywhere as the space handle. */
  id: string;
  /** Same value as `id`; kept for display/clarity. */
  key: string;
  name: string;
}

/**
 * One Confluence page. `parentId` is the id of the page it nests under
 * (null for a top-level page in the space), which lets the import path
 * rebuild the page tree as a KC folder hierarchy. `hasChildren` is a cheap
 * signal for the FE picker's expand caret, computed from the full set.
 */
export interface ConfluencePageMeta {
  id: string;
  title: string;
  parentId: string | null;
  hasChildren: boolean;
  /** Absolute "Open in Confluence" link. Persisted as `external_url`. */
  webUrl: string | null;
}

/** Result of `downloadPage`: the page rendered to Markdown bytes. */
export interface ConfluenceDownload {
  buffer: Buffer;
  /** Final filename including the synthetic `.md` extension. */
  filename: string;
  /** Raw page title (no extension) — handy for callers that want it. */
  title: string;
}

/** Resolved per-user request context (token + which Atlassian site). */
interface ConfluenceContext {
  accessToken: string;
  /** Atlassian cloud id for the connected site. */
  cloudId: string;
  /** REST gateway base, e.g. https://api.atlassian.com/ex/confluence/{cloudId}. */
  apiBase: string;
  /** Site base, e.g. https://your-domain.atlassian.net — used for web links. */
  siteUrl: string;
}

const ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources';

/**
 * Page size for v1 offset-paginated list calls. Confluence Cloud v1 caps the
 * effective limit (commonly at 100/200 depending on the endpoint); the
 * paginator below terminates on the limit the API actually echoes back, so
 * this is just the requested value.
 */
const V1_PAGE_LIMIT = 100;

/**
 * Safety cap on how many pages we'll page through for a single space. A
 * space with more pages than this is rare; the import path treats the cap
 * as a hard ceiling (mirrors the Drive file cap behaviour).
 */
const MAX_PAGES_PER_SPACE = 10_000;

/** TTL for the in-memory cloudId / siteUrl cache (cloud ids are stable). */
const CLOUD_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

/**
 * How many times to retry a 429 (rate-limited) response, respecting the
 * `Retry-After` header each time. A whole-space import issues one request
 * per page, so Atlassian's rate limiter is a realistic hit on large spaces —
 * a few bounded retries let the import ride through a throttle window instead
 * of failing the whole scan.
 */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Clamp for the Retry-After wait (seconds) so a hostile header can't hang us. */
const MAX_RETRY_AFTER_SECONDS = 30;

/**
 * Confluence Cloud client. Uses the **v1 REST API** (`/wiki/rest/api/...`),
 * which is compatible with the *classic* OAuth scopes
 * (`read:confluence-content.all`, `read:confluence-space.summary`). The v2
 * API (`/wiki/api/v2/...`) requires *granular* scopes and 401s with
 * "scope does not match" under classic scopes — hence v1 here.
 */
@Injectable()
export class ConfluenceClientService {
  private readonly logger = new Logger(ConfluenceClientService.name);

  /**
   * Per-user cache of the resolved Atlassian site. Avoids hitting
   * accessible-resources on every request. Invalidated on connect /
   * disconnect via `clearSiteCache`.
   */
  private readonly siteCache = new Map<
    string,
    { cloudId: string; siteUrl: string; fetchedAt: number }
  >();

  constructor(private readonly oauth: ConfluenceOAuthService) {}

  /** Drop the cached site for a user (call on connect / disconnect). */
  clearSiteCache(userId: string): void {
    this.siteCache.delete(userId);
  }

  /**
   * Resolve the request context for `userId`: a fresh access token plus the
   * Atlassian site (cloudId + base URL) the token can reach. When the user
   * has access to multiple sites we pick the first — a future enhancement
   * could let them choose, but a single-site grant is by far the common case.
   */
  private async getContext(userId: string): Promise<ConfluenceContext> {
    const accessToken = await this.oauth.getValidAccessToken(userId);

    const cached = this.siteCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < CLOUD_CACHE_TTL_MS) {
      return {
        accessToken,
        cloudId: cached.cloudId,
        apiBase: `https://api.atlassian.com/ex/confluence/${cached.cloudId}`,
        siteUrl: cached.siteUrl,
      };
    }

    const res = await fetch(ACCESSIBLE_RESOURCES_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(
        `Failed to resolve the Atlassian site (accessible-resources ${res.status}).`,
      );
    }
    const resources = (await res.json()) as Array<{
      id: string;
      url: string;
      scopes?: string[];
    }>;
    if (!Array.isArray(resources) || resources.length === 0) {
      throw new ReauthRequiredError(
        'No Atlassian site is accessible with this connection. Reconnect and grant access to your Confluence site.',
      );
    }
    // Prefer a resource that actually exposes Confluence scopes; fall back to
    // the first one if the scopes array is absent.
    const chosen =
      resources.find((r) =>
        (r.scopes ?? []).some((s) => s.includes('confluence')),
      ) ?? resources[0];

    this.siteCache.set(userId, {
      cloudId: chosen.id,
      siteUrl: chosen.url,
      fetchedAt: Date.now(),
    });
    return {
      accessToken,
      cloudId: chosen.id,
      apiBase: `https://api.atlassian.com/ex/confluence/${chosen.id}`,
      siteUrl: chosen.url,
    };
  }

  /**
   * GET a REST endpoint (path relative to the gateway, e.g.
   * `/wiki/rest/api/space`).
   *
   * 401 → one automatic retry: Atlassian occasionally 401s a token that
   * *just* expired in flight; calling getContext again returns a freshly
   * refreshed token. A persistent 401 (revoked grant / wrong scope) surfaces
   * as the API error below.
   *
   * 429 → up to MAX_RATE_LIMIT_RETRIES retries honoring `Retry-After`, so a
   * large import rides through a throttle window instead of failing the scan.
   */
  private async apiGet<T>(userId: string, path: string): Promise<T> {
    // `path` is normally gateway-relative (e.g. `/wiki/rest/api/space`), but a
    // pagination link can come back as an absolute URL — pass those through.
    // A relative value missing its leading slash is defensively normalized.
    const toUrl = (apiBase: string): string => {
      if (/^https?:\/\//i.test(path)) return path;
      return `${apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
    };
    const attempt = async (ctx: ConfluenceContext): Promise<Response> =>
      fetch(toUrl(ctx.apiBase), {
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          Accept: 'application/json',
        },
      });

    let ctx = await this.getContext(userId);
    let res = await attempt(ctx);

    if (res.status === 401) {
      // Force a token refresh on the next getContext call.
      ctx = await this.getContext(userId);
      res = await attempt(ctx);
    }

    for (let i = 0; res.status === 429 && i < MAX_RATE_LIMIT_RETRIES; i++) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '2');
      const waitSeconds = Number.isFinite(retryAfter)
        ? Math.min(Math.max(retryAfter, 1), MAX_RETRY_AFTER_SECONDS)
        : 2;
      this.logger.warn(
        `Confluence rate-limited on ${path}; retrying in ${waitSeconds}s (attempt ${i + 1}/${MAX_RATE_LIMIT_RETRIES}).`,
      );
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      res = await attempt(ctx);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const message = `Confluence API ${res.status} on ${path}. ${detail.slice(0, 300)}`;
      this.logger.error(message);
      // Surface the upstream status + detail to the FE instead of letting it
      // collapse into a generic 500 (which the import dialog can't tell apart
      // from an empty result). 401/403 stay as-is so the FE can prompt a
      // reconnect; everything else is reported as a 502 (upstream failure).
      const status =
        res.status === HttpStatus.UNAUTHORIZED ||
        res.status === HttpStatus.FORBIDDEN
          ? res.status
          : HttpStatus.BAD_GATEWAY;
      throw new HttpException(message, status);
    }
    return (await res.json()) as T;
  }

  /**
   * Follow v1 offset pagination (`start` / `limit`), accumulating `results`
   * until a short page or the cap is hit. Terminates on the `limit` the API
   * actually echoes back (it can cap our requested value), so we never stop a
   * page early by mistaking a capped page for the last one.
   */
  private async v1GetAll<T>(
    userId: string,
    basePath: string,
    cap = MAX_PAGES_PER_SPACE,
  ): Promise<T[]> {
    const out: T[] = [];
    let start = 0;
    const sep = basePath.includes('?') ? '&' : '?';
    // Hard stop on iterations as a backstop against a misbehaving endpoint.
    const maxIterations = Math.ceil(cap / V1_PAGE_LIMIT) + 5;
    for (let i = 0; i < maxIterations && out.length < cap; i++) {
      const body = await this.apiGet<{
        results?: T[];
        limit?: number;
        size?: number;
      }>(userId, `${basePath}${sep}start=${start}&limit=${V1_PAGE_LIMIT}`);
      const batch = body.results ?? [];
      out.push(...batch);
      const effectiveLimit = body.limit ?? V1_PAGE_LIMIT;
      if (batch.length < effectiveLimit) break; // last page
      start += effectiveLimit;
    }
    return out;
  }

  /**
   * List the spaces the connected account can read (current spaces, including
   * personal spaces — users keep notes there). Ordered by name. `id` carries
   * the space KEY, which the v1 content endpoints address spaces by.
   */
  async listSpaces(userId: string): Promise<ConfluenceSpace[]> {
    const raw = await this.v1GetAll<{
      id?: number | string;
      key: string;
      name: string;
      type?: string;
      status?: string;
    }>(userId, `/wiki/rest/api/space?status=current`, 2000);
    return raw
      .filter((s) => !!s.key)
      .map((s) => ({ id: s.key, key: s.key, name: s.name || s.key || 'Space' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Resolve a single space's key + name. Used by the import path to label the
   * source row and name the KC child folder. Falls back to a synthetic name
   * on error so a missing display string never breaks an import.
   */
  async getSpace(userId: string, spaceKey: string): Promise<ConfluenceSpace> {
    try {
      const s = await this.apiGet<{ key: string; name: string }>(
        userId,
        `/wiki/rest/api/space/${encodeURIComponent(spaceKey)}`,
      );
      return { id: s.key, key: s.key, name: s.name || s.key || 'Space' };
    } catch {
      return { id: spaceKey, key: spaceKey, name: `Space (${spaceKey})` };
    }
  }

  /**
   * List every current page in a space with enough parent links to rebuild
   * the tree. `parentId` comes from the page's `ancestors` (immediate parent
   * is the last ancestor); `hasChildren` is derived from the full set so the
   * FE picker can render expand carets without per-node round-trips.
   *
   * `cap` bounds how many pages we page through. The import path passes
   * `MAX_SPACE_IMPORT_FILES + 1` so callers can detect an over-cap space and
   * fail loudly rather than silently truncating.
   */
  async listAllPages(
    userId: string,
    spaceKey: string,
    cap: number = MAX_PAGES_PER_SPACE,
  ): Promise<ConfluencePageMeta[]> {
    const { siteUrl } = await this.getContext(userId);
    const raw = await this.v1GetAll<{
      id: string;
      title: string;
      ancestors?: { id: string }[];
      _links?: { webui?: string };
    }>(
      userId,
      `/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&status=current&expand=ancestors`,
      cap,
    );

    const metas = raw.map((p) => ({
      id: p.id,
      title: p.title || 'Untitled',
      // ancestors are ordered root → immediate parent; the last one is the
      // direct parent. Empty for top-level pages.
      parentId:
        p.ancestors && p.ancestors.length > 0
          ? p.ancestors[p.ancestors.length - 1].id
          : null,
      hasChildren: false,
      webUrl: p._links?.webui ? `${siteUrl}/wiki${p._links.webui}` : null,
    }));

    const parents = new Set<string>();
    for (const m of metas) if (m.parentId) parents.add(m.parentId);
    for (const m of metas) m.hasChildren = parents.has(m.id);
    return metas;
  }

  /**
   * Collect a page and all of its descendant pages by walking the
   * `/content/{id}/child/page` endpoint, independent of the full space list.
   *
   * Used by the "specific pages" import so a picked page resolves its whole
   * subtree even in spaces larger than the space-list cap. The root's
   * `parentId` is forced to null — within this subtree it is the top, so its
   * document lands in the space folder while its descendants nest beneath it.
   *
   * `cap` bounds the BFS (the import path passes `MAX_PAGE_IMPORT_FILES + 1`
   * so an over-cap subtree is detected and rejected loudly).
   */
  async listPageSubtree(
    userId: string,
    rootPageId: string,
    cap = 1000,
  ): Promise<ConfluencePageMeta[]> {
    const { siteUrl } = await this.getContext(userId);
    const fallbackUrl = (id: string) =>
      `${siteUrl}/wiki/pages/viewpage.action?pageId=${id}`;
    const linkFor = (webui?: string, id?: string) =>
      webui ? `${siteUrl}/wiki${webui}` : id ? fallbackUrl(id) : null;

    let root: { id: string; title?: string; _links?: { webui?: string } };
    try {
      root = await this.apiGet(
        userId,
        `/wiki/rest/api/content/${encodeURIComponent(rootPageId)}`,
      );
    } catch {
      // Picked page is gone / not accessible — skip it.
      return [];
    }

    const titleById = new Map<string, string>([
      [rootPageId, root.title || 'Untitled'],
    ]);
    const webuiById = new Map<string, string | undefined>([
      [rootPageId, root._links?.webui],
    ]);
    const parentById = new Map<string, string | null>([[rootPageId, null]]);

    const out: ConfluencePageMeta[] = [];
    const visited = new Set<string>();
    const queue: string[] = [rootPageId];

    while (queue.length > 0 && out.length < cap) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      out.push({
        id,
        title: titleById.get(id) ?? 'Untitled',
        parentId: parentById.get(id) ?? null,
        hasChildren: false, // filled in below
        webUrl: linkFor(webuiById.get(id), id),
      });

      const children = await this.v1GetAll<{
        id: string;
        title?: string;
        _links?: { webui?: string };
      }>(
        userId,
        `/wiki/rest/api/content/${encodeURIComponent(id)}/child/page`,
        cap,
      );
      for (const c of children) {
        if (!c.id || visited.has(c.id)) continue;
        titleById.set(c.id, c.title || 'Untitled');
        webuiById.set(c.id, c._links?.webui);
        parentById.set(c.id, id);
        queue.push(c.id);
      }
    }

    const parents = new Set<string>();
    for (const p of out) if (p.parentId) parents.add(p.parentId);
    for (const p of out) p.hasChildren = parents.has(p.id);
    return out;
  }

  /**
   * Download a page's body rendered to Markdown. Uses the `export_view`
   * representation (fully rendered HTML, macros expanded) and converts it to
   * Markdown so KC's existing `.md` parser can chunk + embed it. The basename
   * is the page title with a synthetic `.md` extension.
   */
  async downloadPage(
    userId: string,
    pageId: string,
  ): Promise<ConfluenceDownload> {
    const page = await this.apiGet<{
      title?: string;
      body?: { export_view?: { value?: string } };
    }>(
      userId,
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}?expand=body.export_view`,
    );
    const title = page.title || 'Untitled';
    const html = page.body?.export_view?.value ?? '';
    const markdown = htmlToMarkdown(html);
    // Prepend the title as an H1 so the chunked text carries the page name
    // even when the body itself doesn't repeat it.
    const doc = `# ${title}\n\n${markdown}`.trim() + '\n';
    return {
      buffer: Buffer.from(doc, 'utf-8'),
      filename: `${sanitizeName(title)}.md`,
      title,
    };
  }
}

/** Strip filesystem-hostile characters from a page title for the basename. */
function sanitizeName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'Untitled'
  );
}

/** Minimal HTML entity table covering what Confluence export HTML emits. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === '#') {
      const num =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : m;
    }
    return ENTITIES[code] ?? m;
  });
}

/**
 * Dependency-free HTML → Markdown converter tuned for Confluence
 * `export_view` output. It is deliberately not a full HTML parser — the goal
 * is searchable, reasonably-structured text for RAG, not byte-perfect
 * Markdown. Headings, paragraphs, lists, links, code, blockquotes, tables
 * and line breaks survive; everything else is flattened to its text.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let s = html;

  // Drop content that never carries useful text.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  // Headings.
  for (let level = 1; level <= 6; level++) {
    const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    s = s.replace(re, (_m, inner: string) => {
      const text = stripTags(inner).trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '\n\n';
    });
  }

  // Tables → pipe rows. Done before generic block handling so the cell
  // boundaries survive.
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row: string) => {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (c) => stripTags(c[1]).replace(/\s+/g, ' ').trim(),
    );
    return cells.length ? `\n| ${cells.join(' | ')} |` : '\n';
  });
  s = s.replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, '\n');

  // List items. Ordered-vs-unordered numbering isn't tracked (the picker
  // doesn't need it); a leading "- " keeps the structure readable.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    const text = stripTags(inner).replace(/\s+/g, ' ').trim();
    return text ? `\n- ${text}` : '';
  });
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  // Blockquotes.
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const text = stripTags(inner).trim();
    return text
      ? '\n\n' +
          text
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n') +
          '\n\n'
      : '\n\n';
  });

  // Pre / code blocks.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const text = decodeEntities(stripTags(inner)).replace(/\n+$/, '');
    return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
  });
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
    const text = stripTags(inner).trim();
    return text ? `\`${text}\`` : '';
  });

  // Links → [text](href).
  s = s.replace(
    /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const text = stripTags(inner).replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return href ? `[${text}](${href})` : text;
    },
  );

  // Inline emphasis.
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => {
    const text = stripTags(inner).trim();
    return text ? `**${text}**` : '';
  });
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => {
    const text = stripTags(inner).trim();
    return text ? `*${text}*` : '';
  });

  // Block separators.
  s = s.replace(/<(br)\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<\/div>/gi, '\n');
  s = s.replace(/<hr[^>]*\/?>/gi, '\n\n---\n\n');

  // Anything left over: drop the tag, keep the text.
  s = stripTags(s);
  s = decodeEntities(s);

  // Collapse runaway blank lines + trailing spaces.
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
