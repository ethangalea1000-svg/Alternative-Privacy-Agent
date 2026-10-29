const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

async function hashKey(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getClientIp(request) {
  const value = request.headers.get("cf-connecting-ip");
  if (value && value.length <= 64 && !/[\r\n]/.test(value)) return value;
  const contextIp = request.cf?.connectingIp;
  if (typeof contextIp === "string" && contextIp.length <= 64 && !/[\r\n]/.test(contextIp)) return contextIp;
  return "unknown-client";
}

async function bucketKeys(request, username) {
  return [
    await hashKey("ip:" + getClientIp(request)),
    await hashKey("username:" + username)
  ];
}

export async function loginRateLimitStatus(db, request, username, now = Date.now()) {
  const keys = await bucketKeys(request, username);
  for (const key of keys) {
    const row = await db.prepare(
      "SELECT blocked_until, window_started_at FROM auth_login_limits WHERE key_hash = ?"
    ).bind(key).first();
    if (row && Number(row.blocked_until) > now) {
      return { blocked: true, retryAfter: Math.max(1, Math.ceil((Number(row.blocked_until) - now) / 1000)) };
    }
  }
  return { blocked: false, keys };
}

export async function recordLoginFailure(db, keys, now = Date.now()) {
  const windowStartedAt = now - WINDOW_MS;
  const blockedUntil = now + BLOCK_MS;
  const updatedAt = new Date(now).toISOString();
  for (const key of keys) {
    await db.prepare(
      "INSERT INTO auth_login_limits (key_hash, failed_attempts, window_started_at, blocked_until, updated_at) " +
      "VALUES (?, 1, ?, NULL, ?) " +
      "ON CONFLICT(key_hash) DO UPDATE SET " +
      "failed_attempts = CASE WHEN auth_login_limits.window_started_at < ? THEN 1 ELSE auth_login_limits.failed_attempts + 1 END, " +
      "window_started_at = CASE WHEN auth_login_limits.window_started_at < ? THEN excluded.window_started_at ELSE auth_login_limits.window_started_at END, " +
      "blocked_until = CASE WHEN (CASE WHEN auth_login_limits.window_started_at < ? THEN 1 ELSE auth_login_limits.failed_attempts + 1 END) >= ? THEN ? ELSE auth_login_limits.blocked_until END, " +
      "updated_at = excluded.updated_at"
    ).bind(key, now, updatedAt, windowStartedAt, windowStartedAt, windowStartedAt, MAX_FAILURES, blockedUntil).run();
  }
}

export async function clearLoginFailures(db, keys) {
  for (const key of keys) {
    await db.prepare("DELETE FROM auth_login_limits WHERE key_hash = ?").bind(key).run();
  }
}

export const LOGIN_RATE_LIMIT_POLICY = Object.freeze({
  maxFailures: MAX_FAILURES,
  windowSeconds: WINDOW_MS / 1000,
  blockSeconds: BLOCK_MS / 1000
});
