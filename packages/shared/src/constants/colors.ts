// High-energy presence colors - assigned based on user ID hash
// Used for cursor colors, selection outlines of other users, presence indicators
export const USER_COLORS = [
  '#E6194B', // Electric Red
  '#3CB44B', // Vivid Green
  '#FFE119', // Sunny Yellow
  '#4363D8', // Bright Blue
  '#F58231', // Safety Orange
  '#911EB4', // Royal Purple
  '#42D4F4', // Electric Cyan
  '#F032E6', // Hot Magenta
  '#BFEF45', // Lime Punch
  '#469990', // Deep Teal
] as const;

/** Semantic alias for frontend cursor/presence usage */
export const PRESENCE_COLORS = USER_COLORS;

// Default sticky note colors
export const STICKY_NOTE_COLORS = [
  '#FFEB3B', // Yellow
  '#FF9800', // Orange
  '#F44336', // Red
  '#E91E63', // Pink
  '#9C27B0', // Purple
  '#3F51B5', // Indigo
  '#2196F3', // Blue
  '#00BCD4', // Cyan
  '#4CAF50', // Green
  '#8BC34A', // Light Green
] as const;

// Default shape colors
export const SHAPE_COLORS = [
  '#000000', // Black
  '#FFFFFF', // White
  '#FF0000', // Red
  '#00FF00', // Green
  '#0000FF', // Blue
  '#FFFF00', // Yellow
  '#FF00FF', // Magenta
  '#00FFFF', // Cyan
] as const;

// UI chrome colors (sidebar, header, canvas)
export const UI_COLORS = {
  CANVAS_BG: '#2A2A2E',
  SIDEBAR_BG: '#70726F',
  SIDEBAR_BORDER: '#333333',
  FOCUS_BLUE: '#007AFF',
  DOT_GRID_COLOR: '#FFFFFF',
  DOT_GRID_SPACING: 20,
  DOT_GRID_OPACITY: 0.12,
} as const;

// Default dimensions for new objects
export const OBJECT_DEFAULTS = {
  STICKY_WIDTH: 200,
  STICKY_HEIGHT: 200,
  SHAPE_WIDTH: 150,
  SHAPE_HEIGHT: 150,
  STICKY_FONT_SIZE: 14,
  STICKY_PADDING: 10,
} as const;
