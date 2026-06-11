import {
  ConfluenceClientService,
  htmlToMarkdown,
} from './confluence-client.service.js';
import type { ConfluenceOAuthService } from './confluence-oauth.service.js';

/**
 * Exercises the bits of the Confluence client that don't need a live site:
 * v1 offset pagination (start/limit, terminating on the echoed limit), the
 * space/page mapping, the 429 Retry-After retry, and the HTML→Markdown
 * converter every imported page goes through. The client uses the v1 REST API
 * because the v2 API requires granular OAuth scopes (it 401s "scope does not
 * match" under the classic scopes this integration requests).
 */

const CLOUD_ID = 'cloud-1';
const SITE_URL = 'https://example.atlassian.net';
const API_BASE = `https://api.atlassian.com/ex/confluence/${CLOUD_ID}`;

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

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

function resourcesResponse() {
  return jsonResponse([
    { id: CLOUD_ID, url: SITE_URL, scopes: ['read:confluence-content.all'] },
  ]);
}

afterEach(() => jest.restoreAllMocks());

describe('ConfluenceClientService v1 pagination', () => {
  it('pages spaces with start/limit and includes personal spaces', async () => {
    const { service, fetchMock, urls } = makeService();
    fetchMock.mockImplementation((url: string) => {
      urls.push(url);
      if (url.includes('accessible-resources')) return resourcesResponse();
      if (url.includes('/wiki/rest/api/space')) {
        // The mock echoes limit:2 so the paginator advances; page 1 is full
        // (2 == limit) so it fetches a second page, which is short → stop.
        if (url.includes('start=0')) {
          return Promise.resolve(
            jsonResponse({
              results: [
                { id: 1, key: 'ENG', name: 'Engineering', type: 'global' },
                { id: 2, key: '~user', name: 'Personal', type: 'personal' },
              ],
              limit: 2,
              size: 2,
            }),
          );
        }
        if (url.includes('start=2')) {
          return Promise.resolve(
            jsonResponse({
              results: [{ id: 3, key: 'OPS', name: 'Operations', type: 'global' }],
              limit: 2,
              size: 1,
            }),
          );
        }
      }
      throw new Error(`unexpected url ${url}`);
    });

    const spaces = await service.listSpaces('user-1');

    // Two pages accumulated, personal INCLUDED, sorted by name, id == key.
    expect(spaces.map((s) => s.key)).toEqual(['ENG', 'OPS', '~user']);
    expect(spaces.map((s) => s.id)).toEqual(['ENG', 'OPS', '~user']);
    expect(urls.some((u) => u.includes('start=2'))).toBe(true);
  });

  it('builds the page tree from ancestors', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('accessible-resources')) return resourcesResponse();
      if (url.includes('/wiki/rest/api/content') && url.includes('spaceKey=ENG')) {
        return Promise.resolve(
          jsonResponse({
            results: [
              { id: 'p1', title: 'Root', ancestors: [] },
              { id: 'p2', title: 'Child', ancestors: [{ id: 'p1' }] },
            ],
            limit: 100,
            size: 2,
          }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const pages = await service.listAllPages('user-1', 'ENG');

    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(pages.find((p) => p.id === 'p1')?.parentId).toBeNull();
    expect(pages.find((p) => p.id === 'p1')?.hasChildren).toBe(true);
    expect(pages.find((p) => p.id === 'p2')?.parentId).toBe('p1');
    expect(pages.find((p) => p.id === 'p2')?.hasChildren).toBe(false);
  });

  it('retries a 429 honoring Retry-After then succeeds', async () => {
    const { service, fetchMock } = makeService();
    let spaceCalls = 0;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('accessible-resources')) return resourcesResponse();
      if (url.includes('/wiki/rest/api/space')) {
        spaceCalls++;
        if (spaceCalls === 1) {
          return Promise.resolve(jsonResponse({}, 429, { 'retry-after': '1' }));
        }
        return Promise.resolve(
          jsonResponse({
            results: [{ id: 1, key: 'ENG', name: 'Eng', type: 'global' }],
            limit: 100,
            size: 1,
          }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    const spaces = await service.listSpaces('user-1');
    expect(spaces).toHaveLength(1);
    expect(spaceCalls).toBe(2); // one 429, one success
  });

  it('surfaces an upstream error (e.g. 401 scope mismatch) as an exception', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('accessible-resources')) return resourcesResponse();
      return Promise.resolve(
        jsonResponse({ message: 'Unauthorized; scope does not match' }, 401),
      );
    });

    await expect(service.listSpaces('user-1')).rejects.toThrow(
      /Confluence API 401/,
    );
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
