import { describe, it, expect } from 'vitest';
import { generateLocalId } from '../../src/utils/idGenerator';

// The UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
// where y is one of [89ab]
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('generateLocalId', () => {
  it('returns a string', () => {
    const id = generateLocalId();
    expect(typeof id).toBe('string');
  });

  it('returns a valid UUID v4 format', () => {
    const id = generateLocalId();
    expect(id).toMatch(UUID_REGEX);
  });

  it('returns unique IDs on successive calls', () => {
    const id1 = generateLocalId();
    const id2 = generateLocalId();
    expect(id1).not.toBe(id2);
  });

  it('returns unique IDs across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateLocalId());
    }
    // All 50 IDs should be unique
    expect(ids.size).toBe(50);
  });

  it('always has the version digit 4 at position 14 (UUID v4)', () => {
    for (let i = 0; i < 10; i++) {
      const id = generateLocalId();
      // Position 14 in a UUID string is the version digit (after 8+1+4+1 = 14 chars)
      expect(id[14]).toBe('4');
    }
  });

  it('returns a string with length 36 (standard UUID format)', () => {
    const id = generateLocalId();
    expect(id.length).toBe(36);
  });

  it('contains the expected hyphen positions', () => {
    const id = generateLocalId();
    expect(id[8]).toBe('-');
    expect(id[13]).toBe('-');
    expect(id[18]).toBe('-');
    expect(id[23]).toBe('-');
  });
});
