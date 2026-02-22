import { describe, it, expect, beforeEach, vi } from 'vitest';
import { userController } from '../../src/controllers/userController';
import { makeReq, makeRes, makeNext } from '../mocks/factories';
import { AppError } from '../../src/middleware/errorHandler';

// ─── Mock userService ─────────────────────────────────────────────────────────
vi.mock('../../src/services/userService', () => ({
  userService: {
    findOrCreateUser: vi.fn(),
    updateProfile: vi.fn(),
    getUser: vi.fn(),
  },
}));

import { userService } from '../../src/services/userService';

/** Build a fake Prisma user record. */
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auth0|user-1',
    email: 'test@example.com',
    name: 'Test User',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=Test+User',
    color: '#3B82F6',
    subscriptionStatus: 'FREE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('userController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── getMe ───────────────────────────────────────────────────────────────────
  describe('getMe', () => {
    it('returns user profile on happy path', async () => {
      const dbUser = makeUser();
      vi.mocked(userService.findOrCreateUser).mockResolvedValue(dbUser as never);

      const req = makeReq({
        user: { sub: 'auth0|user-1', email: 'test@example.com', name: 'Test User' },
      });
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      expect(userService.findOrCreateUser).toHaveBeenCalledWith(
        'auth0|user-1',
        'test@example.com',
        'Test User',
      );
      expect(res.json).toHaveBeenCalledWith({
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        avatar: dbUser.avatar,
        color: dbUser.color,
        subscriptionStatus: 'free',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('lowercases subscriptionStatus in response', async () => {
      const dbUser = makeUser({ subscriptionStatus: 'PRO' });
      vi.mocked(userService.findOrCreateUser).mockResolvedValue(dbUser as never);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.subscriptionStatus).toBe('pro');
    });

    it('calls next when findOrCreateUser throws AppError', async () => {
      const error = new AppError(500, 'DB error');
      vi.mocked(userService.findOrCreateUser).mockRejectedValue(error);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error from service', async () => {
      const error = new Error('Unexpected failure');
      vi.mocked(userService.findOrCreateUser).mockRejectedValue(error);

      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('calls next when user is not on request', async () => {
      const req = makeReq({ user: undefined });
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('works with M2M token (no email or name)', async () => {
      const dbUser = makeUser({ email: 'm2m@clients.auth0.local', name: 'user-1' });
      vi.mocked(userService.findOrCreateUser).mockResolvedValue(dbUser as never);

      const req = makeReq({
        user: { sub: 'auth0|user-1' },
      });
      const res = makeRes();
      const next = makeNext();

      await userController.getMe(req, res, next);

      expect(userService.findOrCreateUser).toHaveBeenCalledWith(
        'auth0|user-1',
        undefined,
        undefined,
      );
      expect(res.json).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── updateMe ────────────────────────────────────────────────────────────────
  describe('updateMe', () => {
    it('updates user profile and returns correct shape', async () => {
      const dbUser = makeUser({ name: 'New Name' });
      vi.mocked(userService.updateProfile).mockResolvedValue(dbUser as never);

      const req = makeReq({ body: { name: 'New Name' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      expect(userService.updateProfile).toHaveBeenCalledWith('auth0|user-1', 'New Name');
      expect(res.json).toHaveBeenCalledWith({
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        avatar: dbUser.avatar,
        color: dbUser.color,
        subscriptionStatus: 'free',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('lowercases subscriptionStatus in updateMe response', async () => {
      const dbUser = makeUser({ name: 'Renamed', subscriptionStatus: 'PRO' });
      vi.mocked(userService.updateProfile).mockResolvedValue(dbUser as never);

      const req = makeReq({ body: { name: 'Renamed' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      const jsonArg = vi.mocked(res.json).mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.subscriptionStatus).toBe('pro');
    });

    it('calls next when updateProfile throws AppError', async () => {
      const error = new AppError(404, 'User not found');
      vi.mocked(userService.updateProfile).mockRejectedValue(error);

      const req = makeReq({ body: { name: 'Name' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('calls next with generic error from service', async () => {
      const error = new Error('Unexpected');
      vi.mocked(userService.updateProfile).mockRejectedValue(error);

      const req = makeReq({ body: { name: 'Name' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('passes the name from req.body to updateProfile', async () => {
      const dbUser = makeUser({ name: 'Alice' });
      vi.mocked(userService.updateProfile).mockResolvedValue(dbUser as never);

      const req = makeReq({ body: { name: 'Alice' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      expect(userService.updateProfile).toHaveBeenCalledWith('auth0|user-1', 'Alice');
    });

    it('calls next when user is not on request', async () => {
      const req = makeReq({ user: undefined, body: { name: 'Name' } });
      const res = makeRes();
      const next = makeNext();

      await userController.updateMe(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });
});
