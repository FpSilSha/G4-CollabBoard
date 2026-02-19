export const CANVAS_CONFIG = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 20,
  DEFAULT_ZOOM: 1,
  ZOOM_STEP: 0.1,
} as const;

export const THROTTLE_CONFIG = {
  CURSOR_MOVE_MS: 50, // 20 events/sec
  OBJECT_MOVING_MS: 100, // 10 events/sec during drag
  TEXT_INPUT_MS: 150, // ~7 events/sec while typing (live text broadcast)
} as const;

export const DEFAULT_PORT = 3001;
