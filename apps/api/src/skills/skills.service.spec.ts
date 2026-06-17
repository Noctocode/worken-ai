import { BadRequestException } from '@nestjs/common';
import { SkillsService } from './skills.service.js';

/**
 * The input validation in `create` runs before any DB / embedder call, so the
 * spec exercises it against a service whose DB + DocumentsService stubs explode
 * the moment they're touched. A regression then fails on the unexpected access
 * instead of silently persisting a bad row.
 */
function svc() {
  const exploder = (): never => {
    throw new Error(
      'unexpected dependency call — validation should reject first',
    );
  };
  const db: unknown = new Proxy({}, { get: () => exploder });
  const documents: unknown = new Proxy({}, { get: () => exploder });
  return new SkillsService(db as never, documents as never);
}

const valid = {
  name: 'Excel report',
  description: 'Use when building an .xlsx report.',
  instructions: 'Build the workbook.',
};

describe('SkillsService.create — executable validation', () => {
  it('rejects source=executable with no scripts (before any DB call)', async () => {
    await expect(
      svc().create('user-1', { ...valid, source: 'executable' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects source=executable with an empty scripts array', async () => {
    await expect(
      svc().create('user-1', { ...valid, source: 'executable', scripts: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still enforces the base required fields before source checks', async () => {
    await expect(
      svc().create('user-1', {
        name: '',
        description: 'd',
        instructions: 'i',
        source: 'executable',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
