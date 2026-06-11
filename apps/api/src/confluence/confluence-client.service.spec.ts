import {
  ConfluenceClientService,
  htmlToMarkdown,
} from './confluence-client.service.js';
import type { ConfluenceOAuthService } from './confluence-oauth.service.js';

/**
 * These tests exercise the bits of the Confluence client that don't need a
 * live Atlassian site: the v2 cursor-pagination loop (including how it
 * normalizes a `_links.next` that comes back either gateway-relative OR as an
 * absolute URL — the case flagged in PR #207 review), and the dependency-free
 * HTML→Markdown converter that every imported page goes through.
 */

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { get: (k: string) => string | null };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

const CLOUD_ID = 'cloud-1';
const SITE_URL = 'https://example.atlassian.net';
const API_BASE = `https://api.atlassian.com/ex/confluence/${CLOUD_ID}`;

function makeService(): {
  service: ConfluenceClientService;
  fetchMock: jest.Mock;
  urls: string[];
} {
  const oauth = {
    getValidAccessToken: jest.fn().mockResolvedValue('access-token'),
  } as unknown as ConfluenceOAuthService;
  const service = new ConfluenceClientService(oauth);
  const urls: string[] = [];
  const fetchMock = jest.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  return { service, fetchMock, urls };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ConfluenceClientService pagination', () => {
  it('follows a gateway-relative _links.next across pages and filters personal spaces', async () => {
    const { service, fetchMock, urls } = makeService();
    fetchMock.mockImplementation((url: string) => {
      urls.push(url);
      if (url.includes('accessible-resources')) {
        return Promise.resolve(
          jsonResponse([
            { id: CLOUD_ID, url: SITE_URL, scopes: ['read:confluence-content.all'] },
          ]),
        );
      }
      if (url.includes('/wiki/api/v2/spaces') && !url.includes('cursor=')) {
        return Promise.resolve(
          jsonResponse({
            results: [
              { id: '1', key: 'ENG', name: 'Engineering', type: 'global' },
              { id: '2', key: '~user', name: 'Personal', type: 'personal' },
            ],
            // Gateway-relative next (the documented shape).
            _links: { next: '/wiki/api/v2/spaces?cursor=C2&limit=250' },
          }),
        );
      }
      if (url.includes('cursor=C2')) {
        return Promise.resolve(
          jsonResponse({
            results: [{ id: '3', key: 'OPS', name: 'Operations', type: 'global' }],
            _links: {},
          }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const spaces = await service.listSpaces('user-1');

    // Personal space dropped; both pages accumulated.
    expect(spaces.map((s) => s.key)).toEqual(['ENG', 'OPS']);
    // The relative next was resolved against the gateway base.
    expect(urls).toContain(`${API_BASE}/wiki/api/v2/spaces?cursor=C2&limit=250`);
  });

  it('follows an absolute _links.next URL untouched', async () => {
    const { service, fetchMock, urls } = makeService();
    const absoluteNext = `${API_BASE}/wiki/api/v2/spaces/9/pages?cursor=ABS`;
    fetchMock.mockImplementation((url: string) => {
      urls.push(url);
      if (url.includes('accessible-resources')) {
        return Promise.resolve(
          jsonResponse([{ id: CLOUD_ID, url: SITE_URL, scopes: ['read:confluence-content.all'] }]),
        );
      }
      if (url.includes('/spaces/9/pages') && !url.includes('cursor=')) {
        return Promise.resolve(
          jsonResponse({
            results: [{ id: 'p1', title: 'Root', status: 'current' }],
            _links: { next: absoluteNext }, // absolute URL form
          }),
        );
      }
      if (url === absoluteNext) {
        return Promise.resolve(
          jsonResponse({
            results: [
              { id: 'p2', title: 'Child', parentId: 'p1', status: 'current' },
            ],
            _links: {},
          }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const pages = await service.listAllPages('user-1', '9');

    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    // p1 is the parent of p2 → hasChildren; p2 carries its parentId.
    expect(pages.find((p) => p.id === 'p1')?.hasChildren).toBe(true);
    expect(pages.find((p) => p.id === 'p2')?.parentId).toBe('p1');
    // The absolute next URL was used verbatim (not concatenated onto apiBase).
    expect(urls).toContain(absoluteNext);
    expect(urls).not.toContain(`${API_BASE}${absoluteNext}`);
  });

  it('retries a 429 honoring Retry-After then succeeds', async () => {
    const { service, fetchMock } = makeService();
    let spacesCalls = 0;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('accessible-resources')) {
        return Promise.resolve(
          jsonResponse([{ id: CLOUD_ID, url: SITE_URL, scopes: ['read:confluence-content.all'] }]),
        );
      }
      if (url.includes('/wiki/api/v2/spaces')) {
        spacesCalls++;
        if (spacesCalls === 1) {
          return Promise.resolve(jsonResponse({}, 429, { 'retry-after': '1' }));
        }
        return Promise.resolve(
          jsonResponse({ results: [{ id: '1', key: 'ENG', name: 'Eng', type: 'global' }], _links: {} }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const spaces = await service.listSpaces('user-1');
    expect(spaces).toHaveLength(1);
    expect(spacesCalls).toBe(2); // one 429, one success
  });
});

describe('htmlToMarkdown', () => {
  it('converts headings, emphasis, and entities', () => {
    const md = htmlToMarkdown(
      '<h1>Title</h1><p>Hello <strong>world</strong> &amp; co.</p>',
    );
    expect(md).toContain('# Title');
    expect(md).toContain('Hello **world** & co.');
  });

  it('converts lists, links, and tables', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toContain('- a');
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>')).toContain('- b');
    expect(htmlToMarkdown('<a href="https://x.test">y</a>')).toContain(
      '[y](https://x.test)',
    );
    expect(
      htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr></table>'),
    ).toContain('| a | b |');
  });

  it('strips scripts/styles and returns empty for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(
      htmlToMarkdown('<style>.x{}</style><script>evil()</script><p>ok</p>'),
    ).toBe('ok');
  });
});
