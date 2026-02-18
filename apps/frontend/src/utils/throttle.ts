/**
 * Throttle a function with leading + trailing execution.
 * Returns the throttled function with a `.cancel()` method
 * that cancels any pending trailing invocation.
 *
 * Per .clauderules:
 * - cursor:move throttled at THROTTLE_CONFIG.CURSOR_MOVE_MS (50ms)
 * - object:moving throttled at THROTTLE_CONFIG.OBJECT_MOVING_MS (100ms)
 * - On mouse:up, call cancel() then invoke the function directly
 *   (Final State Rule: unthrottled object:update on drag end).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  waitMs: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastCallTime = 0;
  let lastArgs: Parameters<T> | null = null;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastCallTime);

    if (remaining <= 0) {
      // Leading: execute immediately
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCallTime = now;
      fn(...args);
    } else {
      // Trailing: schedule for later
      lastArgs = args;
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          lastCallTime = Date.now();
          timeoutId = null;
          if (lastArgs) {
            fn(...lastArgs);
            lastArgs = null;
          }
        }, remaining);
      }
    }
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return throttled;
}
