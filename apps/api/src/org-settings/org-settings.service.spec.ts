import { BadRequestException } from '@nestjs/common';
import { OrgSettingsService } from './org-settings.service.js';

/**
 * Validation in `update` runs before any DB call, so the spec
 * exercises BadRequest paths against a service whose DB stub
 * explodes the moment it's touched. If validation regresses, the
 * test fails on the unexpected DB access instead of silently saving
 * a bad value.
 */
function svc() {
  const exploder = (): never => {
    throw new Error(
      'unexpected DB call — validation should have rejected first',
    );
  };

  const db: unknown = new Proxy(
    {},
    {
      get: () => exploder,
    },
  );
  return new OrgSettingsService(db as never);
}

describe('OrgSettingsService.update validation', () => {
  it('rejects negative monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: 12.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects NaN', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: NaN }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
