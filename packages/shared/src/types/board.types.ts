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

export type BoardObjectType = 'sticky' | 'shape' | 'frame' | 'connector' | 'text';

export interface BaseObject {
  id: string;
  type: BoardObjectType;
  x: number;
  y: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  lastEditedBy: string;
}

export interface StickyNote extends BaseObject {
  type: 'sticky';
  text: string;
  color: string; // Hex color
  width: number;
  height: number;
}

export type ShapeType = 'rectangle' | 'circle' | 'line';

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
}

export type ConnectorStyle = 'line' | 'arrow';

export interface Connector extends BaseObject {
  type: 'connector';
  fromObjectId: string;
  toObjectId: string;
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
}

export type BoardObject = StickyNote | Shape | Frame | Connector | TextElement;

// --- Cached Board State (Redis) ---

export interface CachedBoardState {
  objects: BoardObject[];
  postgresVersion: number;
  lastSyncedAt: number;
}
