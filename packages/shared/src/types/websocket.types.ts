import { BoardObject } from './board.types';

// WebSocket event names as enums (prevents typos)
export enum WebSocketEvent {
  // Connection
  BOARD_JOIN = 'board:join',
  BOARD_LEAVE = 'board:leave',
  BOARD_JOINED = 'board:joined',
  BOARD_STATE = 'board:state',
  BOARD_ERROR = 'board:error',
  BOARD_REQUEST_SYNC = 'board:request_sync',
  BOARD_SYNC_RESPONSE = 'board:sync_response',

  // Presence
  USER_JOINED = 'user:joined',
  USER_LEFT = 'user:left',

  // Cursors
  CURSOR_MOVE = 'cursor:move',
  CURSOR_MOVED = 'cursor:moved',

  // Objects
  OBJECT_CREATE = 'object:create',
  OBJECT_CREATED = 'object:created',
  OBJECT_UPDATE = 'object:update',
  OBJECT_UPDATED = 'object:updated',
  OBJECT_DELETE = 'object:delete',
  OBJECT_DELETED = 'object:deleted',
  OBJECTS_BATCH_UPDATE = 'objects:batch_update',

  // Editing / Conflict
  EDIT_START = 'edit:start',
  EDIT_END = 'edit:end',
  CONFLICT_WARNING = 'conflict:warning',
  SYNC_CONFLICT = 'sync:conflict',

  // Heartbeat
  HEARTBEAT = 'heartbeat',

  // Error
  ERROR = 'error',
}

// --- Payload types ---

export interface BoardJoinPayload {
  boardId: string;
}

export interface BoardLeavePayload {
  boardId: string;
}

export interface BoardStatePayload {
  boardId: string;
  objects: BoardObject[];
  users: BoardUserInfo[];
}

export interface BoardUserInfo {
  userId: string;
  name: string;
  avatar: string;
  color: string;
}

export interface CursorMovePayload {
  boardId: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface CursorMovedPayload {
  boardId: string;
  userId: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface ObjectCreatePayload {
  boardId: string;
  object: Omit<BoardObject, 'id' | 'createdAt' | 'updatedAt'>;
  timestamp: number;
}

export interface ObjectCreatedPayload {
  boardId: string;
  object: BoardObject;
  userId: string;
  timestamp: number;
}

export interface ObjectUpdatePayload {
  boardId: string;
  objectId: string;
  updates: Partial<BoardObject>;
  timestamp: number;
}

export interface ObjectUpdatedPayload {
  boardId: string;
  objectId: string;
  updates: Partial<BoardObject>;
  userId: string;
  timestamp: number;
}

export interface ObjectDeletePayload {
  boardId: string;
  objectId: string;
  timestamp: number;
}

export interface ObjectDeletedPayload {
  boardId: string;
  objectId: string;
  userId: string;
  timestamp: number;
}

export interface UserJoinedPayload {
  boardId: string;
  user: BoardUserInfo;
  timestamp: number;
}

export interface UserLeftPayload {
  boardId: string;
  userId: string;
  timestamp: number;
}

export interface ConflictWarningPayload {
  boardId: string;
  objectId: string;
  conflictingUserId: string;
  conflictingUserName: string;
  message: string;
  timestamp: number;
}

export interface HeartbeatPayload {
  boardId: string;
  timestamp: number;
}

export interface WebSocketErrorPayload {
  code: string;
  message: string;
  timestamp: number;
}
