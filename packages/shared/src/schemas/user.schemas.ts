import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).trim(),
});

export const SubscriptionTierSchema = z.enum(['free', 'team', 'enterprise']);
export const SubscriptionStatusSchema = z.enum(['active', 'past_due', 'canceled', 'trialing']);
