import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Database } from '../database/database.module.js';
import type { EncryptionService } from '../openrouter/encryption.service.js';
import type { ModelsService } from '../models/models.service.js';
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
    {
      syncProviderCatalogAliases: jest.fn().mockResolvedValue(undefined),
    } as unknown as ModelsService,
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

/* Custom LLM enable/disable mirrors the model in/out of the Models tab,
 * just like predefined providers: disable DELETES the bound alias (so it
 * disappears from the table) after snapshotting the binding into config;
 * enable RECREATES it from the snapshot, or reactivates an existing row.
 *
 * `update()` ends with listForUser(); these tests run the caller as the
 * key's own owner (so the mutate guard short-circuits with no query) and
 * assert the mirror's DB side-effects — which all happen BEFORE that final
 * lookup — then swallow the listForUser outcome. */
function makeRichDb(selectQueue: unknown[][]) {
  const queue = [...selectQueue];
  const thenable = (rows: unknown[]) => {
    const chain: Record<string, unknown> & PromiseLike<unknown[]> = {
      then: (onFulfilled?: (v: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onFulfilled),
    } as never;
    for (const m of [
      'from',
      'where',
      'limit',
      'innerJoin',
      'leftJoin',
      'orderBy',
      'groupBy',
    ]) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    return chain;
  };
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const db = {
    select: jest.fn(() => thenable(queue.shift() ?? [])),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: updateWhere })) })),
    insert: jest.fn(() => ({ values: insertValues })),
    delete: jest.fn(() => ({ where: deleteWhere })),
  };
  return { db, updateWhere, insertValues, deleteWhere };
}

function makeMirrorService(selectQueue: unknown[][]) {
  const { db, insertValues, deleteWhere } = makeRichDb(selectQueue);
  const svc = new IntegrationsService(
    db as unknown as Database,
    {} as unknown as EncryptionService,
    { syncProviderCatalogAliases: jest.fn() } as unknown as ModelsService,
  );
  return { svc, insertValues, deleteWhere };
}

const CUSTOM_ROW = {
  id: 'int-1',
  ownerId: 'owner-1',
  providerId: 'custom',
  teamId: null,
  config: { customLlm: { customName: 'My LLM', upstreamModel: 'qwen-x' } },
};

describe('IntegrationsService — Custom LLM enable/disable mirroring', () => {
  it('disable deletes the bound alias (model disappears from the table)', async () => {
    const { svc, deleteWhere, insertValues } = makeMirrorService([
      [{ role: 'basic', companyId: null }], // assertCanManageKeys
      [CUSTOM_ROW], // the integration row (owner === caller → no mutate-guard query)
      [{ customName: 'My LLM', upstreamModel: 'qwen-x' }], // alias snapshot read
    ]);
    // listForUser at the tail finds nothing → update() throws; we only
    // care that the mirror deleted the alias first.
    await svc.update('owner-1', 'int-1', { isEnabled: false }).catch(() => {});
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('enable reactivates an existing alias (no duplicate insert)', async () => {
    const { svc, insertValues, deleteWhere } = makeMirrorService([
      [{ role: 'basic', companyId: null }],
      [CUSTOM_ROW],
      [{ id: 'alias-1' }], // existing alias → reactivate, do not insert
    ]);
    await svc.update('owner-1', 'int-1', { isEnabled: true }).catch(() => {});
    expect(insertValues).not.toHaveBeenCalled();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it('enable recreates the alias from the snapshot when none exists', async () => {
    const { svc, insertValues } = makeMirrorService([
      [{ role: 'basic', companyId: null }],
      [CUSTOM_ROW],
      [], // no existing alias → recreate from config.customLlm snapshot
    ]);
    await svc.update('owner-1', 'int-1', { isEnabled: true }).catch(() => {});
    expect(insertValues).toHaveBeenCalledTimes(1);
    const calls = insertValues.mock.calls as unknown as unknown[][];
    const row = calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      ownerId: 'owner-1',
      integrationId: 'int-1',
      customName: 'My LLM',
      upstreamModel: 'qwen-x',
      isActive: true,
    });
  });
});
