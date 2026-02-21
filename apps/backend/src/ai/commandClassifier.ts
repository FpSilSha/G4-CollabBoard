// ============================================================
// Command Classifier — routes commands to Haiku or Sonnet
// ============================================================
//
// Zero-cost, heuristic-based classification. No API call needed.
// Simple single-action commands → Haiku 3.5 (cheap & fast).
// Multi-step / complex commands → Sonnet 4 (smart & capable).
//
// Safety net: aiService escalates from Haiku → Sonnet mid-loop
// if the model requests multiple tool-use turns.

export type CommandComplexity = 'simple' | 'complex';

/**
 * Multi-step / template keywords that signal a complex command.
 * Lowercase for case-insensitive matching.
 */
const COMPLEX_KEYWORDS = [
  'template',
  'organize',
  'layout',
  'arrange',
  'swot',
  'retro',
  'kanban',
  'brainstorm',
  'mind map',
  'mindmap',
  'flowchart',
  'diagram',
  'workflow',
  'sprint',
  'timeline',
  'roadmap',
  'matrix',
  'quadrant',
  'pros and cons',
  'compare',
  'categorize',
  'group',
  'sort',
  'prioritize',
];

/**
 * Keywords that reference existing content AND require spatial reasoning.
 * Simple references like "those" or "the sticky" are fine for Haiku —
 * it just needs to call getViewportObjects then act. These keywords
 * indicate the user wants something more: rearranging, reorganizing,
 * or reasoning about relationships between objects.
 */
const COMPLEX_REFERENCE_KEYWORDS = [
  'reorganize',
  'rearrange',
  'redistribute',
  'reposition',
  'realign',
  'all of them',
  'everything',
];

/**
 * Connectors between multiple actions: "create X and then move Y".
 */
const MULTI_ACTION_PATTERNS = [
  /\b(create|add|make).{5,60}(then|and|also|after that|next|also).{5,60}(create|add|make|move|connect|delete|resize|color|change)/i,
  /\bconnect\b.{3,40}\bto\b/i,         // "connect A to B" requires knowing IDs
  /\bbetween\b/i,                       // "draw a line between" requires spatial reasoning
];

/** Maximum command length considered "simple". */
const SIMPLE_MAX_LENGTH = 200;

/**
 * Classify a user command as simple or complex.
 *
 * Simple commands are routed to Haiku 3.5 for cost efficiency.
 * Complex commands go to Sonnet 4 for better reasoning.
 */
export function classifyCommand(command: string): CommandComplexity {
  const lower = command.toLowerCase().trim();

  // Long commands are likely complex
  if (lower.length > SIMPLE_MAX_LENGTH) {
    return 'complex';
  }

  // Check for complex template/layout keywords
  for (const keyword of COMPLEX_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'complex';
    }
  }

  // Check for complex references (spatial reasoning about existing content)
  for (const keyword of COMPLEX_REFERENCE_KEYWORDS) {
    if (lower.includes(keyword)) {
      return 'complex';
    }
  }

  // Check for multi-action patterns
  for (const pattern of MULTI_ACTION_PATTERNS) {
    if (pattern.test(lower)) {
      return 'complex';
    }
  }

  // Default: simple (single-action commands like "create a blue sticky note")
  return 'simple';
}
