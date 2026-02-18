import { USER_COLORS } from 'shared';

/**
 * Generate a deterministic color from a user ID string.
 * Uses FNV-1a hash for better distribution — the old Java-style hashCode
 * produced collisions for Auth0 IDs with similar prefixes (e.g.,
 * "google-oauth2|1100..." and "google-oauth2|1084..." both mapped to green).
 */
export function generateColorFromUserId(userId: string): string {
  // FNV-1a 32-bit hash — much better avalanche behavior
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  const index = Math.abs(hash) % USER_COLORS.length;
  return USER_COLORS[index];
}

/**
 * Generate a 2-3 letter avatar from a display name.
 * E.g., "Jane Doe" -> "JD", "Alice" -> "AL"
 */
export function generateAvatar(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
