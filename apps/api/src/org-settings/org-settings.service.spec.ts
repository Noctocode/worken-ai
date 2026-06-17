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
  return new OrgSettingsService(
    db as never,
    // NotificationsService stub — validation tests don't reach the
    // alert fanout path, but the constructor requires the injection.
    {
      getOrgBudgetRecipients: () => Promise.resolve([] as string[]),
      createIfNotExists: () => Promise.resolve(null),
      create: () => Promise.resolve(null),
    } as never,
  );
}

describe('OrgSettingsService.update validation', () => {
  it('rejects negative monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: -1 }, 'caller-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-integer monthly budget', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: 12.5 }, 'caller-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects NaN', async () => {
    await expect(
      svc().update({ monthlyBudgetCents: NaN }, 'caller-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-boolean executableSkillsEnabled', async () => {
    await expect(
      svc().update({ executableSkillsEnabled: 'yes' as never }, 'caller-id'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OrgSettingsService.isExecutableSkillsEnabled — env kill-switch', () => {
  const orig = process.env['EXECUTABLE_SKILLS_KILL_SWITCH'];
  afterEach(() => {
    if (orig === undefined) delete process.env['EXECUTABLE_SKILLS_KILL_SWITCH'];
    else process.env['EXECUTABLE_SKILLS_KILL_SWITCH'] = orig;
  });

  it('returns false WITHOUT touching the DB when the kill-switch is set', async () => {
    process.env['EXECUTABLE_SKILLS_KILL_SWITCH'] = 'true';
    // svc()'s DB explodes on any access — the env check must short-circuit first.
    await expect(svc().isExecutableSkillsEnabled('caller-id')).resolves.toBe(
      false,
    );
  });
});
