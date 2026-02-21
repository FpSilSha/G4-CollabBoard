// ============================================================
// AI Agent Constants
// ============================================================

export const AI_CONFIG = {
  MAX_COMMAND_LENGTH: 1000,
  /** @deprecated Use MAX_TURNS_SIMPLE / MAX_TURNS_COMPLEX instead */
  MAX_TURNS: 3,
  /** Max agent-loop turns for simple commands (Haiku). */
  MAX_TURNS_SIMPLE: 5,
  /** Max agent-loop turns for complex commands (Sonnet). */
  MAX_TURNS_COMPLEX: 7,
  DEFAULT_MODEL: 'claude-sonnet-4-6',
  MONTHLY_BUDGET_CENTS_DEFAULT: 1000,
  VIEWPORT_OBJECT_CAP: 50,
  CHAT_MAX_MESSAGES: 10,
  CHAT_HISTORY_TTL_SECONDS: 3600,
  /** Max object-creation operations per single AI command. */
  MAX_CREATIONS_PER_COMMAND: 50,
  /** Max total tool calls (create + update + delete + read) per command. */
  MAX_OPERATIONS_PER_COMMAND: 100,
} as const;

/**
 * Special userId used in WebSocket broadcast payloads for AI-created objects.
 * The frontend's optimistic-update guard skips events where payload.userId
 * matches the local user (assuming the user already placed the object locally).
 * AI-created objects are server-side only — they have NO local optimistic copy —
 * so we MUST use a distinct userId in the broadcast to avoid the skip.
 * The real user's Auth0 sub is still stored in createdBy/lastEditedBy on the object.
 */
export const AI_BROADCAST_USER_ID = 'system:ai-tacky';

export const AI_COLORS = {
  STICKY_YELLOW: '#FFEB3B',
  STICKY_PINK: '#F48FB1',
  STICKY_BLUE: '#90CAF9',
  STICKY_GREEN: '#A5D6A7',
  STICKY_ORANGE: '#FFCC80',
  STICKY_PURPLE: '#CE93D8',
  FRAME_DEFAULT: '#E0E0E0',
  CONNECTOR_DEFAULT: '#757575',
  TEXT_DEFAULT: '#212121',
} as const;

// ============================================================
// Model IDs & Pricing
// ============================================================

export const SONNET_MODEL_ID = 'claude-sonnet-4-6';
export const HAIKU_MODEL_ID = 'claude-haiku-4-5-20251001';

/** Sonnet 4.6 pricing (as of 2025-10). */
export const SONNET_4_PRICING = {
  inputPerMillionTokens: 3.0,       // $3.00 per 1M input tokens
  outputPerMillionTokens: 15.0,     // $15.00 per 1M output tokens
} as const;

/** Haiku 4.5 pricing (as of 2025-10). */
export const HAIKU_45_PRICING = {
  inputPerMillionTokens: 1.0,       // $1.00 per 1M input tokens
  outputPerMillionTokens: 5.0,      // $5.00 per 1M output tokens
} as const;
