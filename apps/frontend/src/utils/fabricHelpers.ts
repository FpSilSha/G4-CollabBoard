/**
 * Barrel re-export for fabricHelpers.
 *
 * All implementations have been extracted into focused modules:
 * - fabricStyleHelpers.ts    — colors, fonts, getStickyChildren, teleportTo, findFabricObjectById
 * - fabricShapeFactory.ts    — sticky, rectangle, circle, triangle, arrow, star, diamond, text, flag factories
 * - fabricFrameHelpers.ts    — frame factory + frame containment utilities
 * - fabricConnectorHelpers.ts — connector/line factories + endpoint controls + lock state
 * - fabricConversion.ts      — fabricToBoardObject, boardObjectToFabric
 *
 * This barrel preserves the original import paths so no consumer files need updating.
 */

// Style helpers & utilities
export {
  DEFAULT_SYSTEM_FONT,
  FLAG_COLORS,
  getObjectFillColor,
  getStickyChildren,
  updateStickyColor,
  updateFrameColor,
  darkenColor,
  hexToRgba,
  teleportTo,
  findFabricObjectById,
} from './fabricStyleHelpers';

// Shape factories
export {
  createStickyNote,
  createRectangle,
  createCircle,
  createTriangle,
  createArrow,
  createStar,
  createDiamond,
  createTextElement,
  createFlagMarker,
} from './fabricShapeFactory';

// Frame factory & utilities
export {
  createFrame,
  isObjectInsideFrame,
  frameHasFrameChildren,
  isFrameChild,
  getObjectsInsideFrame,
} from './fabricFrameHelpers';

// Connector & line factories + helpers
export {
  createConnector,
  createLine,
  applyConnectorLockState,
  syncConnectorCoordsAfterMove,
} from './fabricConnectorHelpers';

// Conversion utilities
export {
  fabricToBoardObject,
  boardObjectToFabric,
} from './fabricConversion';
