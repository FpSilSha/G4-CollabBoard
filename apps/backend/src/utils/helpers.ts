import { USER_COLORS } from 'shared';

/**
 * Generate a deterministic color from a user ID string.
 * Uses a simple hash to pick from the USER_COLORS palette.
 */
export function generateColorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
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
