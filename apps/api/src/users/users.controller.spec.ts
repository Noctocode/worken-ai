import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types.js';
import { UsersController } from './users.controller.js';
import type { UsersService } from './users.service.js';

/**
 * Build a fake `db` whose `db.select().from().where()` chain resolves
 * to the preset rows. Drizzle's chain is what the controllers call to
 * read the caller's role for the admin gates; mocking it directly is
 * brittle but keeps the test fast (no Postgres) and lets us focus on
 * the gate logic, not the SQL.
 */
function mockDb(rows: unknown[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  return { select } as unknown;
}

const ADMIN: AuthenticatedUser = {
  id: 'admin-id',
  email: 'admin@example.com',
};
const BASIC: AuthenticatedUser = {
  id: 'basic-id',
  email: 'basic@example.com',
};

describe('UsersController auth gates', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;

  function bootstrap(callerRows: unknown[]) {
    const db = mockDb(callerRows);
    usersService = {
      updateBudget: jest
        .fn()
        .mockResolvedValue({ monthlyBudgetCents: 5000 }),
      updateRole: jest
        .fn()
        .mockResolvedValue({ id: 'target-id', role: 'advanced' }),
      remove: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as jest.Mocked<UsersService>;

    controller = new UsersController(
      db as never,
      usersService,
      {} as never, // teamsService — unused by the gated endpoints
      {} as never, // mailService
      {} as never, // observabilityService
      {} as never, // notificationsService — unused by these gates
    );
  }

  describe('PATCH /users/:id/budget', () => {
    it('admin succeeds and forwards to UsersService.updateBudget', async () => {
      bootstrap([{ role: 'admin' }]);
      await expect(
        controller.updateBudget('target-id', { budgetUsd: 50 }, ADMIN),
      ).resolves.toEqual({ monthlyBudgetCents: 5000 });
      expect(usersService.updateBudget).toHaveBeenCalledWith('target-id', 50);
    });

    it('non-admin is rejected with ForbiddenException', async () => {
      bootstrap([{ role: 'basic' }]);
      await expect(
        controller.updateBudget('target-id', { budgetUsd: 50 }, BASIC),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.updateBudget).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /users/:id/role', () => {
    it('admin promoting another user succeeds', async () => {
      bootstrap([{ role: 'admin' }]);
      await expect(
        controller.updateRole('target-id', { role: 'advanced' }, ADMIN),
      ).resolves.toEqual({ id: 'target-id', role: 'advanced' });
      expect(usersService.updateRole).toHaveBeenCalledWith(
        'target-id',
        'advanced',
      );
    });

    it('non-admin is rejected with ForbiddenException', async () => {
      bootstrap([{ role: 'advanced' }]);
      await expect(
        controller.updateRole('target-id', { role: 'admin' }, BASIC),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.updateRole).not.toHaveBeenCalled();
    });

    it('admin trying to mutate own role hits the self-lockout guard', async () => {
      bootstrap([{ role: 'admin' }]);
      await expect(
        controller.updateRole(ADMIN.id, { role: 'basic' }, ADMIN),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.updateRole).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /users/:id', () => {
    it('admin succeeds and forwards to UsersService.remove', async () => {
      bootstrap([{ role: 'admin' }]);
      await expect(
        controller.remove('target-id', ADMIN),
      ).resolves.toEqual({ success: true });
      expect(usersService.remove).toHaveBeenCalledWith('target-id', ADMIN.id);
    });

    it('non-admin is rejected with ForbiddenException', async () => {
      bootstrap([{ role: 'basic' }]);
      await expect(controller.remove('target-id', BASIC)).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.remove).not.toHaveBeenCalled();
    });
  });
});
