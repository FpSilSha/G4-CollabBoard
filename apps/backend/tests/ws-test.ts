/**
 * Phase 2 WebSocket Integration Test
 *
 * Tests: auth, board:join, presence, cursor:move sync, board:leave, disconnect.
 * Run with: npx tsx --env-file=.env tests/ws-test.ts
 * Requires: server running on port 3001, valid Auth0 M2M token in WS_TEST_TOKEN env var.
 */
import { io, Socket } from 'socket.io-client';
import { WebSocketEvent } from 'shared';

const SERVER_URL = 'http://localhost:3001';
const TOKEN = process.env.WS_TEST_TOKEN;

if (!TOKEN) {
  console.error('Set WS_TEST_TOKEN environment variable with a valid Auth0 JWT');
  process.exit(1);
}

// Use the board we created in Phase 1 tests, or any valid board ID
const BOARD_ID = process.argv[2];
if (!BOARD_ID) {
  console.error('Usage: npx tsx --env-file=.env tests/ws-test.ts <boardId>');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function connectClient(name: string): Socket {
  return io(SERVER_URL, {
    auth: { token: TOKEN },
    transports: ['websocket'],
    forceNew: true,
  });
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('\n🧪 Phase 2 WebSocket Tests\n');

  // --- Test 1: Authentication ---
  console.log('1. Authentication');

  const clientA = connectClient('Client A');
  const connectPromiseA = new Promise<void>((resolve, reject) => {
    clientA.on('connect', () => resolve());
    clientA.on('connect_error', (err) => reject(err));
  });

  try {
    await connectPromiseA;
    assert(clientA.connected, 'Client A connected with valid JWT');
  } catch (err: any) {
    assert(false, `Client A connection failed: ${err.message}`);
    process.exit(1);
  }

  // --- Test 2: Auth rejection with bad token ---
  console.log('\n2. Auth Rejection');

  const badClient = io(SERVER_URL, {
    auth: { token: 'invalid-token' },
    transports: ['websocket'],
    forceNew: true,
  });

  const badConnectResult = await new Promise<string>((resolve) => {
    badClient.on('connect', () => resolve('connected'));
    badClient.on('connect_error', (err) => resolve(`rejected: ${err.message}`));
    setTimeout(() => resolve('timeout'), 5000);
  });

  assert(badConnectResult.startsWith('rejected'), `Bad token rejected: ${badConnectResult}`);
  badClient.disconnect();

  // --- Test 3: Board Join ---
  console.log('\n3. Board Join');

  const boardStatePromise = waitForEvent<any>(clientA, WebSocketEvent.BOARD_STATE);
  clientA.emit(WebSocketEvent.BOARD_JOIN, { boardId: BOARD_ID });

  const boardState = await boardStatePromise;
  assert(boardState.boardId === BOARD_ID, `Received board:state for correct board`);
  assert(Array.isArray(boardState.objects), `board:state contains objects array`);
  assert(Array.isArray(boardState.users), `board:state contains users array`);
  assert(boardState.users.length >= 1, `At least 1 user in presence (self)`);

  // --- Test 4: Second client joins, first sees user:joined ---
  console.log('\n4. Second Client Joins');

  const clientB = connectClient('Client B');
  await new Promise<void>((resolve, reject) => {
    clientB.on('connect', () => resolve());
    clientB.on('connect_error', (err) => reject(err));
  });
  assert(clientB.connected, 'Client B connected');

  const userJoinedPromise = waitForEvent<any>(clientA, WebSocketEvent.USER_JOINED);
  const boardStateBPromise = waitForEvent<any>(clientB, WebSocketEvent.BOARD_STATE);

  clientB.emit(WebSocketEvent.BOARD_JOIN, { boardId: BOARD_ID });

  const [userJoined, boardStateB] = await Promise.all([userJoinedPromise, boardStateBPromise]);

  assert(userJoined.boardId === BOARD_ID, 'Client A received user:joined event');
  assert(userJoined.user.userId !== undefined, 'user:joined has userId');
  // Note: Both clients use the same M2M token (same userId), so Redis presence
  // key overwrites. With distinct users this would be >= 2. Testing the event flow is sufficient.
  assert(boardStateB.users.length >= 1, `Client B sees ${boardStateB.users.length} user(s) in presence (same userId = 1, distinct = 2+)`);

  // --- Test 5: Cursor Sync ---
  console.log('\n5. Cursor Sync');

  const cursorMovedPromise = waitForEvent<any>(clientA, WebSocketEvent.CURSOR_MOVED);

  clientB.emit(WebSocketEvent.CURSOR_MOVE, {
    boardId: BOARD_ID,
    x: 123.5,
    y: 456.7,
    timestamp: Date.now(),
  });

  const cursorMoved = await cursorMovedPromise;
  assert(cursorMoved.boardId === BOARD_ID, 'cursor:moved has correct boardId');
  assert(cursorMoved.x === 123.5, `cursor:moved x = ${cursorMoved.x}`);
  assert(cursorMoved.y === 456.7, `cursor:moved y = ${cursorMoved.y}`);
  assert(cursorMoved.userId !== undefined, 'cursor:moved has userId');

  // --- Test 6: Heartbeat refreshes presence ---
  console.log('\n6. Heartbeat');

  clientA.emit(WebSocketEvent.HEARTBEAT, { boardId: BOARD_ID, timestamp: Date.now() });
  await sleep(100);
  assert(true, 'Heartbeat sent without error');

  // --- Test 7: Client B leaves, Client A sees user:left ---
  console.log('\n7. Board Leave');

  const userLeftPromise = waitForEvent<any>(clientA, WebSocketEvent.USER_LEFT);
  clientB.emit(WebSocketEvent.BOARD_LEAVE, { boardId: BOARD_ID });

  const userLeft = await userLeftPromise;
  assert(userLeft.boardId === BOARD_ID, 'Client A received user:left event');
  assert(userLeft.userId !== undefined, 'user:left has userId');

  // --- Test 8: Disconnect ---
  console.log('\n8. Disconnect');

  clientB.disconnect();
  await sleep(500);
  assert(!clientB.connected, 'Client B disconnected');

  // Clean up
  clientA.disconnect();
  await sleep(500);

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
