/**
 * Generate a UUID for local object creation.
 *
 * Phase 3: Used as the permanent ID since there is no server.
 * Phase 4: Used as a temporary optimistic ID. The server will
 *          assign the real ID in its object:created response,
 *          and the client must remap fabricObject.data.id accordingly.
 */
export function generateLocalId(): string {
  return crypto.randomUUID();
}
