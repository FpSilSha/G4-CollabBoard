import { BoardObject, Board } from './board.types';
import { SubscriptionTier, SubscriptionStatus, User } from './user.types';

// --- Auth ---

export interface AuthMeResponse {
  id: string;
  email: string;
  name: string;
  avatar: string;
  color: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
}

export interface UpdateProfileRequest {
  name: string;
}

// --- Boards ---

export interface BoardListResponse {
  boards: BoardSummary[];
  slots: {
    used: number;
    total: number;
    tier: SubscriptionTier;
  };
}

export interface BoardSummary {
  id: string;
  title: string;
  slot: number;
  lastAccessedAt: Date;
  objectCount: number;
  isDeleted: boolean;
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

// --- Subscriptions ---

export interface SubscriptionStatusResponse {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  limits: {
    boardSlots: number;
    aiCommands: number;
    maxObjectsPerBoard: number;
  };
}

export interface CheckoutRequest {
  tier: 'team' | 'enterprise';
}

export interface CheckoutResponse {
  checkoutUrl: string;
}

// --- API Error ---

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}
