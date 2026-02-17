import { z } from 'zod';

export const UuidSchema = z.string().uuid();

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const BoardIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const VersionParamSchema = z.object({
  id: z.string().uuid(),
  versionNumber: z.coerce.number().int().min(1),
});
