/**
 * Instrumented Redis client that counts all operations in metricsService.
 *
 * Uses a Proxy to intercept method calls on the raw ioredis instance.
 * A `_insideMetrics` flag prevents recursive counting when
 * metricsService itself calls Redis (HINCRBY for storing counters).
 *
 * Usage:
 *   import { instrumentedRedis as redis } from '../utils/instrumentedRedis';
 *   // Use exactly like the raw redis client — all calls are tracked.
 *
 * For metricsService's own use (to avoid recursion):
 *   import { rawRedis } from '../utils/instrumentedRedis';
 */

import { redis as rawRedis } from './redis';
import { metricsService } from '../services/metricsService';

export { rawRedis };

// Commands to track
const TRACKED_COMMANDS = new Set([
  'get', 'set', 'setex', 'del', 'incr', 'expire',
  'keys', 'pipeline', 'hset', 'hget', 'hgetall',
  'hincrby', 'hdel', 'exists', 'ttl', 'mget',
  'eval', 'scan',
]);

// Flag to prevent recursive instrumentation
let _insideMetrics = false;

/**
 * Set the metrics guard flag. Used by metricsService to prevent
 * its own Redis calls from being counted recursively.
 */
export function setMetricsGuard(value: boolean): void {
  _insideMetrics = value;
}

/**
 * Instrumented Redis client — Proxy-based wrapper.
 * Automatically counts all Redis commands for metrics.
 */
export const instrumentedRedis = new Proxy(rawRedis, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);

    if (
      typeof prop === 'string' &&
      typeof value === 'function' &&
      TRACKED_COMMANDS.has(prop.toLowerCase()) &&
      !_insideMetrics
    ) {
      return function (this: typeof target, ...args: unknown[]) {
        const command = prop.toUpperCase();
        metricsService.incrementRedisOp(command);

        const start = Date.now();
        const result = (value as (...a: unknown[]) => unknown).apply(this, args);

        // If it returns a promise, track latency on resolution
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(() => {
            metricsService.recordRedisLatency(command, Date.now() - start);
          }).catch(() => {
            metricsService.recordRedisLatency(command, Date.now() - start);
          });
        }

        return result;
      };
    }

    return value;
  },
});
