import { z } from 'zod';

// ============================================================
// AI Agent Zod Validation Schemas
// ============================================================

export const AIViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  zoom: z.number().min(0.01).max(10),
});

export const AICommandRequestSchema = z.object({
  boardId: z.string().uuid(),
  command: z.string().min(1).max(1000).trim(),
  conversationId: z.string().uuid().optional(),
  viewport: AIViewportSchema,
});
