export interface Board {
  id: string;
  ownerId: string;
  title: string;
  objects: BoardObject[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
  isDeleted: boolean;
  deletedAt: Date | null;
  slot: number;
}

export interface BoardVersion {
  id: string;
  boardId: string;
  snapshot: BoardObject[];
  createdBy: string;
  createdAt: Date;
  label: string | null;
}

// --- Board Objects ---

export type BoardObjectType = 'sticky' | 'shape' | 'frame' | 'connector' | 'text' | 'line';

export interface BaseObject {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  frameId: string | null; // Parent frame ID (null = not anchored)
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastEditedBy: string;
  /** Canvas stacking order. Lower = behind, higher = in front. */
  zIndex?: number;
  /**
   * How this object was created. Omitted or 'manual' for human-created objects.
   * 'ai' indicates the object was created by the AI agent (Tacky) on behalf of
   * the user identified by createdBy.
   */
  createdVia?: 'manual' | 'ai';
}

export interface StickyNote extends BaseObject {
  type: 'sticky';
  text: string;
  color: string; // Hex color
  width: number;
  height: number;
}

export type ShapeType = 'rectangle' | 'circle' | 'line' | 'arrow' | 'star' | 'triangle' | 'diamond';

export type StickySize = 'small' | 'medium' | 'large';

export interface Shape extends BaseObject {
  type: 'shape';
  shapeType: ShapeType;
  width: number;
  height: number;
  color: string; // Solid fill color
  rotation: number; // Degrees
}

export interface Frame extends BaseObject {
  type: 'frame';
  title: string;
  width: number;
  height: number;
  color: string; // Border color
  locked: boolean; // Whether children are anchored
}

// --- Standalone Line styling ---

export type LineEndpointStyle = 'none' | 'arrow-end' | 'arrow-both';
export type LineStrokePattern = 'solid' | 'dashed';
export type LineStrokeWeight = 'normal' | 'bold' | 'double' | 'triple';

export interface Line extends BaseObject {
  type: 'line';
  x2: number;
  y2: number;
  color: string;
  endpointStyle: LineEndpointStyle;
  strokePattern: LineStrokePattern;
  strokeWeight: LineStrokeWeight;
}

// --- Connector (relationship connector with object attachment) ---

export type ConnectorStyle = 'line' | 'arrow';

/**
 * Normalized anchor point on an object, in the object's local (unrotated) space.
 * rx/ry are normalized relative to the object's center and half-dimensions:
 *   rx = (localX - centerX) / halfWidth
 *   ry = (localY - centerY) / halfHeight
 *
 * Examples for a rectangle:
 *   Center         = { rx:  0, ry:  0 }
 *   Right edge mid = { rx:  1, ry:  0 }
 *   Top edge mid   = { rx:  0, ry: -1 }
 *   Bottom-left    = { rx: -1, ry:  1 }
 */
export interface AnchorPoint {
  rx: number;
  ry: number;
}

export interface Connector extends BaseObject {
  type: 'connector';
  fromObjectId: string;
  toObjectId: string;
  /** Where on fromObject the start endpoint attaches (null = center or unattached) */
  fromAnchor?: AnchorPoint | null;
  /** Where on toObject the end endpoint attaches (null = center or unattached) */
  toAnchor?: AnchorPoint | null;
  style: ConnectorStyle;
  color: string;
  /** Endpoint x-coordinate (start point is BaseObject.x/y) */
  x2: number;
  /** Endpoint y-coordinate */
  y2: number;
}

export interface TextElement extends BaseObject {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  fontFamily?: string; // Web-safe font family (defaults to system font stack if omitted)
  rotation?: number; // Degrees
  scaleX?: number;   // Preserve resize (Fabric.js uses scale, not width/height for IText)
  scaleY?: number;
}

export type BoardObject = StickyNote | Shape | Frame | Connector | TextElement | Line;

// --- Teleport Flags ---

export interface TeleportFlag {
  id: string;
  boardId: string;
  createdBy: string;
  label: string;
  x: number;
  y: number;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

// --- Cached Board State (Redis) ---

export interface CachedBoardState {
  objects: BoardObject[];
  postgresVersion: number;
  lastSyncedAt: number;
}
