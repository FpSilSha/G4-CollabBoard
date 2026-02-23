/** Hard cap: maximum objects allowed on a single board. */
export const MAX_OBJECTS_PER_BOARD = 2000;

/** No board-slot cap — users can create unlimited boards. */
export const MAX_BOARDS_PER_USER = Infinity;

/** Per-tier limits for boards and objects. */
export const TIER_LIMITS = {
  FREE: { BOARD_SLOTS: 3, MAX_OBJECTS_PER_BOARD: 100 },
  TEAM: { BOARD_SLOTS: 10, MAX_OBJECTS_PER_BOARD: 500 },
  ENTERPRISE: { BOARD_SLOTS: Infinity, MAX_OBJECTS_PER_BOARD: 2000 },
} as const;

export const RATE_LIMITS = {
  API_REQUESTS_PER_MINUTE: 100,
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
