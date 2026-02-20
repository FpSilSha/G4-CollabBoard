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

// ============================
// Tabbed color palettes (8 swatches each)
// ============================

/** Soft, muted pastels — high lightness, low-to-mid saturation */
export const PASTEL_COLORS = [
  '#FFF3B0', // Butter
  '#C8E6C9', // Mint
  '#BBDEFB', // Sky
  '#F8BBD0', // Blush
  '#FFE0B2', // Peach
  '#E1BEE7', // Lavender
  '#B2EBF2', // Aqua
  '#F0F4C3', // Lime
] as const;

/** Vivid, saturated neons — high saturation, mid lightness */
export const NEON_COLORS = [
  '#FFFF00', // Electric Yellow
  '#00FF7F', // Spring Green
  '#00CFFF', // Neon Cyan
  '#FF4081', // Hot Pink
  '#FF6D00', // Blaze Orange
  '#D500F9', // Neon Purple
  '#FF1744', // Neon Red
  '#76FF03', // Neon Lime
] as const;

/** Warm, natural earth tones — lower saturation, organic hues */
export const EARTH_TONE_COLORS = [
  '#D7CCC8', // Warm Grey
  '#BCAAA4', // Taupe
  '#A5D6A7', // Sage
  '#FFCC80', // Sand
  '#FFAB91', // Terracotta
  '#C5CAE9', // Slate Blue
  '#F5F5DC', // Beige
  '#CFD8DC', // Cool Grey
] as const;

/** WCAG-accessible colors — high contrast, colorblind-safe */
export const WCAG_COLORS = [
  '#FDD835', // Accessible Yellow
  '#66BB6A', // Accessible Green
  '#42A5F5', // Accessible Blue
  '#EF9A9A', // Accessible Red
  '#FFCC80', // Accessible Orange
  '#CE93D8', // Accessible Purple
  '#80DEEA', // Accessible Teal
  '#000000', // Black
] as const;

/** All tabbed palettes in display order */
export const COLOR_PALETTES = {
  pastel: PASTEL_COLORS,
  neon: NEON_COLORS,
  earth: EARTH_TONE_COLORS,
  wcag: WCAG_COLORS,
} as const;

/** Tab metadata for the color picker UI */
export const COLOR_PALETTE_TABS = [
  { key: 'pastel', shortLabel: 'PST', fullLabel: 'Pastel' },
  { key: 'neon', shortLabel: 'NEO', fullLabel: 'Neon' },
  { key: 'earth', shortLabel: 'ERT', fullLabel: 'Earth Tones' },
  { key: 'wcag', shortLabel: 'WCA', fullLabel: 'WCAG/Accessible' },
] as const;

/** HSL slider constraints for the custom color popover */
export const HSL_CONSTRAINTS = {
  pastel: { hMin: 0, hMax: 360, sMin: 20, sMax: 60, lMin: 70, lMax: 95 },
  neon:   { hMin: 0, hMax: 360, sMin: 80, sMax: 100, lMin: 40, lMax: 65 },
  earth:  { hMin: 0, hMax: 360, sMin: 15, sMax: 55, lMin: 20, lMax: 65 },
  none:   { hMin: 0, hMax: 360, sMin: 0,  sMax: 100, lMin: 0,  lMax: 100 },
} as const;

export type ColorPaletteKey = keyof typeof COLOR_PALETTES;
export type HslConstraintKey = keyof typeof HSL_CONSTRAINTS;

// UI chrome colors (sidebar, header, canvas)
export const UI_COLORS = {
  CANVAS_BG: '#F0F2F5',
  SIDEBAR_BG: '#E5E8EE',
  SIDEBAR_BORDER: '#D5D9E2',
  FOCUS_BLUE: '#007AFF',
  DOT_GRID_COLOR: '#9AA3B2',
  DOT_GRID_SPACING: 20,
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
