// A per-student brake on assistant requests, kept in the server process.
// It bounds cost and abuse on one instance; it is not a global quota (each
// serverless instance keeps its own window), which the PR states.

const WINDOW_MS = 10 * 60 * 1000;
export const ASSISTANT_REQUESTS_PER_WINDOW = 20;
const recent = new Map<string, number[]>();

export function takeAssistantSlot(userId: string, now = Date.now()): boolean {
  const kept = (recent.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
  if (kept.length >= ASSISTANT_REQUESTS_PER_WINDOW) {
    recent.set(userId, kept);
    return false;
  }
  kept.push(now);
  recent.set(userId, kept);
  if (recent.size > 5000) for (const [key, times] of recent) if (!times.some((time) => now - time < WINDOW_MS)) recent.delete(key);
  return true;
}
