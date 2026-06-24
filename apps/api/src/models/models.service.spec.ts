import { HttpException } from '@nestjs/common';
import type { Database } from '../database/database.module.js';
import { ModelsService, MODEL_UNAVAILABLE_MARKER } from './models.service.js';
import type { OpenRouterCatalogService } from './openrouter-catalog.service.js';

/* A drizzle stub good enough for these unit tests:
 *  - select() resolves the chain to the next queued row set
 *  - delete()/insert() record their calls and resolve
 * The SQL passed to .where()/.values() is ignored; the real drizzle
 * helpers (eq/and/like/isNull) still run against the real columns and
 * build AST that the stub simply discards. */
function makeDeps(
  opts: {
    selectQueue?: unknown[][];
    catalog?: { id: string; name: string }[];
  } = {},
) {
  const queue = [...(opts.selectQueue ?? [])];
  const thenable = (rows: unknown[]) => {
    const chain: Record<string, unknown> & PromiseLike<unknown[]> = {
      then: (onFulfilled?: (v: unknown[]) => unknown) =>
        Promise.resolve(rows).then(onFulfilled),
    } as never;
    for (const m of [
      'from',
      'where',
      'limit',
      'orderBy',
      'innerJoin',
      'leftJoin',
      'groupBy',
    ]) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    return chain;
  };
  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const select = jest.fn(() => thenable(queue.shift() ?? []));
  const db = {
    select,
    delete: jest.fn(() => ({ where: deleteWhere })),
    insert: jest.fn(() => ({ values: insertValues })),
  };
  const catalogService = {
    list: jest.fn().mockResolvedValue(opts.catalog ?? []),
  };
  const svc = new ModelsService(
    db as unknown as Database,
    catalogService as unknown as OpenRouterCatalogService,
  );
  return { svc, db, catalogService, deleteWhere, insertValues, select };
}

describe('ModelsService — availability helpers (pure)', () => {
  it('firstAvailableModel returns the first candidate that is available', () => {
    const { svc } = makeDeps();
    expect(svc.firstAvailableModel(['a', 'b'], new Set(['a', 'b']))).toBe('a');
  });

  it('firstAvailableModel skips unavailable and returns the usable fallback', () => {
    const { svc } = makeDeps();
    expect(svc.firstAvailableModel(['a', 'b'], new Set(['b']))).toBe('b');
  });

  it('firstAvailableModel returns null when none are available', () => {
    const { svc } = makeDeps();
    expect(svc.firstAvailableModel(['a', 'b'], new Set())).toBeNull();
    expect(svc.firstAvailableModel([], new Set(['a']))).toBeNull();
  });

  it('modelUnavailableMessage carries the marker, the id, and the fix', () => {
    const { svc } = makeDeps();
    const msg = svc.modelUnavailableMessage('openai/gpt-x');
    expect(msg.startsWith(`${MODEL_UNAVAILABLE_MARKER}:`)).toBe(true);
    expect(msg).toContain('"openai/gpt-x"');
    expect(msg).toContain('Management → Models');
  });

  it('modelUnavailableError is a 422 HttpException with that message', () => {
    const { svc } = makeDeps();
    const err = svc.modelUnavailableError('m1');
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toBe(svc.modelUnavailableMessage('m1'));
  });

  it('assertModelAvailable resolves (no query) when the id is in the given set', async () => {
    const { svc, select } = makeDeps();
    await expect(
      svc.assertModelAvailable('u1', 'm1', undefined, new Set(['m1'])),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it('assertModelAvailable throws MODEL_UNAVAILABLE (422) when the id is absent', async () => {
    const { svc, select } = makeDeps();
    await expect(
      svc.assertModelAvailable('u1', 'm1', undefined, new Set(['other'])),
    ).rejects.toMatchObject({ status: 422 });
    expect(select).not.toHaveBeenCalled();
  });
});

describe('ModelsService.syncProviderCatalogAliases', () => {
  it('no-ops for custom (no catalog, routes via a bound alias)', async () => {
    const { svc, db, catalogService } = makeDeps();
    await svc.syncProviderCatalogAliases('o1', 'custom', true);
    expect(catalogService.list).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('no-ops for azure (deployments, not a catalog)', async () => {
    const { svc, db, catalogService } = makeDeps();
    await svc.syncProviderCatalogAliases('o1', 'azure', false);
    expect(catalogService.list).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('disable deletes the auto-provisioned aliases without touching the catalog', async () => {
    const { svc, db, catalogService, deleteWhere, insertValues } = makeDeps();
    await svc.syncProviderCatalogAliases('o1', 'openai', false);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(catalogService.list).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('enable inserts only the provider models the owner does not already have', async () => {
    const { svc, insertValues } = makeDeps({
      catalog: [
        { id: 'openai/gpt-5', name: 'GPT-5' },
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
        { id: 'anthropic/claude', name: 'Claude' }, // other provider — ignored
      ],
      // owner already has gpt-4o → only gpt-5 should be inserted
      selectQueue: [[{ modelIdentifier: 'openai/gpt-4o' }]],
    });
    await svc.syncProviderCatalogAliases('o1', 'openai', true);

    expect(insertValues).toHaveBeenCalledTimes(1);
    const calls = insertValues.mock.calls as unknown as unknown[][];
    const rows = calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ownerId: 'o1',
      teamId: null,
      modelIdentifier: 'openai/gpt-5',
      customName: 'GPT-5',
      isActive: true,
      autoProvisioned: true,
    });
  });

  it('enable is a no-op insert when an empty catalog yields no provider models', async () => {
    const { svc, insertValues } = makeDeps({ catalog: [] });
    await svc.syncProviderCatalogAliases('o1', 'openai', true);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('enable inserts nothing when the owner already has every provider model', async () => {
    const { svc, insertValues } = makeDeps({
      catalog: [{ id: 'openai/gpt-5', name: 'GPT-5' }],
      selectQueue: [[{ modelIdentifier: 'openai/gpt-5' }]],
    });
    await svc.syncProviderCatalogAliases('o1', 'openai', true);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
