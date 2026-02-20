export const CANVAS_CONFIG = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 20,
  DEFAULT_ZOOM: 1,
  ZOOM_STEP: 0.1,

  // Edge-of-canvas auto-scroll (when dragging objects near viewport edges)
  EDGE_SCROLL_THRESHOLD: 60,    // px from viewport edge to start scrolling
  EDGE_SCROLL_MIN_SPEED: 2,     // px/frame at outer threshold boundary
  EDGE_SCROLL_MAX_SPEED: 15,    // px/frame at very edge (speed cap)
} as const;

export const THROTTLE_CONFIG = {
  CURSOR_MOVE_MS: 50, // 20 events/sec
  OBJECT_MOVING_MS: 100, // 10 events/sec during drag
  TEXT_INPUT_MS: 150, // ~7 events/sec while typing (live text broadcast)
} as const;

export const DEFAULT_PORT = 3001;
