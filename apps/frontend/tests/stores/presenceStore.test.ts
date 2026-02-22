import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePresenceStore } from '../../src/stores/presenceStore';
import { makeBoardUserInfo } from '../mocks/factories';

// Initial state snapshot for resetting between tests
const initialState = {
  connectionStatus: 'disconnected' as const,
  hasEverConnected: false,
  localUserId: null,
  localUserName: null,
  localUserColor: null,
  remoteUsers: new Map(),
  remoteCursors: new Map(),
  lastKnownPositions: new Map(),
};

beforeEach(() => {
  usePresenceStore.setState(initialState);
});

// ─── updateRemoteCursor ───────────────────────────────────────────────────────

describe('updateRemoteCursor', () => {
  it('adds a cursor to remoteCursors with all fields', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 100, 200, 'Alice', '#FF0000');

    const cursor = usePresenceStore.getState().remoteCursors.get('user-1');
    expect(cursor).toBeDefined();
    expect(cursor!.userId).toBe('user-1');
    expect(cursor!.x).toBe(100);
    expect(cursor!.y).toBe(200);
    expect(cursor!.name).toBe('Alice');
    expect(cursor!.color).toBe('#FF0000');
  });

  it('sets lastUpdate to a recent timestamp', () => {
    const before = Date.now();
    usePresenceStore.getState().updateRemoteCursor('user-1', 0, 0, 'Alice', '#FF0000');
    const after = Date.now();

    const cursor = usePresenceStore.getState().remoteCursors.get('user-1');
    expect(cursor!.lastUpdate).toBeGreaterThanOrEqual(before);
    expect(cursor!.lastUpdate).toBeLessThanOrEqual(after);
  });

  it('also updates lastKnownPositions', () => {
    usePresenceStore.getState().updateRemoteCursor('user-1', 300, 400, 'Alice', '#00FF00');

    const pos = usePresenceStore.getState().lastKnownPositions.get('user-1');
    expect(pos).toEqual({ x: 300, y: 400 });
  });

  it('overwrites an existing cursor with updated position', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 10, 20, 'Alice', '#FF0000');
    store.updateRemoteCursor('user-1', 50, 60, 'Alice', '#FF0000');

    const cursor = usePresenceStore.getState().remoteCursors.get('user-1');
    expect(cursor!.x).toBe(50);
    expect(cursor!.y).toBe(60);
  });

  it('stores multiple cursors independently', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 10, 20, 'Alice', '#FF0000');
    store.updateRemoteCursor('user-2', 30, 40, 'Bob', '#0000FF');

    const state = usePresenceStore.getState();
    expect(state.remoteCursors.size).toBe(2);
    expect(state.remoteCursors.get('user-1')!.x).toBe(10);
    expect(state.remoteCursors.get('user-2')!.x).toBe(30);
  });
});

// ─── removeRemoteCursor ───────────────────────────────────────────────────────

describe('removeRemoteCursor', () => {
  it('removes the cursor from remoteCursors', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 100, 200, 'Alice', '#FF0000');
    store.removeRemoteCursor('user-1');

    expect(usePresenceStore.getState().remoteCursors.has('user-1')).toBe(false);
  });

  it('does NOT clear lastKnownPositions — position persists after cursor removal', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 100, 200, 'Alice', '#FF0000');
    store.removeRemoteCursor('user-1');

    // This is the critical behavior: last known position survives
    const pos = usePresenceStore.getState().lastKnownPositions.get('user-1');
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it('only removes the specified user cursor, leaving others intact', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 10, 20, 'Alice', '#FF0000');
    store.updateRemoteCursor('user-2', 30, 40, 'Bob', '#0000FF');
    store.removeRemoteCursor('user-1');

    const state = usePresenceStore.getState();
    expect(state.remoteCursors.has('user-1')).toBe(false);
    expect(state.remoteCursors.has('user-2')).toBe(true);
  });

  it('is a no-op for a userId that has no cursor', () => {
    usePresenceStore.getState().removeRemoteCursor('nonexistent');
    // Should not throw and state should remain empty
    expect(usePresenceStore.getState().remoteCursors.size).toBe(0);
  });
});

// ─── clearRemoteCursors ───────────────────────────────────────────────────────

describe('clearRemoteCursors', () => {
  it('clears all cursors', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 10, 20, 'Alice', '#FF0000');
    store.updateRemoteCursor('user-2', 30, 40, 'Bob', '#0000FF');
    store.clearRemoteCursors();

    expect(usePresenceStore.getState().remoteCursors.size).toBe(0);
  });

  it('does NOT clear lastKnownPositions when cursors are cleared', () => {
    const store = usePresenceStore.getState();
    store.updateRemoteCursor('user-1', 10, 20, 'Alice', '#FF0000');
    store.clearRemoteCursors();

    // lastKnownPositions should survive
    expect(usePresenceStore.getState().lastKnownPositions.has('user-1')).toBe(true);
  });
});

// ─── removeRemoteUser ─────────────────────────────────────────────────────────

describe('removeRemoteUser', () => {
  it('removes the user from remoteUsers', () => {
    const store = usePresenceStore.getState();
    const user = makeBoardUserInfo({ userId: 'user-1' });
    store.addRemoteUser(user as any);
    store.removeRemoteUser('user-1');

    expect(usePresenceStore.getState().remoteUsers.has('user-1')).toBe(false);
  });

  it('clears both cursor AND lastKnownPositions when user leaves', () => {
    const store = usePresenceStore.getState();
    const user = makeBoardUserInfo({ userId: 'user-1' });
    store.addRemoteUser(user as any);
    store.updateRemoteCursor('user-1', 100, 200, 'Alice', '#FF0000');
    store.removeRemoteUser('user-1');

    const state = usePresenceStore.getState();
    expect(state.remoteCursors.has('user-1')).toBe(false);
    expect(state.lastKnownPositions.has('user-1')).toBe(false);
  });

  it('only removes the specified user, leaving others intact', () => {
    const store = usePresenceStore.getState();
    const user1 = makeBoardUserInfo({ userId: 'user-1', name: 'Alice' });
    const user2 = makeBoardUserInfo({ userId: 'user-2', name: 'Bob' });
    store.addRemoteUser(user1 as any);
    store.addRemoteUser(user2 as any);
    store.removeRemoteUser('user-1');

    const state = usePresenceStore.getState();
    expect(state.remoteUsers.has('user-1')).toBe(false);
    expect(state.remoteUsers.has('user-2')).toBe(true);
  });
});

// ─── addRemoteUser ────────────────────────────────────────────────────────────

describe('addRemoteUser', () => {
  it('adds a user to remoteUsers map keyed by userId', () => {
    const user = makeBoardUserInfo({ userId: 'user-3', name: 'Carol' });
    usePresenceStore.getState().addRemoteUser(user as any);

    const stored = usePresenceStore.getState().remoteUsers.get('user-3');
    expect(stored).toBeDefined();
    expect(stored!.name).toBe('Carol');
  });

  it('overwrites an existing entry if same userId is added again', () => {
    const store = usePresenceStore.getState();
    const user = makeBoardUserInfo({ userId: 'user-1', name: 'Alice' });
    const updated = makeBoardUserInfo({ userId: 'user-1', name: 'Alice Updated' });
    store.addRemoteUser(user as any);
    store.addRemoteUser(updated as any);

    expect(usePresenceStore.getState().remoteUsers.get('user-1')!.name).toBe('Alice Updated');
    expect(usePresenceStore.getState().remoteUsers.size).toBe(1);
  });
});

// ─── setConnectionStatus / hasEverConnected ───────────────────────────────────

describe('setConnectionStatus', () => {
  it('updates connectionStatus', () => {
    usePresenceStore.getState().setConnectionStatus('connecting');
    expect(usePresenceStore.getState().connectionStatus).toBe('connecting');
  });

  it('hasEverConnected becomes true after first connected status', () => {
    expect(usePresenceStore.getState().hasEverConnected).toBe(false);
    usePresenceStore.getState().setConnectionStatus('connected');
    expect(usePresenceStore.getState().hasEverConnected).toBe(true);
  });

  it('hasEverConnected stays true even after subsequent disconnected status', () => {
    const store = usePresenceStore.getState();
    store.setConnectionStatus('connected');
    store.setConnectionStatus('disconnected');
    expect(usePresenceStore.getState().hasEverConnected).toBe(true);
  });

  it('hasEverConnected stays true after displaced status', () => {
    const store = usePresenceStore.getState();
    store.setConnectionStatus('connected');
    store.setConnectionStatus('displaced');
    expect(usePresenceStore.getState().hasEverConnected).toBe(true);
  });

  it('hasEverConnected remains false when only non-connected statuses occur', () => {
    const store = usePresenceStore.getState();
    store.setConnectionStatus('connecting');
    store.setConnectionStatus('disconnected');
    expect(usePresenceStore.getState().hasEverConnected).toBe(false);
  });
});

// ─── setLocalUser ─────────────────────────────────────────────────────────────

describe('setLocalUser', () => {
  it('stores local user info', () => {
    usePresenceStore.getState().setLocalUser('local-1', 'Alice', '#ABCDEF');

    const state = usePresenceStore.getState();
    expect(state.localUserId).toBe('local-1');
    expect(state.localUserName).toBe('Alice');
    expect(state.localUserColor).toBe('#ABCDEF');
  });
});

// ─── setRemoteUsers ───────────────────────────────────────────────────────────

describe('setRemoteUsers', () => {
  it('replaces the entire remoteUsers map from an array', () => {
    const store = usePresenceStore.getState();
    // Pre-populate with a user
    store.addRemoteUser(makeBoardUserInfo({ userId: 'old-user' }) as any);

    const newUsers = [
      makeBoardUserInfo({ userId: 'user-A', name: 'Alpha' }),
      makeBoardUserInfo({ userId: 'user-B', name: 'Beta' }),
    ];
    store.setRemoteUsers(newUsers as any[]);

    const state = usePresenceStore.getState();
    expect(state.remoteUsers.size).toBe(2);
    expect(state.remoteUsers.has('old-user')).toBe(false);
    expect(state.remoteUsers.has('user-A')).toBe(true);
    expect(state.remoteUsers.has('user-B')).toBe(true);
  });

  it('handles an empty array (clears the map)', () => {
    usePresenceStore.getState().addRemoteUser(makeBoardUserInfo({ userId: 'user-1' }) as any);
    usePresenceStore.getState().setRemoteUsers([]);
    expect(usePresenceStore.getState().remoteUsers.size).toBe(0);
  });
});

// ─── clearRemoteUsers ─────────────────────────────────────────────────────────

describe('clearRemoteUsers', () => {
  it('empties the remoteUsers map', () => {
    usePresenceStore.getState().addRemoteUser(makeBoardUserInfo({ userId: 'user-1' }) as any);
    usePresenceStore.getState().clearRemoteUsers();
    expect(usePresenceStore.getState().remoteUsers.size).toBe(0);
  });
});
