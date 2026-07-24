// In-memory failed-attempt limiter, keyed by client IP. Single-process
// deployment (see DEPLOY.md), so no shared store is needed. Not a general
// per-request limiter — callers explicitly report failure/success so this
// only ever throttles repeated *wrong* attempts, never legitimate traffic.
function createLoginLimiter({ max = 5, windowMs = 10 * 60 * 1000, lockoutMs = 15 * 60 * 1000 } = {}) {
  const state = new Map();

  function keyFor(req) {
    return req.ip;
  }

  // Returns seconds until unlocked, or null if not currently locked.
  function check(req) {
    const key = keyFor(req);
    const entry = state.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (entry.lockedUntil) {
      if (now < entry.lockedUntil) {
        return Math.ceil((entry.lockedUntil - now) / 1000);
      }
      state.delete(key);
      return null;
    }
    if (now - entry.firstAttempt > windowMs) {
      state.delete(key);
    }
    return null;
  }

  function recordFailure(req) {
    const key = keyFor(req);
    const now = Date.now();
    const entry = state.get(key);
    if (!entry || now - entry.firstAttempt > windowMs) {
      state.set(key, { count: 1, firstAttempt: now, lockedUntil: null });
      return;
    }
    entry.count += 1;
    if (entry.count >= max) {
      entry.lockedUntil = now + lockoutMs;
    }
  }

  function recordSuccess(req) {
    state.delete(keyFor(req));
  }

  return { check, recordFailure, recordSuccess };
}

module.exports = { createLoginLimiter };
