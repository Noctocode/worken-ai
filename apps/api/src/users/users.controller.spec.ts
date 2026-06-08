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
      updateBudget: jest.fn().mockResolvedValue({ monthlyBudgetCents: 5000 }),
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
      await expect(controller.remove('target-id', ADMIN)).resolves.toEqual({
        success: true,
      });
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

  describe('POST /users/invite', () => {
    // Invite hits two select chains in sequence (caller row, then
    // existing-user-by-email) and then either an update or an insert.
    // The shared mockDb only supports one select shape, so this
    // helper sequences select responses and stubs update / insert.
    function bootstrapInvite({
      caller,
      existing,
    }: {
      caller: Record<string, unknown> | null;
      existing: Record<string, unknown> | null;
    }) {
      const selectQueue: unknown[][] = [
        caller ? [caller] : [],
        existing ? [existing] : [],
      ];
      const select = jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(selectQueue.shift() ?? []),
        })),
      }));
      const updateWhere = jest.fn().mockResolvedValue(undefined);
      const update = jest.fn(() => ({
        set: jest.fn(() => ({ where: updateWhere })),
      }));
      const insertReturning = jest
        .fn()
        .mockResolvedValue([{ email: 'new@example.com', role: 'basic' }]);
      const insert = jest.fn(() => ({
        values: jest.fn(() => ({ returning: insertReturning })),
      }));
      const notifications = {
        create: jest.fn().mockResolvedValue(undefined),
      };
      const mailService = {
        sendOrgInvitation: jest.fn().mockResolvedValue(undefined),
      };
      const db = { select, update, insert };

      const inviteController = new UsersController(
        db as never,
        {} as never, // usersService — not used by invite
        {} as never, // teamsService
        mailService as never,
        {} as never, // observabilityService
        notifications as never,
      );
      return { controller: inviteController, update, notifications };
    }

    const ADVANCED: AuthenticatedUser = {
      id: 'advanced-id',
      email: 'adv@example.com',
    };
    // Invite is company-only (personal profiles are gated out), so the
    // callers in these role/cross-tenant tests are company profiles.
    const advancedCallerRow = {
      id: 'advanced-id',
      role: 'advanced',
      email: 'adv@example.com',
      companyId: 'company-1',
      profileType: 'company',
    };
    const adminCallerRow = {
      id: 'admin-id',
      role: 'admin',
      email: 'admin@example.com',
      companyId: 'company-1',
      profileType: 'company',
    };

    // Regression: advanced caller invites an existing admin user with
    // role 'basic'. Without the guard the controller would patch
    // existing.role through the invite endpoint, silently bypassing
    // the admin-only /users/:id/role gate. Must 403, must not update.
    it('non-admin cannot change existing user role via invite', async () => {
      const { controller, update } = bootstrapInvite({
        caller: advancedCallerRow,
        existing: {
          id: 'target-id',
          role: 'admin',
          email: 'target@example.com',
          companyId: null,
        },
      });
      await expect(
        controller.inviteUser(
          { email: 'target@example.com', role: 'basic' },
          ADVANCED,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    it('admin can change existing user role via invite', async () => {
      const { controller, update, notifications } = bootstrapInvite({
        caller: adminCallerRow,
        existing: {
          id: 'target-id',
          role: 'basic',
          email: 'target@example.com',
          companyId: null,
        },
      });
      await expect(
        controller.inviteUser(
          { email: 'target@example.com', role: 'advanced' },
          { id: 'admin-id', email: 'admin@example.com' },
        ),
      ).resolves.toEqual({
        status: 'updated',
        email: 'target@example.com',
        role: 'advanced',
      });
      expect(update).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalled();
    });

    // Non-admins re-inviting at the same role must still succeed —
    // the guard targets role *changes*, not re-sends. No update is
    // needed (empty patch); the notification still fires.
    it('non-admin can re-invite existing user without role change', async () => {
      const { controller, update, notifications } = bootstrapInvite({
        caller: advancedCallerRow,
        existing: {
          id: 'target-id',
          role: 'basic',
          email: 'target@example.com',
          // Same tenant as the caller + already sealed, so no company
          // backfill patch fires — the re-invite must not call update.
          companyId: 'company-1',
        },
      });
      await expect(
        controller.inviteUser(
          { email: 'target@example.com', role: 'basic' },
          ADVANCED,
        ),
      ).resolves.toEqual({
        status: 'updated',
        email: 'target@example.com',
        role: 'basic',
      });
      expect(update).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalled();
    });

    // Sibling guard from before this PR: even creating a brand-new
    // admin requires admin caller. Locked in here so a future
    // refactor doesn't quietly drop it alongside the new check.
    it('non-admin cannot invite a brand-new user as admin', async () => {
      const { controller, update } = bootstrapInvite({
        caller: advancedCallerRow,
        existing: null,
      });
      await expect(
        controller.inviteUser(
          { email: 'new@example.com', role: 'admin' },
          ADVANCED,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(update).not.toHaveBeenCalled();
    });

    // Personal profiles are sole accounts — inviting would create a
    // company-less dangling user, so it's gated even for an admin.
    it('personal profile cannot invite users', async () => {
      const { controller, update } = bootstrapInvite({
        caller: {
          id: 'admin-id',
          role: 'admin',
          email: 'admin@example.com',
          companyId: null,
          profileType: 'personal',
        },
        existing: null,
      });
      await expect(
        controller.inviteUser(
          { email: 'new@example.com', role: 'basic' },
          { id: 'admin-id', email: 'admin@example.com' },
        ),
      ).rejects.toThrow(/Personal profiles cannot invite users/);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
