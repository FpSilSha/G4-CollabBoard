export type SubscriptionTier = 'free' | 'team' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string; // 3-letter initials
  color: string; // Hex color for cursor/selections
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Presence {
  userId: string;
  boardId: string;
  userName: string;
  userColor: string;
  avatar: string; // 3-letter initials
  connectedAt: Date;
}

export interface CursorPosition {
  userId: string;
  boardId: string;
  x: number;
  y: number;
  timestamp: number;
}
