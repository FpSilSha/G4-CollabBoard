import Anthropic from '@anthropic-ai/sdk';

// ============================================================
// Anthropic Tool Definitions — 16 tools across 5 categories
// ============================================================

export const AI_TOOLS: Anthropic.Tool[] = [

  // ═══════════════════════════════════════
  // CREATION TOOLS (7)
  // ═══════════════════════════════════════

  {
    name: 'createStickyNote',
    description: 'Create a new sticky note on the board. Sticky notes have a colored background and editable text. Use for brainstorming items, ideas, feedback, labels, or any short text content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text:    { type: 'string', description: 'Text content of the sticky note' },
        x:       { type: 'number', description: 'X coordinate on the board' },
        y:       { type: 'number', description: 'Y coordinate on the board' },
        color:   { type: 'string', description: 'Hex color for background. Defaults: yellow=#FFEB3B, pink=#F48FB1, blue=#90CAF9, green=#A5D6A7, orange=#FFCC80, purple=#CE93D8' },
        width:   { type: 'number', description: 'Width in pixels. Default: 200' },
        height:  { type: 'number', description: 'Height in pixels. Default: 150' },
        frameId: { type: 'string', description: 'Optional. ID of a frame to place this sticky note inside. The sticky note will be logically grouped with the frame.' },
      },
      required: ['text', 'x', 'y'],
    },
  },

  {
    name: 'createShape',
    description: 'Create a geometric shape. Use for diagrams, flowcharts, visual containers, dividers, arrows, stars, or structural elements.',
    input_schema: {
      type: 'object' as const,
      properties: {
        shapeType: { type: 'string', enum: ['rectangle', 'circle', 'triangle', 'line', 'arrow', 'star'], description: 'Type of shape. Triangle creates an equilateral triangle. Arrow creates a thick directional arrow polygon. Star creates a 5-point star.' },
        x:         { type: 'number', description: 'X coordinate' },
        y:         { type: 'number', description: 'Y coordinate' },
        width:     { type: 'number', description: 'Width in pixels' },
        height:    { type: 'number', description: 'Height in pixels' },
        color:     { type: 'string', description: 'Hex color for fill/stroke' },
        rotation:  { type: 'number', description: 'Rotation in degrees. Default: 0' },
      },
      required: ['shapeType', 'x', 'y', 'width', 'height'],
    },
  },

  {
    name: 'createFrame',
    description: 'Create a frame (grouping container). Frames are labeled rectangular areas used to organize content into sections, categories, or zones. Use for templates, section headers, and organizational structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:  { type: 'string', description: 'Frame title displayed at the top' },
        x:      { type: 'number', description: 'X coordinate' },
        y:      { type: 'number', description: 'Y coordinate' },
        width:  { type: 'number', description: 'Width in pixels' },
        height: { type: 'number', description: 'Height in pixels' },
        color:  { type: 'string', description: 'Border/header color as hex. Default: #E0E0E0' },
      },
      required: ['title', 'x', 'y', 'width', 'height'],
    },
  },

  {
    name: 'createConnector',
    description: 'Create a line or arrow connecting two existing objects. Requires valid object IDs — call getViewportObjects or getObjectDetails first if you need to find IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fromObjectId: { type: 'string', description: 'ID of the source object' },
        toObjectId:   { type: 'string', description: 'ID of the target object' },
        style:        { type: 'string', enum: ['line', 'arrow'], description: 'Connector style. Default: arrow' },
        color:        { type: 'string', description: 'Hex color. Default: #757575' },
      },
      required: ['fromObjectId', 'toObjectId'],
    },
  },

  {
    name: 'createTextElement',
    description: 'Create standalone text on the board. Use for titles, labels, descriptions, or text that should not be inside a sticky note.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text:     { type: 'string', description: 'The text content' },
        x:        { type: 'number', description: 'X coordinate' },
        y:        { type: 'number', description: 'Y coordinate' },
        fontSize: { type: 'number', description: 'Font size in pixels. Default: 16' },
        color:    { type: 'string', description: 'Hex color. Default: #212121' },
      },
      required: ['text', 'x', 'y'],
    },
  },

  {
    name: 'createLine',
    description: 'Create a standalone line on the board. Lines can have arrowheads, dashed patterns, and multiple weight styles (normal, bold, double, triple). Unlike connectors, lines do not attach to objects — use createConnector for object-to-object connections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x:              { type: 'number', description: 'Start X coordinate' },
        y:              { type: 'number', description: 'Start Y coordinate' },
        x2:             { type: 'number', description: 'End X coordinate' },
        y2:             { type: 'number', description: 'End Y coordinate' },
        color:          { type: 'string', description: 'Hex color for the line. Default: #757575' },
        endpointStyle:  { type: 'string', enum: ['none', 'arrow-end', 'arrow-both'], description: 'Arrowhead style. Default: none' },
        strokePattern:  { type: 'string', enum: ['solid', 'dashed'], description: 'Line pattern. Default: solid' },
        strokeWeight:   { type: 'string', enum: ['normal', 'bold', 'double', 'triple'], description: 'Line weight. Default: normal' },
      },
      required: ['x', 'y', 'x2', 'y2'],
    },
  },

  {
    name: 'createFlag',
    description: 'Create a teleport flag on the board. Flags are persistent markers that appear in the right sidebar and as visual pins on the canvas. Users can click a flag to instantly jump to that location. Use for marking important areas, navigation waypoints, or labeling key sections of the board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        label: { type: 'string', description: 'Display label for the flag (e.g., "Sprint Planning", "Design Zone")' },
        x:     { type: 'number', description: 'X coordinate on the board' },
        y:     { type: 'number', description: 'Y coordinate on the board' },
        color: { type: 'string', description: 'Hex color for the flag. Defaults cycle through: #F44336 (red), #2196F3 (blue), #4CAF50 (green), #FF9800 (orange), #9C27B0 (purple), #00BCD4 (cyan)' },
      },
      required: ['label', 'x', 'y'],
    },
  },

  // ═══════════════════════════════════════
  // MANIPULATION TOOLS (5)
  // ═══════════════════════════════════════

  {
    name: 'moveObject',
    description: 'Move an existing object to a new position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the object to move' },
        x:        { type: 'number', description: 'New X coordinate' },
        y:        { type: 'number', description: 'New Y coordinate' },
      },
      required: ['objectId', 'x', 'y'],
    },
  },

  {
    name: 'resizeObject',
    description: 'Resize an existing object. Use for adjusting dimensions, making frames fit content, or standardizing sizes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the object to resize' },
        width:    { type: 'number', description: 'New width in pixels' },
        height:   { type: 'number', description: 'New height in pixels' },
      },
      required: ['objectId', 'width', 'height'],
    },
  },

  {
    name: 'updateText',
    description: 'Update the text content of an existing sticky note or text element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the sticky note or text element' },
        newText:  { type: 'string', description: 'New text content' },
      },
      required: ['objectId', 'newText'],
    },
  },

  {
    name: 'changeColor',
    description: 'Change the color of an existing object.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the object' },
        color:    { type: 'string', description: 'New hex color code' },
      },
      required: ['objectId', 'color'],
    },
  },

  {
    name: 'deleteObject',
    description: 'Delete an existing object from the board.',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the object to delete' },
      },
      required: ['objectId'],
    },
  },

  // ═══════════════════════════════════════
  // READ TOOLS (2)
  // ═══════════════════════════════════════

  {
    name: 'getViewportObjects',
    description: 'Get objects currently visible in the user\'s viewport. Returns up to 50 objects with their IDs, types, positions, dimensions, and colors. Call this FIRST when the user references existing objects (e.g., "move the pink notes", "arrange these"). If more than 50 objects exist in the viewport, results are sorted by distance to viewport center (closest first).',
    input_schema: {
      type: 'object' as const,
      properties: {
        filterByType:  { type: 'string', enum: ['sticky', 'shape', 'frame', 'connector', 'text', 'line'], description: 'Optional: only return objects of this type' },
        filterByColor: { type: 'string', description: 'Optional: only return objects matching this hex color' },
      },
      required: [],
    },
  },

  {
    name: 'getObjectDetails',
    description: 'Get full details of a specific object by ID. Returns all properties including exact dimensions, position, text content, color, frameId, and metadata. Use when you need precise measurements for spatial calculations (e.g., fitting sticky notes inside a frame).',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectId: { type: 'string', description: 'ID of the object to inspect' },
      },
      required: ['objectId'],
    },
  },

  // ═══════════════════════════════════════
  // BATCH TOOLS (1)
  // ═══════════════════════════════════════

  {
    name: 'batchUpdateByFilter',
    description: 'Bulk-update multiple objects matching a filter, scoped to the user\'s viewport. Executes entirely server-side — efficient for "change all X to Y" commands. Returns the count of objects affected. Use this instead of calling changeColor/moveObject repeatedly when the user wants to modify many objects at once.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filterByType: {
          type: 'string',
          enum: ['sticky', 'shape', 'frame', 'connector', 'text', 'line'],
          description: 'Only affect objects of this type',
        },
        filterByColor: {
          type: 'string',
          description: 'Only affect objects matching this hex color',
        },
        filterByFrameId: {
          type: 'string',
          description: 'Only affect objects inside this frame',
        },
        updates: {
          type: 'object',
          description: 'Properties to update on matching objects. Supported: color (hex string), x (number, relative offset), y (number, relative offset).',
          properties: {
            color: { type: 'string', description: 'New hex color' },
            x:     { type: 'number', description: 'X offset (added to current position, not absolute)' },
            y:     { type: 'number', description: 'Y offset (added to current position, not absolute)' },
          },
        },
        viewportOnly: {
          type: 'boolean',
          description: 'If true (default), only affect objects in the user\'s viewport. If false, affect all matching objects on the board.',
        },
      },
      required: ['updates'],
    },
  },
];

/** Tool name union for type-safe switch statements. */
export type AIToolName =
  | 'createStickyNote'
  | 'createShape'
  | 'createFrame'
  | 'createConnector'
  | 'createLine'
  | 'createTextElement'
  | 'createFlag'
  | 'moveObject'
  | 'resizeObject'
  | 'updateText'
  | 'changeColor'
  | 'deleteObject'
  | 'getViewportObjects'
  | 'getObjectDetails'
  | 'batchUpdateByFilter';
