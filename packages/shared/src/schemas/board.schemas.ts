import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const coordinate = z.number().min(-1000000).max(1000000);
const dimension = z.number().min(50).max(2000);
const rotation = z.number().min(-360).max(360);

/** Normalized anchor point on an object (rx/ry relative to center & half-dims). */
const anchorPoint = z.object({
  rx: z.number().min(-2).max(2),
  ry: z.number().min(-2).max(2),
});

export const CreateBoardSchema = z.object({
  title: z.string().min(1).max(255).trim(),
});

export const UpdateBoardSchema = z.object({
  title: z.string().min(1).max(255).trim(),
});

// --- Object Schemas ---

const BaseObjectFields = {
  type: z.enum(['sticky', 'shape', 'frame', 'connector', 'text', 'line']),
  x: coordinate,
  y: coordinate,
  frameId: z.string().uuid().nullable().default(null),
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
  shapeType: z.enum(['rectangle', 'circle', 'line', 'arrow', 'star']),
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
  locked: z.boolean().default(false),
});

export const ConnectorCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('connector'),
  fromObjectId: z.string().default(''),
  toObjectId: z.string().default(''),
  fromAnchor: anchorPoint.nullable().optional(),
  toAnchor: anchorPoint.nullable().optional(),
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
  fontFamily: z.string().max(200).optional(),
});

export const LineCreateSchema = z.object({
  ...BaseObjectFields,
  type: z.literal('line'),
  x2: coordinate,
  y2: coordinate,
  color: hexColor,
  endpointStyle: z.enum(['none', 'arrow-end', 'arrow-both']).default('none'),
  strokePattern: z.enum(['solid', 'dashed']).default('solid'),
  strokeWeight: z.enum(['normal', 'bold', 'double', 'triple']).default('normal'),
});

export const BoardObjectCreateSchema = z.discriminatedUnion('type', [
  StickyNoteCreateSchema,
  ShapeCreateSchema,
  FrameCreateSchema,
  ConnectorCreateSchema,
  TextElementCreateSchema,
  LineCreateSchema,
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
  shapeType: z.enum(['rectangle', 'circle', 'line', 'arrow', 'star']).optional(),
  style: z.enum(['line', 'arrow']).optional(),
  fromObjectId: z.string().optional(),
  toObjectId: z.string().optional(),
  fromAnchor: anchorPoint.nullable().optional(),
  toAnchor: anchorPoint.nullable().optional(),
  frameId: z.string().uuid().nullable().optional(),
  locked: z.boolean().optional(),
  // Line styling
  endpointStyle: z.enum(['none', 'arrow-end', 'arrow-both']).optional(),
  strokePattern: z.enum(['solid', 'dashed']).optional(),
  strokeWeight: z.enum(['normal', 'bold', 'double', 'triple']).optional(),
  // Text font
  fontFamily: z.string().max(200).optional(),
});

// --- Teleport Flag Schemas ---

export const CreateTeleportFlagSchema = z.object({
  label: z.string().min(1).max(100).trim(),
  x: z.number().min(-1000000).max(1000000),
  y: z.number().min(-1000000).max(1000000),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const UpdateTeleportFlagSchema = z.object({
  label: z.string().min(1).max(100).trim().optional(),
  x: z.number().min(-1000000).max(1000000).optional(),
  y: z.number().min(-1000000).max(1000000).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

export const FlagIdParamSchema = z.object({
  id: z.string().uuid(),
  flagId: z.string().uuid(),
});
