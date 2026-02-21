// ============================================================
// AI Agent Types
// ============================================================

// --- Viewport ---

export interface ViewportBounds {
  x: number;                          // Top-left X of viewport in board coordinates
  y: number;                          // Top-left Y of viewport in board coordinates
  width: number;                      // Viewport width in board coordinates (accounts for zoom)
  height: number;                     // Viewport height in board coordinates
  zoom: number;                       // Current zoom level (1.0 = default)
}

// --- Request / Response ---

export interface AICommandRequest {
  boardId: string;
  command: string;                    // Natural language command from user
  conversationId?: string;            // Optional — for multi-turn context
  viewport: ViewportBounds;           // REQUIRED — user's current viewport
}

export interface AICommandResponse {
  success: boolean;
  conversationId: string;
  message: string;                    // Human-readable summary of what was done
  operations: AIOperation[];          // List of operations executed
  error?: AIErrorResponse;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostCents: number;
    budgetRemainingCents: number;
    turnsUsed: number;
  };
  rateLimitRemaining: number;
}

export interface AIOperation {
  type: 'create' | 'update' | 'delete' | 'read' | 'batch_update';
  objectType?: string;
  objectId: string;                   // Single object ID, or 'batch' for bulk ops
  details: Record<string, unknown>;
  count?: number;                     // For batch operations: how many affected
}

export interface AIErrorResponse {
  code: AIErrorCode;
  message: string;
}

export type AIErrorCode =
  | 'AI_BUDGET_EXCEEDED'
  | 'AI_RATE_LIMITED'
  | 'AI_DISABLED'
  | 'AI_INVALID_COMMAND'
  | 'AI_EXECUTION_FAILED'
  | 'AI_MAX_TURNS_EXCEEDED'
  | 'AI_PROVIDER_ERROR'
  | 'AI_BOARD_NOT_FOUND'
  | 'AI_UNAUTHORIZED';

// --- Usage Tracking ---

export interface AIUsageRecord {
  userId: string;
  boardId: string;
  command: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  turnsUsed: number;
  toolCallCount: number;
  model: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  traceId?: string;                   // LangSmith trace ID
  timestamp: Date;
}

// --- Chat (Frontend State) ---

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  operations?: AIOperation[];
  isLoading?: boolean;
  error?: string;
}

export interface AIConversationState {
  isOpen: boolean;
  isPanelAnimating: boolean;
  messages: AIChatMessage[];
  conversationId: string | null;
  isProcessing: boolean;
  budgetRemainingCents: number | null;
  rateLimitRemaining: number | null;
  aiEnabled: boolean;                 // From /ai/status check
}

// --- Status Endpoint ---

export interface AIStatusResponse {
  enabled: boolean;
  model?: string;
  budgetRemainingCents?: number;
  budgetTotalCents?: number;
  rateLimitPerMinute?: number;
  reason?: string;                    // Only present when enabled === false
}

// --- Budget ---

export interface AIBudgetCheck {
  hasRemaining: boolean;
  remainingCents: number;
  totalBudgetCents: number;
  spentCents: number;
}
