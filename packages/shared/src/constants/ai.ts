// ============================================================
// AI Agent Constants
// ============================================================

export const AI_CONFIG = {
  MAX_COMMAND_LENGTH: 1000,
  MAX_TURNS: 3,
  DEFAULT_MODEL: 'claude-sonnet-4-20250514',
  MONTHLY_BUDGET_CENTS_DEFAULT: 1000,
  VIEWPORT_OBJECT_CAP: 50,
  CHAT_MAX_MESSAGES: 10,
  CHAT_HISTORY_TTL_SECONDS: 3600,
} as const;

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

/** Sonnet 4 pricing (as of 2025-05). */
export const SONNET_4_PRICING = {
  inputPerMillionTokens: 3.0,       // $3.00 per 1M input tokens
  outputPerMillionTokens: 15.0,     // $15.00 per 1M output tokens
} as const;
