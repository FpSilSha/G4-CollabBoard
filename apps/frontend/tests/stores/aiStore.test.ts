import { describe, it, expect, beforeEach } from 'vitest';
import { useAIStore, nextMessageId } from '../../src/stores/aiStore';
import type { AIChatMessage, AICommandResponse, AIStatusResponse } from 'shared';

// ─── Reset helpers ────────────────────────────────────────────────────────────

const INITIAL_STATE: Parameters<typeof useAIStore.setState>[0] = {
  isOpen: false,
  messages: [],
  isProcessing: false,
  conversationId: null,
  aiEnabled: true,
  budgetRemainingCents: null,
  rateLimitRemaining: null,
  remoteAIActivity: new Map(),
};

beforeEach(() => {
  useAIStore.setState(INITIAL_STATE as any);
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<AIChatMessage> = {}): AIChatMessage {
  return {
    id: nextMessageId(),
    role: 'user',
    content: 'Hello AI',
    timestamp: new Date(),
    ...overrides,
  };
}

function makeCommandResponse(overrides: Partial<AICommandResponse> = {}): AICommandResponse {
  return {
    success: true,
    conversationId: 'conv-1',
    message: 'Done!',
    operations: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostCents: 1,
      budgetRemainingCents: 99,
      turnsUsed: 1,
    },
    rateLimitRemaining: 10,
    ...overrides,
  };
}

// ─── toggleChat / setOpen ─────────────────────────────────────────────────────

describe('toggleChat', () => {
  it('toggles isOpen from false to true', () => {
    useAIStore.getState().toggleChat();
    expect(useAIStore.getState().isOpen).toBe(true);
  });

  it('toggles isOpen from true to false', () => {
    useAIStore.setState({ isOpen: true } as any);
    useAIStore.getState().toggleChat();
    expect(useAIStore.getState().isOpen).toBe(false);
  });
});

describe('setOpen', () => {
  it('sets isOpen to true', () => {
    useAIStore.getState().setOpen(true);
    expect(useAIStore.getState().isOpen).toBe(true);
  });

  it('sets isOpen to false', () => {
    useAIStore.setState({ isOpen: true } as any);
    useAIStore.getState().setOpen(false);
    expect(useAIStore.getState().isOpen).toBe(false);
  });
});

// ─── addMessage ───────────────────────────────────────────────────────────────

describe('addMessage', () => {
  it('appends a message to the messages array', () => {
    const msg = makeMessage({ content: 'Test message' });
    useAIStore.getState().addMessage(msg);

    const messages = useAIStore.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Test message');
  });

  it('appends multiple messages in order', () => {
    const msg1 = makeMessage({ content: 'First' });
    const msg2 = makeMessage({ content: 'Second' });
    useAIStore.getState().addMessage(msg1);
    useAIStore.getState().addMessage(msg2);

    const messages = useAIStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
  });

  it('preserves all message fields', () => {
    const timestamp = new Date('2025-01-01');
    const msg = makeMessage({ role: 'assistant', content: 'Hi there', timestamp, isLoading: true });
    useAIStore.getState().addMessage(msg);

    const stored = useAIStore.getState().messages[0];
    expect(stored.role).toBe('assistant');
    expect(stored.isLoading).toBe(true);
    expect(stored.timestamp).toBe(timestamp);
  });
});

// ─── clearMessages ────────────────────────────────────────────────────────────

describe('clearMessages', () => {
  it('empties the messages array', () => {
    useAIStore.getState().addMessage(makeMessage());
    useAIStore.getState().addMessage(makeMessage());
    useAIStore.getState().clearMessages();

    expect(useAIStore.getState().messages).toHaveLength(0);
  });

  it('also resets conversationId to null', () => {
    useAIStore.setState({ conversationId: 'conv-123' } as any);
    useAIStore.getState().clearMessages();
    expect(useAIStore.getState().conversationId).toBeNull();
  });
});

// ─── updateLastAssistantMessage ───────────────────────────────────────────────

describe('updateLastAssistantMessage', () => {
  it('replaces content of the last assistant message', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'user', content: 'User msg' }));
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: 'Loading…', isLoading: true }));

    useAIStore.getState().updateLastAssistantMessage('Final answer');

    const messages = useAIStore.getState().messages;
    const assistantMsg = messages.find((m) => m.role === 'assistant')!;
    expect(assistantMsg.content).toBe('Final answer');
    expect(assistantMsg.isLoading).toBe(false);
  });

  it('sets operations on the last assistant message', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const ops = [{ type: 'create' as const, objectId: 'obj-1', objectType: 'sticky', details: {} }];
    useAIStore.getState().updateLastAssistantMessage('Created!', ops);

    const msg = useAIStore.getState().messages[0];
    expect(msg.operations).toEqual(ops);
  });

  it('only modifies the last assistant message when multiple exist', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: 'First response' }));
    useAIStore.getState().addMessage(makeMessage({ role: 'user', content: 'Follow-up' }));
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: 'Loading…', isLoading: true }));

    useAIStore.getState().updateLastAssistantMessage('Second response');

    const messages = useAIStore.getState().messages;
    expect(messages[0].content).toBe('First response'); // unchanged
    expect(messages[2].content).toBe('Second response'); // updated
  });
});

// ─── isProcessing / setProcessing ────────────────────────────────────────────

describe('setProcessing', () => {
  it('sets isProcessing to true', () => {
    useAIStore.getState().setProcessing(true);
    expect(useAIStore.getState().isProcessing).toBe(true);
  });

  it('sets isProcessing to false', () => {
    useAIStore.setState({ isProcessing: true } as any);
    useAIStore.getState().setProcessing(false);
    expect(useAIStore.getState().isProcessing).toBe(false);
  });
});

// ─── conversationId ───────────────────────────────────────────────────────────

describe('setConversationId', () => {
  it('stores a conversation ID', () => {
    useAIStore.getState().setConversationId('conv-abc-123');
    expect(useAIStore.getState().conversationId).toBe('conv-abc-123');
  });

  it('can be set to null', () => {
    useAIStore.setState({ conversationId: 'conv-1' } as any);
    useAIStore.getState().setConversationId(null);
    expect(useAIStore.getState().conversationId).toBeNull();
  });
});

// ─── setStatus ────────────────────────────────────────────────────────────────

describe('setStatus', () => {
  it('updates aiEnabled and budgetRemainingCents from status', () => {
    const status: AIStatusResponse = {
      enabled: false,
      budgetRemainingCents: 42,
    };
    useAIStore.getState().setStatus(status);

    expect(useAIStore.getState().aiEnabled).toBe(false);
    expect(useAIStore.getState().budgetRemainingCents).toBe(42);
  });

  it('sets budgetRemainingCents to null when not present in status', () => {
    const status: AIStatusResponse = { enabled: true };
    useAIStore.getState().setStatus(status);
    expect(useAIStore.getState().budgetRemainingCents).toBeNull();
  });

  it('updates aiEnabled to true when AI is enabled', () => {
    useAIStore.setState({ aiEnabled: false } as any);
    useAIStore.getState().setStatus({ enabled: true });
    expect(useAIStore.getState().aiEnabled).toBe(true);
  });
});

// ─── remoteAIActivity ────────────────────────────────────────────────────────

describe('setRemoteAIThinking', () => {
  it('adds a remote AI activity entry', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'create sticky notes', 1000);

    const activity = useAIStore.getState().remoteAIActivity.get('user-2');
    expect(activity).toBeDefined();
    expect(activity!.userId).toBe('user-2');
    expect(activity!.command).toBe('create sticky notes');
    expect(activity!.timestamp).toBe(1000);
  });

  it('overwrites an existing entry for the same userId', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'first command', 1000);
    useAIStore.getState().setRemoteAIThinking('user-2', 'second command', 2000);

    const activity = useAIStore.getState().remoteAIActivity.get('user-2');
    expect(activity!.command).toBe('second command');
    expect(activity!.timestamp).toBe(2000);
  });

  it('stores multiple users independently', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'cmd A', 1000);
    useAIStore.getState().setRemoteAIThinking('user-3', 'cmd B', 2000);

    expect(useAIStore.getState().remoteAIActivity.size).toBe(2);
    expect(useAIStore.getState().remoteAIActivity.get('user-2')!.command).toBe('cmd A');
    expect(useAIStore.getState().remoteAIActivity.get('user-3')!.command).toBe('cmd B');
  });
});

describe('clearRemoteAIActivity', () => {
  it('removes the entry for the given userId', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'some command', 1000);
    useAIStore.getState().clearRemoteAIActivity('user-2');

    expect(useAIStore.getState().remoteAIActivity.has('user-2')).toBe(false);
  });

  it('only removes the specified user, leaving others intact', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'cmd A', 1000);
    useAIStore.getState().setRemoteAIThinking('user-3', 'cmd B', 2000);
    useAIStore.getState().clearRemoteAIActivity('user-2');

    expect(useAIStore.getState().remoteAIActivity.has('user-2')).toBe(false);
    expect(useAIStore.getState().remoteAIActivity.has('user-3')).toBe(true);
  });

  it('is a no-op for a userId not in the map', () => {
    useAIStore.getState().setRemoteAIThinking('user-2', 'cmd', 1000);
    expect(() => useAIStore.getState().clearRemoteAIActivity('nonexistent')).not.toThrow();
    expect(useAIStore.getState().remoteAIActivity.size).toBe(1);
  });
});

// ─── handleResponse ───────────────────────────────────────────────────────────

describe('handleResponse', () => {
  it('updates conversationId from response', () => {
    // Pre-populate a loading assistant message
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const response = makeCommandResponse({ conversationId: 'conv-new-999' });
    useAIStore.getState().handleResponse(response);

    expect(useAIStore.getState().conversationId).toBe('conv-new-999');
  });

  it('updates budgetRemainingCents from response usage', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const response = makeCommandResponse({
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostCents: 2,
        budgetRemainingCents: 50,
        turnsUsed: 1,
      },
    });
    useAIStore.getState().handleResponse(response);

    expect(useAIStore.getState().budgetRemainingCents).toBe(50);
  });

  it('sets isProcessing to false after response', () => {
    useAIStore.setState({ isProcessing: true } as any);
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    useAIStore.getState().handleResponse(makeCommandResponse());

    expect(useAIStore.getState().isProcessing).toBe(false);
  });

  it('updates assistant message with success response content', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const response = makeCommandResponse({ success: true, message: 'Created 3 sticky notes!' });
    useAIStore.getState().handleResponse(response);

    const msg = useAIStore.getState().messages[0];
    expect(msg.content).toBe('Created 3 sticky notes!');
    expect(msg.isLoading).toBe(false);
  });

  it('uses error message when response is not successful', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const response = makeCommandResponse({
      success: false,
      error: { code: 'AI_EXECUTION_FAILED', message: 'Something went wrong on the server.' },
    });
    useAIStore.getState().handleResponse(response);

    const msg = useAIStore.getState().messages[0];
    expect(msg.content).toBe('Something went wrong on the server.');
  });

  it('falls back to generic error message when error object is missing', () => {
    useAIStore.getState().addMessage(makeMessage({ role: 'assistant', content: '…', isLoading: true }));

    const response = makeCommandResponse({ success: false, error: undefined });
    useAIStore.getState().handleResponse(response);

    const msg = useAIStore.getState().messages[0];
    expect(msg.content).toBe('Something went wrong. Please try again.');
  });
});

// ─── nextMessageId ────────────────────────────────────────────────────────────

describe('nextMessageId', () => {
  it('returns a string', () => {
    expect(typeof nextMessageId()).toBe('string');
  });

  it('returns unique IDs on each call', () => {
    const id1 = nextMessageId();
    const id2 = nextMessageId();
    expect(id1).not.toBe(id2);
  });

  it('uses the "msg-" prefix', () => {
    expect(nextMessageId()).toMatch(/^msg-/);
  });
});
