import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore } from '../../src/stores/boardStore';
import { makeBoardObject } from '../mocks/factories';
import type { BoardObject } from 'shared';

// ─── Reset helpers ────────────────────────────────────────────────────────────

const INITIAL_STATE: Parameters<typeof useBoardStore.setState>[0] = {
  canvas: null,
  boardId: null,
  boardTitle: 'Untitled Board',
  boardOwnerId: null,
  boardVersion: 0,
  maxObjectsPerBoard: 2000,
  objects: new Map(),
  editingObjectId: null,
  editingOriginalText: null,
  finishEditingFn: null,
  concurrentEditors: [],
  thumbnailUpdatedAt: null,
  boardStateLoaded: false,
  cachedAuthToken: null,
  zoom: 1,
  viewportVersion: 0,
};

beforeEach(() => {
  useBoardStore.setState(INITIAL_STATE as any);
});

// ─── setObjects ───────────────────────────────────────────────────────────────

describe('setObjects', () => {
  it('replaces the objects map from an array', () => {
    const obj1 = makeBoardObject({ id: 'id-1' }) as BoardObject;
    const obj2 = makeBoardObject({ id: 'id-2' }) as BoardObject;

    useBoardStore.getState().setObjects([obj1, obj2]);

    const state = useBoardStore.getState();
    expect(state.objects.size).toBe(2);
    expect(state.objects.has('id-1')).toBe(true);
    expect(state.objects.has('id-2')).toBe(true);
  });

  it('clears existing objects when called with empty array', () => {
    const obj = makeBoardObject({ id: 'id-1' }) as BoardObject;
    useBoardStore.getState().addObject(obj);
    useBoardStore.getState().setObjects([]);

    expect(useBoardStore.getState().objects.size).toBe(0);
  });

  it('replaces old objects with new ones (does not merge)', () => {
    useBoardStore.getState().setObjects([makeBoardObject({ id: 'old-id' }) as BoardObject]);
    useBoardStore.getState().setObjects([makeBoardObject({ id: 'new-id' }) as BoardObject]);

    const state = useBoardStore.getState();
    expect(state.objects.has('old-id')).toBe(false);
    expect(state.objects.has('new-id')).toBe(true);
  });
});

// ─── addObject ────────────────────────────────────────────────────────────────

describe('addObject', () => {
  it('adds an object to the map', () => {
    const obj = makeBoardObject({ id: 'obj-abc' }) as BoardObject;
    useBoardStore.getState().addObject(obj);

    expect(useBoardStore.getState().objects.has('obj-abc')).toBe(true);
    expect(useBoardStore.getState().objects.get('obj-abc')).toEqual(obj);
  });

  it('can add multiple objects independently', () => {
    const obj1 = makeBoardObject({ id: 'id-1' }) as BoardObject;
    const obj2 = makeBoardObject({ id: 'id-2' }) as BoardObject;
    useBoardStore.getState().addObject(obj1);
    useBoardStore.getState().addObject(obj2);

    expect(useBoardStore.getState().objects.size).toBe(2);
  });

  it('overwrites an existing object if same id is added', () => {
    const original = makeBoardObject({ id: 'id-1', text: 'Original' }) as BoardObject;
    const replacement = makeBoardObject({ id: 'id-1', text: 'Replaced' }) as BoardObject;
    useBoardStore.getState().addObject(original);
    useBoardStore.getState().addObject(replacement);

    expect(useBoardStore.getState().objects.get('id-1')!.text).toBe('Replaced');
    expect(useBoardStore.getState().objects.size).toBe(1);
  });
});

// ─── updateObject ─────────────────────────────────────────────────────────────

describe('updateObject', () => {
  it('merges updates into the existing object', () => {
    const obj = makeBoardObject({ id: 'id-1', text: 'Before', x: 10 }) as BoardObject;
    useBoardStore.getState().addObject(obj);

    useBoardStore.getState().updateObject('id-1', { text: 'After', x: 99 });

    const updated = useBoardStore.getState().objects.get('id-1')!;
    expect(updated.text).toBe('After');
    expect(updated.x).toBe(99);
  });

  it('preserves fields not included in the update', () => {
    const obj = makeBoardObject({ id: 'id-1', x: 10, y: 20, color: '#FF0000' }) as BoardObject;
    useBoardStore.getState().addObject(obj);

    useBoardStore.getState().updateObject('id-1', { x: 999 });

    const updated = useBoardStore.getState().objects.get('id-1')!;
    expect(updated.y).toBe(20);
    expect(updated.color).toBe('#FF0000');
  });

  it('is a no-op when id does not exist — array unchanged', () => {
    const obj = makeBoardObject({ id: 'id-1' }) as BoardObject;
    useBoardStore.getState().addObject(obj);

    useBoardStore.getState().updateObject('nonexistent-id', { text: 'Should not appear' });

    // Map should still have only the original object
    expect(useBoardStore.getState().objects.size).toBe(1);
    expect(useBoardStore.getState().objects.has('nonexistent-id')).toBe(false);
  });

  it('does not crash on update when objects map is empty', () => {
    expect(() =>
      useBoardStore.getState().updateObject('ghost-id', { text: 'ghost' })
    ).not.toThrow();
  });
});

// ─── removeObject ─────────────────────────────────────────────────────────────

describe('removeObject', () => {
  it('removes an object by id', () => {
    const obj = makeBoardObject({ id: 'id-1' }) as BoardObject;
    useBoardStore.getState().addObject(obj);
    useBoardStore.getState().removeObject('id-1');

    expect(useBoardStore.getState().objects.has('id-1')).toBe(false);
  });

  it('does not remove other objects', () => {
    useBoardStore.getState().addObject(makeBoardObject({ id: 'id-1' }) as BoardObject);
    useBoardStore.getState().addObject(makeBoardObject({ id: 'id-2' }) as BoardObject);
    useBoardStore.getState().removeObject('id-1');

    expect(useBoardStore.getState().objects.has('id-2')).toBe(true);
  });

  it('is a no-op for a nonexistent id', () => {
    useBoardStore.getState().addObject(makeBoardObject({ id: 'id-1' }) as BoardObject);
    expect(() => useBoardStore.getState().removeObject('ghost')).not.toThrow();
    expect(useBoardStore.getState().objects.size).toBe(1);
  });
});

// ─── removeObjects (bulk) ─────────────────────────────────────────────────────

describe('removeObjects', () => {
  it('removes multiple objects by ids', () => {
    useBoardStore.getState().addObject(makeBoardObject({ id: 'a' }) as BoardObject);
    useBoardStore.getState().addObject(makeBoardObject({ id: 'b' }) as BoardObject);
    useBoardStore.getState().addObject(makeBoardObject({ id: 'c' }) as BoardObject);

    useBoardStore.getState().removeObjects(['a', 'c']);

    const state = useBoardStore.getState();
    expect(state.objects.has('a')).toBe(false);
    expect(state.objects.has('b')).toBe(true);
    expect(state.objects.has('c')).toBe(false);
  });

  it('is a no-op for an empty ids array', () => {
    useBoardStore.getState().addObject(makeBoardObject({ id: 'a' }) as BoardObject);
    useBoardStore.getState().removeObjects([]);
    expect(useBoardStore.getState().objects.size).toBe(1);
  });
});

// ─── setCanvas ────────────────────────────────────────────────────────────────

describe('setCanvas', () => {
  it('stores the canvas reference', () => {
    const mockCanvas = { add: () => {} } as any;
    useBoardStore.getState().setCanvas(mockCanvas);
    expect(useBoardStore.getState().canvas).toBe(mockCanvas);
  });

  it('can set canvas to null (unmount)', () => {
    useBoardStore.getState().setCanvas({ add: () => {} } as any);
    useBoardStore.getState().setCanvas(null);
    expect(useBoardStore.getState().canvas).toBeNull();
  });
});

// ─── setBoardTitle ────────────────────────────────────────────────────────────

describe('setBoardTitle', () => {
  it('updates boardTitle', () => {
    useBoardStore.getState().setBoardTitle('My Awesome Board');
    expect(useBoardStore.getState().boardTitle).toBe('My Awesome Board');
  });

  it('handles empty string title', () => {
    useBoardStore.getState().setBoardTitle('');
    expect(useBoardStore.getState().boardTitle).toBe('');
  });
});

// ─── setBoardId / setBoardOwnerId / setBoardVersion ───────────────────────────

describe('board metadata setters', () => {
  it('setBoardId updates boardId', () => {
    useBoardStore.getState().setBoardId('board-xyz');
    expect(useBoardStore.getState().boardId).toBe('board-xyz');
  });

  it('setBoardId can set to null', () => {
    useBoardStore.getState().setBoardId('board-xyz');
    useBoardStore.getState().setBoardId(null);
    expect(useBoardStore.getState().boardId).toBeNull();
  });

  it('setBoardOwnerId updates boardOwnerId', () => {
    useBoardStore.getState().setBoardOwnerId('owner-123');
    expect(useBoardStore.getState().boardOwnerId).toBe('owner-123');
  });

  it('setBoardVersion updates boardVersion', () => {
    useBoardStore.getState().setBoardVersion(42);
    expect(useBoardStore.getState().boardVersion).toBe(42);
  });
});

// ─── clearObjects ─────────────────────────────────────────────────────────────

describe('clearObjects', () => {
  it('empties the objects map', () => {
    useBoardStore.getState().addObject(makeBoardObject({ id: 'id-1' }) as BoardObject);
    useBoardStore.getState().addObject(makeBoardObject({ id: 'id-2' }) as BoardObject);
    useBoardStore.getState().clearObjects();
    expect(useBoardStore.getState().objects.size).toBe(0);
  });
});

// ─── concurrentEditors ────────────────────────────────────────────────────────

describe('concurrentEditors', () => {
  it('addConcurrentEditor adds an editor to the list', () => {
    useBoardStore.getState().addConcurrentEditor({ userId: 'user-2', userName: 'Bob' });
    expect(useBoardStore.getState().concurrentEditors).toHaveLength(1);
    expect(useBoardStore.getState().concurrentEditors[0].userId).toBe('user-2');
  });

  it('addConcurrentEditor does not add a duplicate', () => {
    useBoardStore.getState().addConcurrentEditor({ userId: 'user-2', userName: 'Bob' });
    useBoardStore.getState().addConcurrentEditor({ userId: 'user-2', userName: 'Bob Again' });
    expect(useBoardStore.getState().concurrentEditors).toHaveLength(1);
  });

  it('removeConcurrentEditor removes by userId', () => {
    useBoardStore.getState().addConcurrentEditor({ userId: 'user-2', userName: 'Bob' });
    useBoardStore.getState().removeConcurrentEditor('user-2');
    expect(useBoardStore.getState().concurrentEditors).toHaveLength(0);
  });

  it('setConcurrentEditors replaces the list', () => {
    useBoardStore.getState().addConcurrentEditor({ userId: 'user-2', userName: 'Bob' });
    useBoardStore.getState().setConcurrentEditors([{ userId: 'user-3', userName: 'Carol' }]);
    const editors = useBoardStore.getState().concurrentEditors;
    expect(editors).toHaveLength(1);
    expect(editors[0].userId).toBe('user-3');
  });
});

// ─── bumpViewportVersion ──────────────────────────────────────────────────────

describe('bumpViewportVersion', () => {
  it('increments viewportVersion by 1 on each call', () => {
    expect(useBoardStore.getState().viewportVersion).toBe(0);
    useBoardStore.getState().bumpViewportVersion();
    expect(useBoardStore.getState().viewportVersion).toBe(1);
    useBoardStore.getState().bumpViewportVersion();
    expect(useBoardStore.getState().viewportVersion).toBe(2);
  });
});

// ─── setZoom ──────────────────────────────────────────────────────────────────

describe('setZoom', () => {
  it('updates zoom value', () => {
    useBoardStore.getState().setZoom(2.5);
    expect(useBoardStore.getState().zoom).toBe(2.5);
  });
});

// ─── remaining setters ────────────────────────────────────────────────────────

describe('remaining setters', () => {
  it('setMaxObjectsPerBoard updates maxObjectsPerBoard', () => {
    useBoardStore.getState().setMaxObjectsPerBoard(500);
    expect(useBoardStore.getState().maxObjectsPerBoard).toBe(500);
  });

  it('setEditingObjectId updates editingObjectId', () => {
    useBoardStore.getState().setEditingObjectId('obj-99');
    expect(useBoardStore.getState().editingObjectId).toBe('obj-99');
  });

  it('setEditingOriginalText updates editingOriginalText', () => {
    useBoardStore.getState().setEditingOriginalText('original text');
    expect(useBoardStore.getState().editingOriginalText).toBe('original text');
  });

  it('setFinishEditingFn stores and calls the function', () => {
    const fn = vi.fn();
    useBoardStore.getState().setFinishEditingFn(fn);
    expect(useBoardStore.getState().finishEditingFn).toBe(fn);
    useBoardStore.getState().finishEditingFn!(false);
    expect(fn).toHaveBeenCalledWith(false);
  });

  it('setThumbnailUpdatedAt updates thumbnailUpdatedAt', () => {
    useBoardStore.getState().setThumbnailUpdatedAt('2024-01-01T00:00:00Z');
    expect(useBoardStore.getState().thumbnailUpdatedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('setBoardStateLoaded updates boardStateLoaded', () => {
    useBoardStore.getState().setBoardStateLoaded(true);
    expect(useBoardStore.getState().boardStateLoaded).toBe(true);
  });

  it('setCachedAuthToken updates cachedAuthToken', () => {
    useBoardStore.getState().setCachedAuthToken('token-abc');
    expect(useBoardStore.getState().cachedAuthToken).toBe('token-abc');
  });
});
