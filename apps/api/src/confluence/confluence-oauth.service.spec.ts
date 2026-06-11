import { ConfluenceOAuthService } from './confluence-oauth.service.js';

/**
 * Verifies the single-flight guard on token refresh: Atlassian rotates and
 * immediately invalidates the refresh_token on every refresh, so two
 * overlapping `getValidAccessToken` calls must NOT both hit the token
 * endpoint (the second would present a dead token and brick the connection).
 * See PR #207 review item on the rotating-refresh-token race.
 */

const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

function makeService(opts: { expired: boolean; hasRefresh?: boolean }) {
  const row = {
    id: 'conn-1',
    ownerId: 'user-1',
    provider: 'confluence',
    accessTokenEncrypted: 'enc:old-access',
    refreshTokenEncrypted:
      opts.hasRefresh === false ? null : 'enc:old-refresh',
    expiresAt: new Date(
      opts.expired ? Date.now() - 60_000 : Date.now() + 60 * 60_000,
    ),
    status: 'active' as const,
  };

  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve([row]) }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  };

  const encryption = {
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => s.replace(/^enc:/, ''),
  };
  const config = {
    getOrThrow: (k: string) =>
      k === 'CONFLUENCE_CLIENT_ID'
        ? 'client-id'
        : k === 'CONFLUENCE_CLIENT_SECRET'
          ? 'client-secret'
          : 'x',
    get: (_k: string, d: string) => d,
  };
  const jwt = {};

  const service = new ConfluenceOAuthService(
    db as never,
    config as never,
    encryption as never,
    jwt as never,
  );
  return { service, row, updates };
}

afterEach(() => jest.restoreAllMocks());

describe('ConfluenceOAuthService.getValidAccessToken single-flight', () => {
  it('coalesces concurrent calls into one refresh', async () => {
    const { service, updates } = makeService({ expired: true });

    const fetchMock = jest.fn().mockImplementation((url: string) => {
      if (url === TOKEN_URL) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 3600,
            }),
          text: () => Promise.resolve(''),
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const [a, b, c] = await Promise.all([
      service.getValidAccessToken('user-1'),
      service.getValidAccessToken('user-1'),
      service.getValidAccessToken('user-1'),
    ]);

    expect(a).toBe('new-access');
    expect(b).toBe('new-access');
    expect(c).toBe('new-access');
    // Exactly one token-endpoint round-trip despite three concurrent callers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And exactly one DB write of the rotated token.
    expect(updates).toHaveLength(1);
    expect(updates[0].refreshTokenEncrypted).toBe('enc:new-refresh');
  });

  it('does not refresh when the token is still fresh', async () => {
    const { service } = makeService({ expired: false });
    const fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const token = await service.getValidAccessToken('user-1');

    expect(token).toBe('old-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the in-flight entry so a later call refreshes again', async () => {
    const { service } = makeService({ expired: true });
    let calls = 0;
    const fetchMock = jest.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: `access-${calls}`,
            refresh_token: `refresh-${calls}`,
            expires_in: 3600,
          }),
        text: () => Promise.resolve(''),
      });
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await service.getValidAccessToken('user-1');
    // The stub row stays expired (update is a no-op), so a second sequential
    // call starts a fresh refresh — proving the in-flight entry was cleared.
    await service.getValidAccessToken('user-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
