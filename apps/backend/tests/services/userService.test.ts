import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { userService } from '../../src/services/userService';
import prisma from '../../src/models/index';
import { AppError } from '../../src/middleware/errorHandler';

// The global setup.ts mock for `user` does not include `create`.
// Add the missing method so tests that call user.create don't blow up.
beforeAll(() => {
  const userMock = prisma.user as Record<string, unknown>;
  if (!userMock.create) {
    userMock.create = vi.fn();
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auth0|user-1',
    email: 'alice@example.com',
    name: 'Alice',
    avatar: 'AL',
    color: '#FF0000',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── findOrCreateUser ─────────────────────────────────────────────────────────

describe('userService.findOrCreateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing user without creating when found by auth0Id', async () => {
    const existing = makeDbUser({ id: 'auth0|user-1', color: '#FF0000' });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existing as never); // first call: by id
    // The service always recomputes color; if it differs it calls update.
    // We mock update to return the same user so the return value is defined.
    vi.mocked(prisma.user.update).mockResolvedValue(existing as never);

    const result = await userService.findOrCreateUser('auth0|user-1', 'alice@example.com', 'Alice');

    // Should only call findUnique once (by id), no create
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'auth0|user-1' } });
    expect((prisma.user as Record<string, unknown>).create).not.toHaveBeenCalled();
    expect(result.id).toBe('auth0|user-1');
  });

  it('creates a new user when not found by auth0Id and email is not in DB', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)   // findUnique by id: not found
      .mockResolvedValueOnce(null);  // findUnique by email: not found
    const newUser = makeDbUser({ id: 'auth0|new-user', email: 'new@example.com', name: 'New' });
    vi.mocked((prisma.user as Record<string, unknown>).create as ReturnType<typeof vi.fn>)
      .mockResolvedValue(newUser as never);

    const result = await userService.findOrCreateUser('auth0|new-user', 'new@example.com', 'New');

    expect((prisma.user as Record<string, unknown>).create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'auth0|new-user',
        email: 'new@example.com',
        name: 'New',
      }),
    });
    expect(result.email).toBe('new@example.com');
  });

  it('returns existing user found by email (different auth provider scenario)', async () => {
    const existingByEmail = makeDbUser({ id: 'auth0|other-provider', email: 'alice@example.com' });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)                       // by id: not found
      .mockResolvedValueOnce(existingByEmail as never);  // by email: found

    const result = await userService.findOrCreateUser('auth0|new-provider', 'alice@example.com', 'Alice');

    expect((prisma.user as Record<string, unknown>).create).not.toHaveBeenCalled();
    expect(result.id).toBe('auth0|other-provider');
  });

  it('uses email prefix as name when name is not provided', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const createdUser = makeDbUser({ name: 'janedoe' });
    vi.mocked((prisma.user as Record<string, unknown>).create as ReturnType<typeof vi.fn>)
      .mockResolvedValue(createdUser as never);

    await userService.findOrCreateUser('auth0|user-x', 'janedoe@example.com');

    const createCall = vi.mocked((prisma.user as Record<string, unknown>).create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.name).toBe('janedoe');
  });

  it('uses the last segment of auth0Id as name when email and name are absent', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null); // by id: not found, no email to check
    const createdUser = makeDbUser({ name: 'sub123' });
    vi.mocked((prisma.user as Record<string, unknown>).create as ReturnType<typeof vi.fn>)
      .mockResolvedValue(createdUser as never);

    await userService.findOrCreateUser('auth0|sub123');

    const createCall = vi.mocked((prisma.user as Record<string, unknown>).create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.data.name).toBe('sub123');
    // Email fallback: {auth0Id}@clients.auth0.local
    expect(createCall.data.email).toBe('auth0|sub123@clients.auth0.local');
  });

  it('updates color when existing user has a stale color', async () => {
    // The service always recomputes the correct color via generateColorFromUserId.
    // If stored color !== correct color, it should update.
    // We can't predict the exact color, but we know an obviously wrong value triggers an update.
    const existingWithWrongColor = makeDbUser({
      id: 'auth0|user-1',
      color: '#BADCOLOR_THAT_WONT_MATCH',
    });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existingWithWrongColor as never);
    vi.mocked(prisma.user.update).mockResolvedValue(
      makeDbUser({ id: 'auth0|user-1' }) as never
    );

    await userService.findOrCreateUser('auth0|user-1', 'alice@example.com', 'Alice');

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('updates profile fields when email was set to auth0 fallback and real email now available', async () => {
    const existingWithFallbackEmail = makeDbUser({
      id: 'auth0|user-1',
      email: 'auth0|user-1@clients.auth0.local',
      name: 'Alice',
      color: '#FF0000', // will be recalculated; any value triggers re-check
    });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existingWithFallbackEmail as never);
    vi.mocked(prisma.user.update).mockResolvedValue(
      makeDbUser({ email: 'alice@real.com' }) as never
    );

    await userService.findOrCreateUser('auth0|user-1', 'alice@real.com', 'Alice');

    // update should be called because email ends with @clients.auth0.local and real email differs
    expect(prisma.user.update).toHaveBeenCalled();
    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(updateCall.data.email).toBe('alice@real.com');
  });

  it('updates name when user had a numeric name (M2M migration) and real name is now available', async () => {
    const existingWithNumericName = makeDbUser({
      id: 'auth0|user-1',
      email: 'alice@example.com',
      name: '1234567890',  // numeric — indicates M2M token created the user
      color: '#FF0000',
    });
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existingWithNumericName as never);
    vi.mocked(prisma.user.update).mockResolvedValue(
      makeDbUser({ name: 'alice' }) as never
    );

    await userService.findOrCreateUser('auth0|user-1', 'alice@example.com');

    expect(prisma.user.update).toHaveBeenCalled();
  });
});

// ─── getUser ──────────────────────────────────────────────────────────────────

describe('userService.getUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the user when found', async () => {
    const user = makeDbUser({ id: 'user-1' });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);

    const result = await userService.getUser('user-1');

    expect(result).toMatchObject({ id: 'user-1', name: 'Alice' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('throws AppError 404 when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(userService.getUser('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      message: 'User not found',
    });
  });

  it('thrown error is an AppError instance', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(userService.getUser('nonexistent')).rejects.toBeInstanceOf(AppError);
  });
});

// ─── updateProfile ────────────────────────────────────────────────────────────

describe('userService.updateProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.user.update with the new name and recomputed avatar', async () => {
    const updated = makeDbUser({ name: 'Bob Smith', avatar: 'BS' });
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);

    await userService.updateProfile('user-1', 'Bob Smith');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Bob Smith',
        avatar: 'BS', // generateAvatar('Bob Smith') === 'BS'
      },
    });
  });

  it('returns the updated user object from prisma', async () => {
    const updated = makeDbUser({ name: 'Charlie', avatar: 'CH' });
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);

    const result = await userService.updateProfile('user-1', 'Charlie');

    expect(result.name).toBe('Charlie');
    expect(result.avatar).toBe('CH');
  });

  it('generates avatar from a single-word name correctly', async () => {
    // generateAvatar('Alice') should produce 'AL' (first 2 chars uppercased)
    const updated = makeDbUser({ name: 'Alice', avatar: 'AL' });
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);

    await userService.updateProfile('user-1', 'Alice');

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(updateCall.data.avatar).toBe('AL');
  });

  it('generates avatar from a two-word name correctly (first + last initial)', async () => {
    // generateAvatar('Jane Doe') should produce 'JD'
    const updated = makeDbUser({ name: 'Jane Doe', avatar: 'JD' });
    vi.mocked(prisma.user.update).mockResolvedValue(updated as never);

    await userService.updateProfile('user-1', 'Jane Doe');

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(updateCall.data.avatar).toBe('JD');
  });
});
