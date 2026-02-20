import { BoardObject, Board } from './board.types';
import { SubscriptionStatus, User } from './user.types';

// --- Auth ---

export interface AuthMeResponse {
  id: string;
  email: string;
  name: string;
  avatar: string;
  color: string;
  subscriptionStatus: SubscriptionStatus;
}

export interface UpdateProfileRequest {
  name: string;
}

// --- Boards ---

export interface BoardListResponse {
  ownedBoards: BoardSummary[];
  linkedBoards: BoardSummary[];
}

export interface BoardSummary {
  id: string;
  title: string;
  slot: number;
  lastAccessedAt: Date;
  objectCount: number;
  isDeleted: boolean;
  thumbnail: string | null;
  isOwned: boolean;
  ownerId: string;
}

export interface CreateBoardRequest {
  title: string;
}

export interface CreateBoardResponse {
  id: string;
  title: string;
  slot: number;
  objects: BoardObject[];
  createdAt: Date;
}

export interface BoardDetailResponse {
  id: string;
  title: string;
  slot: number;
  objects: BoardObject[];
  version: number;
  lastAccessedAt: Date;
}

export interface DeleteBoardResponse {
  success: boolean;
  deletedAt: Date;
  permanentDeletionAt: Date;
}

// --- Versions ---

export interface VersionListResponse {
  versions: VersionSummary[];
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  createdAt: Date;
  objectCount: number;
}

// --- Subscriptions (Phase 7 — deferred) ---

// --- API Error ---

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}
