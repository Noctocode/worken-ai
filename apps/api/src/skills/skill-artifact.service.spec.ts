import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { SkillArtifactService } from './skill-artifact.service.js';

/**
 * Chainable drizzle stub. `selectResults` is a queue: each select chain
 * (`.where()` or `.innerJoin().where()`) resolves to the next entry, so a
 * method that runs two selects (e.g. owner check then fetch) gets them in
 * order.
 */
function makeDb(selectResults: unknown[][] = []) {
  const inserted: Record<string, unknown>[] = [];
  let deletes = 0;
  let i = 0;
  const next = () => Promise.resolve(selectResults[i++] ?? []);
  const whereable = {
    where: () => next(),
    innerJoin: () => ({ where: () => next() }),
  };
  const db = {
    select: () => ({ from: () => whereable }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          inserted.push(v);
          return Promise.resolve([{ id: 'a1', ...v }]);
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deletes += 1;
        return Promise.resolve(undefined);
      },
    }),
  };
  return { db, inserted, deletes: () => deletes };
}

const FUTURE = new Date('2999-01-01T00:00:00Z');
const PAST = new Date('2000-01-01T00:00:00Z');

describe('SkillArtifactService', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('store', () => {
    it('writes basename-only files and indexes them with a retention deadline', async () => {
      const mkdir = jest
        .spyOn(fs, 'mkdir')
        .mockResolvedValue(undefined as never);
      const write = jest
        .spyOn(fs, 'writeFile')
        .mockResolvedValue(undefined as never);
      const { db, inserted } = makeDb();
      const svc = new SkillArtifactService(db as never);

      const rows = await svc.store(
        'run-1',
        [
          {
            // Untrusted producer tries to escape the run dir.
            filename: '../../etc/evil.sh',
            mimeType: 'text/x-sh',
            content: Buffer.from('hi'),
          },
        ],
        new Date('2026-01-01T00:00:00Z'),
      );

      expect(mkdir).toHaveBeenCalled();
      // Path traversal collapsed to a basename.
      const writtenPath = write.mock.calls[0][0] as string;
      expect(writtenPath.endsWith('evil.sh')).toBe(true);
      expect(writtenPath).not.toContain('..');
      expect(inserted[0]).toMatchObject({
        runId: 'run-1',
        filename: 'evil.sh',
        sizeBytes: 2,
      });
      expect(inserted[0].expiresAt).toBeInstanceOf(Date);
      expect(rows).toHaveLength(1);
    });

    it('is a no-op for a run with no files', async () => {
      const mkdir = jest.spyOn(fs, 'mkdir');
      const { db } = makeDb();
      const svc = new SkillArtifactService(db as never);
      expect(await svc.store('run-1', [])).toEqual([]);
      expect(mkdir).not.toHaveBeenCalled();
    });
  });

  describe('getForDownload', () => {
    const row = (over: Record<string, unknown>) => [
      {
        filename: 'report.xlsx',
        mimeType: 'application/vnd.ms-excel',
        storagePath: '/uploads/skill-artifacts/run-1/report.xlsx',
        expiresAt: FUTURE,
        ownerId: 'u1',
        ...over,
      },
    ];

    it('returns the file for its run owner', async () => {
      const { db } = makeDb([row({})]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.getForDownload('u1', 'a1')).resolves.toMatchObject({
        filename: 'report.xlsx',
        storagePath: '/uploads/skill-artifacts/run-1/report.xlsx',
      });
    });

    it('forbids another user', async () => {
      const { db } = makeDb([row({ ownerId: 'u2' })]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.getForDownload('u1', 'a1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('404s an expired artifact', async () => {
      const { db } = makeDb([row({ expiresAt: PAST })]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.getForDownload('u1', 'a1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s a missing artifact', async () => {
      const { db } = makeDb([[]]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.getForDownload('u1', 'a1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reapExpired', () => {
    it('deletes each expired artifact row (file ENOENT is tolerated)', async () => {
      jest
        .spyOn(fs, 'unlink')
        .mockRejectedValue(
          Object.assign(new Error('missing'), { code: 'ENOENT' }),
        );
      const { db, deletes } = makeDb([
        [
          { id: 'a1', storagePath: '/x/1' },
          { id: 'a2', storagePath: '/x/2' },
        ],
      ]);
      const svc = new SkillArtifactService(db as never);
      expect(await svc.reapExpired()).toBe(2);
      expect(deletes()).toBe(2);
    });

    it('returns 0 when nothing is expired', async () => {
      const { db, deletes } = makeDb([[]]);
      const svc = new SkillArtifactService(db as never);
      expect(await svc.reapExpired()).toBe(0);
      expect(deletes()).toBe(0);
    });
  });

  describe('listForRun', () => {
    it('returns the run owner’s artifacts', async () => {
      const arts = [{ id: 'a1', filename: 'r.xlsx' }];
      const { db } = makeDb([[{ userId: 'u1' }], arts]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.listForRun('u1', 'run-1')).resolves.toEqual(arts);
    });

    it('404s when the run is not the caller’s', async () => {
      const { db } = makeDb([[]]);
      const svc = new SkillArtifactService(db as never);
      await expect(svc.listForRun('u1', 'run-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
