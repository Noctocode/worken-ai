import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysController } from './api-keys.controller.js';
import type { ApiKeysService } from './api-keys.service.js';
import type {
  AuthenticatedRequest,
  AuthMethod,
} from '../auth/jwt-or-api-key.guard.js';
import type { AuthenticatedUser } from '../auth/types.js';

const USER: AuthenticatedUser = {
  id: 'user-id',
  email: 'user@example.com',
};

function fakeReq(authMethod: AuthMethod): Request & AuthenticatedRequest {
  return { authMethod, user: USER } as unknown as Request &
    AuthenticatedRequest;
}

describe('ApiKeysController auth gates', () => {
  let controller: ApiKeysController;
  let apiKeysService: jest.Mocked<ApiKeysService>;

  beforeEach(() => {
    apiKeysService = {
      list: jest.fn().mockResolvedValue([]),
      mint: jest.fn().mockResolvedValue({
        id: 'k1',
        name: 'test',
        prefix: 'abcd',
        createdAt: new Date(),
        lastUsedAt: null,
        plaintext: 'sk-wai-ABCD…',
      }),
      revoke: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ApiKeysService>;
    controller = new ApiKeysController(apiKeysService);
  });

  describe('POST /api-keys (mint)', () => {
    it('cookie-authenticated caller succeeds', async () => {
      await expect(
        controller.mint({ name: 'GitHub Actions' }, USER, fakeReq('cookie')),
      ).resolves.toMatchObject({ name: 'test' });
      expect(apiKeysService.mint).toHaveBeenCalledWith(
        USER.id,
        'GitHub Actions',
      );
    });

    it('apikey-authenticated caller is blocked (privilege-escalation guard)', async () => {
      // A leaked sk-wai-… token must not be usable to mint replacement
      // tokens that survive the original being revoked. Mirrors the
      // explicit 403 in api-keys.controller.ts.
      expect(() =>
        controller.mint({ name: 'leak' }, USER, fakeReq('apikey')),
      ).toThrow(ForbiddenException);
      expect(apiKeysService.mint).not.toHaveBeenCalled();
    });
  });
});
