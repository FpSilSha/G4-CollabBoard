export const TIER_LIMITS = {
  free: {
    BOARD_SLOTS: 2,
    OBJECTS_PER_BOARD: 100,
    VERSION_HISTORY: false,
    AI_COMMANDS_PER_10_MIN: 10,
  },
  team: {
    BOARD_SLOTS: 10,
    OBJECTS_PER_BOARD: 500,
    VERSION_HISTORY: true,
    AI_COMMANDS_PER_10_MIN: 50,
  },
  enterprise: {
    BOARD_SLOTS: Infinity,
    OBJECTS_PER_BOARD: 1000,
    VERSION_HISTORY: true,
    AI_COMMANDS_PER_10_MIN: Infinity,
  },
} as const;

export const RATE_LIMITS = {
  API_REQUESTS_PER_MINUTE: 100,
  AI_COMMANDS_PER_MINUTE: 10,
  OBJECT_CREATES_PER_MINUTE: 50,
  WEBSOCKET_MESSAGES_PER_SECOND: 60,
} as const;

export const WEBSOCKET_CONFIG = {
  PING_TIMEOUT: 30000,
  PING_INTERVAL: 25000,
  PRESENCE_TTL: 30,
  CURSOR_TTL: 5,
  HEARTBEAT_INTERVAL: 10000,
} as const;

export const PERSISTENCE_CONFIG = {
  AUTO_SAVE_INTERVAL_MS: 60000, // 60 seconds
  VERSION_SNAPSHOT_EVERY_N_SAVES: 5, // every 5th save = every 5 minutes
  MAX_VERSIONS_PER_BOARD: 50,
  SOFT_DELETE_RETENTION_DAYS: 30,
} as const;

export const EDIT_LOCK_CONFIG = {
  /** How long an edit lock persists after user disconnects (seconds). */
  LOCK_TTL_SECONDS: 20,
} as const;
