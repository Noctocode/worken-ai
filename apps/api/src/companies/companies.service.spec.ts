import { BadRequestException } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';

/**
 * The validation in `update` runs before any DB call, so we can test
 * the BadRequestException paths against a service whose DB stub blows
 * up the moment it's touched. If the validation paths regress and let
 * a bad input through, the test fails on the unexpected DB access.
 */
function svc() {
  const exploder = (): never => {
    throw new Error('unexpected DB call — validation should have rejected first');
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = new Proxy(
    {},
    {
      get: () => exploder,
    },
  );
  return new CompaniesService(db);
}

describe('CompaniesService.update validation', () => {
  it('rejects empty / whitespace name', async () => {
    await expect(svc().update({ name: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects malformed contact email', async () => {
    await expect(
      svc().update({ contactEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects negative monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: -100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: 12.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
