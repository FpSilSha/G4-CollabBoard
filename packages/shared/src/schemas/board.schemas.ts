import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const coordinate = z.number().min(-1000000).max(1000000);
const dimension = z.number().min(50).max(2000);
const rotation = z.number().min(-360).max(360);

export const CreateBoardSchema = z.object({
  title: z.string().min(1).max(255).trim(),
});

export const UpdateBoardSchema = z.object({
  title: z.string().min(1).max(255).trim(),
});

// --- Object Schemas ---

const BaseObjectFields = {
  type: z.enum(['sticky', 'shape', 'frame', 'connector', 'text']),
  x: coordinate,
  y: coordinate,
};

export const StickyNoteCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('sticky'),
  text: z.string().max(10000).default(''),
  color: hexColor,
  width: dimension,
  height: dimension,
});

export const ShapeCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('shape'),
  shapeType: z.enum(['rectangle', 'circle', 'line']),
  width: dimension,
  height: dimension,
  color: hexColor,
  rotation: rotation.default(0),
});

export const FrameCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('frame'),
  title: z.string().max(255).default(''),
  width: dimension,
  height: dimension,
  color: hexColor,
});

export const ConnectorCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('connector'),
  fromObjectId: z.string().default(''),
  toObjectId: z.string().default(''),
  style: z.enum(['line', 'arrow']).default('line'),
  color: hexColor,
  x2: coordinate,
  y2: coordinate,
});

export const TextElementCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('text'),
  text: z.string().max(10000).default(''),
  fontSize: z.number().min(8).max(200),
  color: hexColor,
});

export const BoardObjectCreateSchema = z.discriminatedUnion('type', [
  StickyNoteCreateSchema,
  ShapeCreateSchema,
  FrameCreateSchema,
  ConnectorCreateSchema,
  TextElementCreateSchema,
]);

// Partial update schema (for object:update events)
export const ObjectUpdateSchema = z.object({
  x: coordinate.optional(),
  y: coordinate.optional(),
  x2: coordinate.optional(),
  y2: coordinate.optional(),
  text: z.string().max(10000).optional(),
  color: hexColor.optional(),
  width: dimension.optional(),
  height: dimension.optional(),
  rotation: rotation.optional(),
  fontSize: z.number().min(8).max(200).optional(),
  title: z.string().max(255).optional(),
  shapeType: z.enum(['rectangle', 'circle', 'line']).optional(),
  style: z.enum(['line', 'arrow']).optional(),
  fromObjectId: z.string().optional(),
  toObjectId: z.string().optional(),
});
