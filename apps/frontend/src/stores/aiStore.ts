import { create } from 'zustand';
import type {
  AIChatMessage,
  AICommandResponse,
  AIStatusResponse,
} from 'shared';

// ============================================================
// AI Chat Store (Zustand)
// ============================================================

interface AIState {
  // Panel state
  isOpen: boolean;
  toggleChat: () => void;
  setOpen: (open: boolean) => void;

  // Messages
  messages: AIChatMessage[];
  addMessage: (msg: AIChatMessage) => void;
  updateLastAssistantMessage: (content: string, operations?: AIChatMessage['operations']) => void;
  clearMessages: () => void;

  // Processing state
  isProcessing: boolean;
  setProcessing: (processing: boolean) => void;

  // Conversation
  conversationId: string | null;
  setConversationId: (id: string | null) => void;

  // Status from /ai/status
  aiEnabled: boolean;
  budgetRemainingCents: number | null;
  rateLimitRemaining: number | null;
  setStatus: (status: AIStatusResponse) => void;

  // Process a full response from /ai/execute
  handleResponse: (response: AICommandResponse) => void;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

export const useAIStore = create<AIState>((set, get) => ({
  isOpen: false,
  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),

  messages: [],
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  updateLastAssistantMessage: (content, operations) =>
    set((s) => {
      const msgs = [...s.messages];
      // Find last assistant message (which should be the loading one)
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content, operations, isLoading: false };
          break;
        }
      }
      return { messages: msgs };
    }),

  clearMessages: () => set({ messages: [], conversationId: null }),

  isProcessing: false,
  setProcessing: (processing) => set({ isProcessing: processing }),

  conversationId: null,
  setConversationId: (id) => set({ conversationId: id }),

  aiEnabled: true, // optimistic default
  budgetRemainingCents: null,
  rateLimitRemaining: null,

  setStatus: (status) =>
    set({
      aiEnabled: status.enabled,
      budgetRemainingCents: status.budgetRemainingCents ?? null,
    }),

  handleResponse: (response) => {
    const state = get();

    // Update conversation ID
    if (response.conversationId) {
      set({ conversationId: response.conversationId });
    }

    // Update budget
    set({
      budgetRemainingCents: response.usage.budgetRemainingCents,
      rateLimitRemaining: response.rateLimitRemaining,
    });

    // Update the loading assistant message with the real content
    if (response.success) {
      state.updateLastAssistantMessage(response.message, response.operations);
    } else {
      state.updateLastAssistantMessage(
        response.error?.message || 'Something went wrong. Please try again.'
      );
    }

    set({ isProcessing: false });
  },
}));

/** Generate a unique message ID. */
export { nextMessageId };
