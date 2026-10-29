import { json, getDatabase, newId } from "./http.js";

export const SESSION_COOKIE = "apa_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
// Test prototype only: matches the observed Workers Web Crypto ceiling. Not a production security approval.
const PBKDF2_ITERATIONS = 100_000;
const PASSWORD_MAX_LENGTH = 128;
const USERNAME_PATTERN = /^test-[a-z0-9][a-z0-9_-]{1,26}$/;
const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{2})+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derivePasswordHash(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function hashSessionToken(token) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export function validateCredentials(value) {
  const username = typeof value.username === "string" ? value.username.trim().toLowerCase() : "";
  const password = typeof value.password === "string" ? value.password : "";
  const errors = {};
  if (!USERNAME_PATTERN.test(username)) {
    errors.username = "must_start_with_test_and_use_7_to_32_lowercase_letters_numbers_underscores_or_hyphens";
  }
  if (password.length < 10 || password.length > PASSWORD_MAX_LENGTH) {
    errors.password = "must_be_10_to_128_characters";
  }
  if (Object.keys(errors).length) return { errors };
  return { value: { username, password } };
}

export function sameOriginError(request) {
  const origin = request.headers.get("origin");
  let expectedOrigin;
  try {
    expectedOrigin = new URL(request.url).origin;
  } catch {
    return json({ error: "invalid_request_origin" }, 400);
  }
  if (!origin || origin !== expectedOrigin) {
    return json({ error: "same_origin_required" }, 403);
  }
  return null;
}

export function getSessionCookie(request) {
  const cookie = request.headers.get("cookie") || "";
  const match = new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([a-f0-9]{64})(?:;|$)", "i").exec(cookie);
  return match?.[1] || null;
}

export function sessionCookie(token) {
  return SESSION_COOKIE + "=" + token +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + SESSION_TTL_SECONDS;
}

export function expiredSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

export async function createPasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  return {
    password_hash: toHex(hash),
    password_salt: toHex(salt),
    password_iterations: PBKDF2_ITERATIONS
  };
}

export async function verifyPassword(password, user) {
  const salt = fromHex(user?.password_salt);
  const expected = fromHex(user?.password_hash);
  const iterations = Number(user?.password_iterations);
  if (!salt || !expected || expected.length !== 32 ||
      !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    // Keep unknown-user and malformed-record login attempts computationally comparable.
    await derivePasswordHash(password, new Uint8Array(16));
    return false;
  }
  const actual = await derivePasswordHash(password, salt, iterations);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function createSession(db, userId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toHex(tokenBytes);
  const tokenHash = await hashSessionToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const createdAt = new Date(now).toISOString();

  // A login rotates sessions for this user, invalidating previously issued tokens.
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, userId, expiresAt, createdAt).run();

  return { cookie: sessionCookie(token), expiresAt };
}

export async function requireSession(request, env) {
  const db = getDatabase(env);
  if (!db) return { error: json({ error: "database_not_configured" }, 503) };
  const token = getSessionCookie(request);
  if (!token) return { error: json({ error: "unauthorized" }, 401) };

  const tokenHash = await hashSessionToken(token);
  const now = Date.now();
  try {
    const user = await db.prepare(
      "SELECT u.id, u.username, u.created_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
    ).bind(tokenHash, now).first();
    if (!user) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ? AND expires_at <= ?")
        .bind(tokenHash, now).run();
      return { error: json({ error: "unauthorized" }, 401) };
    }
    return { db, user: { id: user.id, username: user.username, created_at: user.created_at } };
  } catch {
    return { error: json({ error: "database_error" }, 500) };
  }
}

export async function revokeSession(request, db) {
  const token = getSessionCookie(request);
  if (!token) return;
  const tokenHash = await hashSessionToken(token);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export function publicUser(user) {
  return { id: user.id, username: user.username, created_at: user.created_at };
}

export function newUserId() {
  return newId();
}
