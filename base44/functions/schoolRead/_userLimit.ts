// _userLimit.ts — a per-user token bucket in front of schoolRead (v1.9.0).
//
// WHY. Base44's rate limit is ONE budget for the whole app (~150 service-role
// entity calls a minute, shared by every user's invocations — see _answer.ts).
// v1.8.3 cut what a screen costs, but nothing stopped ONE session from
// spending all of it: a tab stuck in a refetch loop, a script with a stolen
// token, or a person reloading every second leaves every other school's
// director, teacher and parent looking at "Hay mucha actividad". This bucket
// caps what a single user can draw, so one user's burst becomes that user's
// 429 instead of everybody's.
//
// SIZING — measured, not guessed (npm run test:load, which replays THIS
// bucket on virtual time). One cold screen costs at most 3 schoolRead
// invocations; the most one person made in any rolling minute was 9 browsing
// in-app at a brisk pace, 17 doing a full page reload every 5 s, and 30 in the
// 1.5 s reload loop that exhausted the app on 2026-10-01. CAPACITY 24 (eight
// cold screens back to back) and REFILL 0.2/s (12 a minute) leave every
// human, brisk and in-app scenario untouched (0 refusals); the 1.5 s loop gets
// 8 refusals that its read retry absorbs (failed queries: 46 with or without
// the bucket). The case it exists for — one session firing schoolRead every
// 250 ms with no backoff while a teacher and a parent browse — goes from 446
// app-wide "Rate limit exceeded" and 29 failed screen queries for the OTHER
// two people, to 23 and 10. Sustained, one user can then draw ~12 calls a
// minute (~60-80 entity operations, about half the app budget) instead of all
// of it. tests/unit/school-read-user-limit.test.js pins that behaviour (no
// refusal in normal use; the loop no longer starves the others).
//
// WHERE IT LIVES: in memory, per isolate. Deno KV would make it shared, but
// Base44 does not document KV for its functions (the base44-cli and
// base44-sdk references describe Deno.serve, npm: imports and secrets — no
// Deno.openKv), and Deno itself still gates openKv behind --unstable-kv
// outside Deno Deploy. A store that may not exist cannot hold a limit, and an
// entity-backed counter would spend the very budget this protects. So the
// bound is per isolate: if Base44 runs N warm isolates of schoolRead, one user
// can draw at most N buckets. That still turns "one user can take the whole
// app" into "one user can take a bounded share", which is the point; it is
// documented as such in CLAUDE.md, not presented as exact.
//
// Import-free, so node --test and scripts/load-test-reads.mjs load it.

export const SCHOOL_READ_USER_LIMIT = { capacity: 24, refillPerSecond: 0.2 };

/** Bucket entries kept in memory before idle (full) ones are dropped. */
export const MAX_TRACKED_USERS = 5000;

export type TakeResult = { ok: true } | { ok: false; retryAfterS: number };

export function makeUserRateLimiter(options: {
  capacity?: number;
  refillPerSecond?: number;
  maxUsers?: number;
  now?: () => number;
} = {}) {
  const capacity = options.capacity ?? SCHOOL_READ_USER_LIMIT.capacity;
  const refill = options.refillPerSecond ?? SCHOOL_READ_USER_LIMIT.refillPerSecond;
  const maxUsers = options.maxUsers ?? MAX_TRACKED_USERS;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, { tokens: number; at: number }>();

  function level(bucket: { tokens: number; at: number }, t: number): number {
    return Math.min(capacity, bucket.tokens + (Math.max(0, t - bucket.at) / 1000) * refill);
  }

  function prune(t: number): void {
    if (buckets.size < maxUsers) return;
    // Idle users first: a bucket that has refilled completely carries no state.
    for (const [key, bucket] of buckets) {
      if (level(bucket, t) >= capacity) buckets.delete(key);
    }
    // Still full of active users: drop the least recently touched.
    while (buckets.size >= maxUsers) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  }

  return {
    /** Spend one token for `userId`, or say how long until there is one. */
    take(userId: string): TakeResult {
      const key = String(userId || '');
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        prune(t);
        bucket = { tokens: capacity, at: t };
      } else {
        // Re-insert so Map order tracks recency.
        buckets.delete(key);
        bucket = { tokens: level(bucket, t), at: t };
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        buckets.set(key, bucket);
        return { ok: true };
      }
      buckets.set(key, bucket);
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((1 - bucket.tokens) / refill)) };
    },
    /** Tracked users (for tests). */
    size(): number {
      return buckets.size;
    },
  };
}
