/**
 * Non-blocking alternative to redis.keys().
 *
 * redis.keys() scans the entire keyspace in a single O(N) call,
 * blocking Redis for all other clients. redis.scan() iterates
 * in batches of ~100 keys per round-trip, never blocking.
 */

import { instrumentedRedis as redis } from './instrumentedRedis';

export async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}
