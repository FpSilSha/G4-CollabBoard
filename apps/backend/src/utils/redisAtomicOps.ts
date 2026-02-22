/**
 * Lua-based atomic operations for Redis board state mutations.
 *
 * Each function wraps a Lua script that runs inside Redis as a single
 * atomic operation, eliminating the GET→parse→mutate→SET race condition.
 *
 * Return codes:
 *   0  = success
 *  -1  = duplicate ID (add) or object not found (update/remove)
 *  -2  = no state exists at key (caller should loadBoardToRedis + retry)
 *  -3  = object limit reached
 */

import { instrumentedRedis as redis } from './instrumentedRedis';

// ─── Single-Object Operations ─────────────────────────────────────────────────

const LUA_ADD_OBJECT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local obj = cjson.decode(ARGV[1])
local maxObjects = tonumber(ARGV[2])
for i, existing in ipairs(state.objects) do
  if existing.id == obj.id then return -1 end
end
if maxObjects > 0 and #state.objects >= maxObjects then return -3 end
table.insert(state.objects, obj)
redis.call('SET', KEYS[1], cjson.encode(state))
return 0
`;

const LUA_UPDATE_OBJECT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local objectId = ARGV[1]
local updates = cjson.decode(ARGV[2])
local found = false
for i, obj in ipairs(state.objects) do
  if obj.id == objectId then
    for k, v in pairs(updates) do
      obj[k] = v
    end
    state.objects[i] = obj
    found = true
    break
  end
end
if not found then return -1 end
redis.call('SET', KEYS[1], cjson.encode(state))
return 0
`;

const LUA_REMOVE_OBJECT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local objectId = ARGV[1]
local newObjects = {}
local found = false
for i, obj in ipairs(state.objects) do
  if obj.id == objectId then
    found = true
  else
    table.insert(newObjects, obj)
  end
end
if not found then return -1 end
state.objects = newObjects
redis.call('SET', KEYS[1], cjson.encode(state))
return 0
`;

// ─── Batch Operations ─────────────────────────────────────────────────────────

const LUA_BATCH_ADD_OBJECTS = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local newObjects = cjson.decode(ARGV[1])
local maxObjects = tonumber(ARGV[2])
local existingIds = {}
for i, obj in ipairs(state.objects) do
  existingIds[obj.id] = true
end
local added = 0
for i, obj in ipairs(newObjects) do
  if not existingIds[obj.id] then
    if maxObjects > 0 and #state.objects >= maxObjects then return -3 end
    table.insert(state.objects, obj)
    existingIds[obj.id] = true
    added = added + 1
  end
end
redis.call('SET', KEYS[1], cjson.encode(state))
return added
`;

const LUA_BATCH_UPDATE_OBJECTS = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local updatesList = cjson.decode(ARGV[1])
local idToIndex = {}
for i, obj in ipairs(state.objects) do
  idToIndex[obj.id] = i
end
local updated = 0
for _, upd in ipairs(updatesList) do
  local idx = idToIndex[upd.id]
  if idx then
    for k, v in pairs(upd) do
      state.objects[idx][k] = v
    end
    updated = updated + 1
  end
end
redis.call('SET', KEYS[1], cjson.encode(state))
return updated
`;

const LUA_BATCH_REMOVE_OBJECTS = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -2 end
local state = cjson.decode(raw)
local idsToRemove = cjson.decode(ARGV[1])
local removeSet = {}
for _, id in ipairs(idsToRemove) do
  removeSet[id] = true
end
local newObjects = {}
local removed = 0
for i, obj in ipairs(state.objects) do
  if removeSet[obj.id] then
    removed = removed + 1
  else
    table.insert(newObjects, obj)
  end
end
state.objects = newObjects
redis.call('SET', KEYS[1], cjson.encode(state))
return removed
`;

// ─── Exported Functions ───────────────────────────────────────────────────────

export async function atomicAddObject(
  key: string,
  objectJson: string,
  maxObjects: number
): Promise<number> {
  return (await redis.eval(LUA_ADD_OBJECT, 1, key, objectJson, String(maxObjects))) as number;
}

export async function atomicUpdateObject(
  key: string,
  objectId: string,
  updatesJson: string
): Promise<number> {
  return (await redis.eval(LUA_UPDATE_OBJECT, 1, key, objectId, updatesJson)) as number;
}

export async function atomicRemoveObject(
  key: string,
  objectId: string
): Promise<number> {
  return (await redis.eval(LUA_REMOVE_OBJECT, 1, key, objectId)) as number;
}

export async function atomicBatchAddObjects(
  key: string,
  objectsJson: string,
  maxObjects: number
): Promise<number> {
  return (await redis.eval(LUA_BATCH_ADD_OBJECTS, 1, key, objectsJson, String(maxObjects))) as number;
}

export async function atomicBatchUpdateObjects(
  key: string,
  updatesJson: string
): Promise<number> {
  return (await redis.eval(LUA_BATCH_UPDATE_OBJECTS, 1, key, updatesJson)) as number;
}

export async function atomicBatchRemoveObjects(
  key: string,
  objectIdsJson: string
): Promise<number> {
  return (await redis.eval(LUA_BATCH_REMOVE_OBJECTS, 1, key, objectIdsJson)) as number;
}
