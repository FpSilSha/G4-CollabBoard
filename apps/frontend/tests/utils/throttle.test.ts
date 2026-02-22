import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { throttle } from '../../src/utils/throttle';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Leading edge (immediate execution) ──────────────────────────────────────

describe('throttle — leading edge', () => {
  it('executes immediately on the first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('arg1');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('arg1');
  });

  it('passes arguments correctly on leading call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('hello', 42, true);

    expect(fn).toHaveBeenCalledWith('hello', 42, true);
  });
});

// ─── Trailing edge (scheduling) ───────────────────────────────────────────────

describe('throttle — trailing edge', () => {
  it('does not execute second call immediately within wait period', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');  // Leading — executes now
    fn.mockClear();

    vi.advanceTimersByTime(50); // Still within wait
    throttled('second');

    // Should not have fired yet
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('executes trailing call after wait period elapses', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');  // Leading
    fn.mockClear();

    vi.advanceTimersByTime(50);
    throttled('trailing');

    vi.advanceTimersByTime(60); // Total 110ms — trailing fires

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('trailing');
  });

  it('trailing call uses the LATEST args from multiple rapid calls', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');   // Leading
    fn.mockClear();

    vi.advanceTimersByTime(20);
    throttled('second');  // Trailing candidate 1

    vi.advanceTimersByTime(20);
    throttled('third');   // Trailing candidate 2 (overwrites second)

    vi.advanceTimersByTime(20);
    throttled('fourth');  // Trailing candidate 3 (overwrites third)

    // Advance enough for the original trailing timer to fire
    vi.advanceTimersByTime(70);

    // Only one trailing call, with the latest args
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('fourth');
  });

  it('allows a new leading call after wait period expires with no trailing', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');  // Leading
    vi.advanceTimersByTime(150); // Wait fully expired

    throttled('second'); // Should execute immediately (leading again)

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'first');
    expect(fn).toHaveBeenNthCalledWith(2, 'second');
  });
});

// ─── Multiple rapid calls ─────────────────────────────────────────────────────

describe('throttle — multiple rapid calls', () => {
  it('only first (leading) and last (trailing) execute for a burst', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // Burst of 5 calls within 10ms
    throttled('call-1'); // Leading
    vi.advanceTimersByTime(10);
    throttled('call-2');
    vi.advanceTimersByTime(10);
    throttled('call-3');
    vi.advanceTimersByTime(10);
    throttled('call-4');
    vi.advanceTimersByTime(10);
    throttled('call-5'); // Will be the trailing args

    // Advance past the trailing delay
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 'call-1');
    expect(fn).toHaveBeenNthCalledWith(2, 'call-5');
  });

  it('executes only once (leading) when all calls happen at exact time 0', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    // All 5 calls at time=0 (fake timers don't advance between synchronous calls)
    throttled('a');
    throttled('b');
    throttled('c');
    throttled('d');
    throttled('e');

    // 'a' is the leading call. b-e set lastArgs='e' on the same timer.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    // Advance to let the trailing fire
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(2, 'e');
  });
});

// ─── cancel() ────────────────────────────────────────────────────────────────

describe('throttle — cancel()', () => {
  it('cancels a pending trailing call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');   // Leading executes immediately
    vi.advanceTimersByTime(50);
    throttled('trailing'); // Schedules trailing
    fn.mockClear();

    throttled.cancel();   // Cancel before trailing fires

    vi.advanceTimersByTime(100);

    // Trailing should NOT have fired
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('does not throw when cancel is called with no pending call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    expect(() => throttled.cancel()).not.toThrow();
  });

  it('allows new calls to execute normally after cancel', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    vi.advanceTimersByTime(50);
    throttled('trailing');
    throttled.cancel();
    fn.mockClear();

    // Now advance past the wait period
    vi.advanceTimersByTime(100);

    // Next call should be treated as a fresh leading call
    throttled('fresh');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('fresh');
  });

  it('is available as a property on the returned throttled function', () => {
    const throttled = throttle(vi.fn(), 100);
    expect(typeof throttled.cancel).toBe('function');
  });
});

// ─── Wait period boundary behavior ───────────────────────────────────────────

describe('throttle — wait period boundaries', () => {
  it('exact wait period elapsed allows new leading call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    vi.advanceTimersByTime(100); // Exactly 100ms

    fn.mockClear();
    throttled('second');

    // Should fire immediately as leading
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('works with very short wait periods (1ms)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 1);

    throttled('a'); // Leading
    vi.advanceTimersByTime(2); // Past wait

    throttled('b'); // Leading again
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('works with longer wait periods (500ms)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 500);

    throttled('first');
    fn.mockClear();

    vi.advanceTimersByTime(200);
    throttled('trailing');

    vi.advanceTimersByTime(350); // Total 550ms from start, trailing should have fired

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('trailing');
  });
});

// ─── Return type ─────────────────────────────────────────────────────────────

describe('throttle — return type', () => {
  it('returns a function', () => {
    const throttled = throttle(vi.fn(), 100);
    expect(typeof throttled).toBe('function');
  });

  it('has a cancel method on the returned function', () => {
    const throttled = throttle(vi.fn(), 100);
    expect(typeof throttled.cancel).toBe('function');
  });
});
