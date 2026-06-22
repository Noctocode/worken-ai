import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '../database/database.module.js';
import type { EncryptionService } from '../openrouter/encryption.service.js';
import { IntegrationsService } from './integrations.service.js';

/* Minimal chainable drizzle mock: each select() shifts the next row set off
 * the queue and resolves the chain to it. */
function makeChainableDb(rowSets: unknown[][]) {
  const queue = [...rowSets];
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> & PromiseLike<unknown[]> = {
      then: (onFulfilled?: (value: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onFulfilled),
    } as unknown as Record<string, unknown> & PromiseLike<unknown[]>;
    for (const m of ['from', 'where', 'limit', 'innerJoin']) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    return chain;
  };
  return {
    select: jest.fn().mockImplementation(() => makeChain(queue.shift() ?? [])),
  };
}

function makeService(rowSets: unknown[][]) {
  const db = makeChainableDb(rowSets);
  return new IntegrationsService(
    db as unknown as Database,
    {} as unknown as EncryptionService,
  );
}

/* The admin gate (assertCanManageKeys) runs first in upsert/update/remove.
 * A company key is shared company-wide, so only a company admin may mutate
 * it; personal-profile (no company) users always manage their own keys. */
describe('IntegrationsService — company key admin gate', () => {
  it('blocks a non-admin company member from deleting a key', async () => {
    const svc = makeService([
      [{ role: 'basic', companyId: 'c1' }], // assertCanManageKeys: the caller
    ]);
    await expect(svc.remove('member-id', 'int-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a company admin past the gate (then hits normal not-found)', async () => {
    const svc = makeService([
      [{ role: 'admin', companyId: 'c1' }], // gate: admin → allowed
      [], // integration lookup → none → NotFound (proves the gate passed)
    ]);
    await expect(svc.remove('admin-id', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a personal-profile user (no company) manage their own key', async () => {
    const svc = makeService([
      [{ role: 'basic', companyId: null }], // gate: no company → allowed
      [], // integration lookup → none → NotFound (proves the gate passed)
    ]);
    await expect(svc.remove('solo-id', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
