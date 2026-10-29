import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as aliasesHandler } from "../functions/api/aliases.js";
import { onRequest as aliasItemHandler } from "../functions/api/aliases/[id].js";
import { onRequest as healthHandler } from "../functions/api/health.js";
import { onRequest as registerHandler } from "../functions/api/auth/register.js";
import { onRequest as loginHandler } from "../functions/api/auth/login.js";
import { onRequest as logoutHandler } from "../functions/api/auth/logout.js";
import { onRequest as meHandler } from "../functions/api/auth/me.js";
import {
  isValidId, newInternalLabel, readJsonObject, validateAliasInput, validateStatusInput
} from "../functions/_lib/http.js";
import { SESSION_COOKIE, createPasswordRecord } from "../functions/_lib/auth.js";
import { LOGIN_RATE_LIMIT_POLICY, recordLoginFailure } from "../functions/_lib/login-rate-limit.js";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";

const USER_A = { username: "test-alice", password: "correct horse battery" };
const USER_B = { username: "test-bob", password: "another strong password" };
const ORIGIN = "https://apa.test";

function request(path, {
  method = "GET", body, contentType = "application/json", cookie = null,
  origin = ["POST", "PATCH", "DELETE"].includes(method) ? ORIGIN : null
} = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

function context(req, db = fakeDb(), params = {}) {
  return { request: req, env: { DB: db }, params, next: () => new Response(null, { status: 204 }) };
}

function fakeDb() {
  const state = { users: [], sessions: [], aliases: [], loginLimits: [], lastSql: "", lastValues: [] };
  return {
    state,
    prepare(sql) {
      state.lastSql = sql;
      const statement = {
        values: [],
        bind(...values) { this.values = values; state.lastValues = values; return this; },
        async first() {
          const values = state.lastValues;
          if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
          if (/SELECT COUNT\(\*\) AS count FROM users/i.test(sql)) return { count: state.users.length };
          if (/SELECT COUNT\(\*\) AS count FROM aliases WHERE owner_id = \?/i.test(sql)) {
            return { count: state.aliases.filter((item) => item.owner_id === values[0]).length };
          }
          if (/FROM auth_login_limits WHERE key_hash = \?/i.test(sql)) {
            const row = state.loginLimits.find((item) => item.key_hash === values[0]);
            return row ? { blocked_until: row.blocked_until, window_started_at: row.window_started_at } : null;
          }
          if (/FROM users WHERE username = \?/i.test(sql)) {
            const user = state.users.find((item) => item.username.toLowerCase() === String(values[0]).toLowerCase());
            if (!user) return null;
            if (/password_hash/i.test(sql)) return { ...user };
            return { id: user.id };
          }
          if (/FROM sessions s JOIN users u/i.test(sql)) {
            const session = state.sessions.find((item) => item.token_hash === values[0] && item.expires_at > values[1]);
            if (!session) return null;
            const user = state.users.find((item) => item.id === session.user_id);
            return user ? { id: user.id, username: user.username, created_at: user.created_at, expires_at: session.expires_at } : null;
          }
          return null;
        },
        async all() {
          if (/FROM aliases WHERE/i.test(sql)) {
            const values = state.lastValues;
            let rows = state.aliases.filter((item) => item.owner_id === values[0]);
            if (/category = \?/i.test(sql)) rows = rows.filter((item) => item.category === values[1]);
            if (/status = \?/i.test(sql)) {
              const index = /category = \?/i.test(sql) ? 2 : 1;
              rows = rows.filter((item) => item.status === values[index]);
            }
            const limit = values[values.length - 1];
            return { results: rows.slice(0, limit).map(({ owner_id, ...item }) => item) };
          }
          return { results: [] };
        },
        async run() {
          const values = state.lastValues;
          if (/^INSERT INTO auth_login_limits/i.test(sql)) {
            const [key_hash, now, updated_at, windowCutoff, windowCutoff2, windowCutoff3, maxFailures, blockedUntil] = values;
            let row = state.loginLimits.find((item) => item.key_hash === key_hash);
            if (!row) {
              row = { key_hash, failed_attempts: 1, window_started_at: now, blocked_until: null, updated_at };
              state.loginLimits.push(row);
            } else {
              if (row.window_started_at < windowCutoff) {
                row.failed_attempts = 1;
                row.window_started_at = now;
              } else {
                row.failed_attempts += 1;
              }
              if (row.failed_attempts >= maxFailures) row.blocked_until = blockedUntil;
              row.updated_at = updated_at;
            }
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM auth_login_limits WHERE updated_at < \\?/i.test(sql)) {
            const before = state.loginLimits.length;
            state.loginLimits = state.loginLimits.filter((item) => item.updated_at >= values[0]);
            return { meta: { changes: before - state.loginLimits.length } };
          }
          if (/^DELETE FROM auth_login_limits WHERE key_hash = \?/i.test(sql)) {
            const before = state.loginLimits.length;
            state.loginLimits = state.loginLimits.filter((item) => item.key_hash !== values[0]);
            return { meta: { changes: before - state.loginLimits.length } };
          }
          if (/^INSERT INTO users/i.test(sql)) {
            if (state.users.some((item) => item.username.toLowerCase() === String(values[1]).toLowerCase())) {
              throw new Error("UNIQUE constraint failed: users.username");
            }
            state.users.push({
              id: values[0], username: values[1], password_hash: values[2], password_salt: values[3],
              password_iterations: values[4], created_at: values[5]
            });
            return { meta: { changes: 1 } };
          }
          if (/^INSERT INTO sessions/i.test(sql)) {
            state.sessions.push({ token_hash: values[0], user_id: values[1], expires_at: values[2], created_at: values[3] });
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM sessions WHERE user_id = \?/i.test(sql)) {
            const before = state.sessions.length;
            state.sessions = state.sessions.filter((item) => item.user_id !== values[0]);
            return { meta: { changes: before - state.sessions.length } };
          }
          if (/^DELETE FROM sessions WHERE token_hash = \? AND expires_at <= \?/i.test(sql)) {
            const before = state.sessions.length;
            state.sessions = state.sessions.filter((item) => !(item.token_hash === values[0] && item.expires_at <= values[1]));
            return { meta: { changes: before - state.sessions.length } };
          }
          if (/^DELETE FROM sessions WHERE token_hash = \?/i.test(sql)) {
            const before = state.sessions.length;
            state.sessions = state.sessions.filter((item) => item.token_hash !== values[0]);
            return { meta: { changes: before - state.sessions.length } };
          }
          if (/^INSERT INTO aliases/i.test(sql)) {
            if (state.aliases.some((item) => item.id === values[0] || item.label === values[2])) {
              throw new Error("UNIQUE constraint failed: aliases.label");
            }
            state.aliases.push({
              id: values[0], name: values[1], label: values[2], category: values[3], status: values[4],
              created_at: values[5], updated_at: values[6], owner_id: values[7]
            });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE aliases SET status/i.test(sql)) {
            const row = state.aliases.find((item) => item.id === values[2] && item.owner_id === values[3]);
            if (!row) return { meta: { changes: 0 } };
            row.status = values[0]; row.updated_at = values[1];
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM aliases WHERE id = \? AND owner_id = \?/i.test(sql)) {
            const before = state.aliases.length;
            state.aliases = state.aliases.filter((item) => !(item.id === values[0] && item.owner_id === values[1]));
            return { meta: { changes: before - state.aliases.length } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    }
  };
}

function cookieHeader(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = new RegExp(SESSION_COOKIE + "=([a-f0-9]{64})", "i").exec(setCookie);
  assert.ok(match, "expected session cookie to contain a random token");
  return SESSION_COOKIE + "=" + match[1];
}

async function register(db, credentials = USER_A) {
  return registerHandler(context(request("/api/auth/register", { method: "POST", body: credentials }), db));
}

async function login(db, credentials = USER_A) {
  return loginHandler(context(request("/api/auth/login", { method: "POST", body: credentials }), db));
}

async function createAlias(db, cookie, name = "test-private-alias") {
  return aliasesHandler(context(request("/api/aliases", {
    method: "POST", cookie, body: { name, category: "achats" }
  }), db));
}

test("health endpoint verifies D1 connectivity and returns minimal public status", async () => {
  const response = await healthHandler(context(request("/api/health"), fakeDb()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "apa-test-api", database: "ok" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("health endpoint fails closed when D1 is not configured", async () => {
  const response = await healthHandler({ request: request("/api/health"), env: {} });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: "apa-test-api", database: "unavailable" });
});

test("registration creates a user and a secure HttpOnly session cookie", async () => {
  const db = fakeDb();
  const response = await register(db);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.user.username, "test-alice");
  assert.equal("password" in payload, false);
  assert.equal("password_hash" in payload.user, false);
  assert.equal("password_salt" in payload.user, false);
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=None/i);
  assert.match(setCookie, /Path=\//i);
  assert.match(setCookie, /Max-Age=604800/i);
  assert.equal(db.state.users.length, 1);
  assert.notEqual(db.state.users[0].password_hash, USER_A.password);
  assert.equal(db.state.users[0].password_hash.length, 64);
  assert.equal(db.state.users[0].password_salt.length, 32);
  assert.equal(db.state.sessions.length, 1);
  assert.equal(db.state.sessions[0].token_hash.length, 64);
  assert.equal(db.state.sessions[0].token_hash, db.state.sessions[0].token_hash.toLowerCase());
  assert.equal(setCookie.includes(db.state.sessions[0].token_hash), false);
});

test("registration rejects passwords shorter than ten characters", async () => {
  const response = await register(fakeDb(), { username: "test-alice", password: "short123" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "password_must_be_10_to_128_characters" });
});

test("registration normalizes usernames and rejects duplicate accounts", async () => {
  const db = fakeDb();
  const first = await register(db, { username: "Test-Alice", password: USER_A.password });
  const duplicate = await register(db, { username: "TEST-ALICE", password: USER_A.password });
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "username_unavailable" });
  assert.equal(db.state.users.length, 1);
});

test("registration rejects malformed usernames and usernames without the test prefix", async () => {
  const response = await register(fakeDb(), { username: "ordinary-user", password: USER_A.password });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "test_username_required" });
});

test("login accepts the correct password and rotates the prior session", async () => {
  const db = fakeDb();
  const registered = await register(db);
  const oldCookie = cookieHeader(registered);
  const loggedIn = await login(db);
  assert.equal(loggedIn.status, 200);
  const newCookie = cookieHeader(loggedIn);
  assert.notEqual(oldCookie, newCookie);
  assert.equal(db.state.sessions.length, 1);
  const oldMe = await meHandler(context(request("/api/auth/me", { cookie: oldCookie }), db));
  const newMe = await meHandler(context(request("/api/auth/me", { cookie: newCookie }), db));
  assert.equal(oldMe.status, 401);
  assert.equal(newMe.status, 200);
  assert.deepEqual((await newMe.json()).user.username, "test-alice");
});

test("login refuses an incorrect password without issuing a cookie", async () => {
  const db = fakeDb();
  await register(db);
  const response = await login(db, { username: "test-alice", password: "wrong password here" });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  assert.equal(response.headers.has("set-cookie"), false);
});

test("login uses a generic failure for an unknown username", async () => {
  const response = await login(fakeDb(), { username: "test-unknown", password: "wrong password here" });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
});

test("me refuses missing session cookies", async () => {
  const response = await meHandler(context(request("/api/auth/me"), fakeDb()));
  assert.equal(response.status, 401);
});

test("logout invalidates the session and expires the cookie", async () => {
  const db = fakeDb();
  const registered = await register(db);
  const cookie = cookieHeader(registered);
  const response = await logoutHandler(context(request("/api/auth/logout", { method: "POST", cookie }), db));
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(response.headers.get("set-cookie") || "", /Max-Age=0/i);
  assert.equal(db.state.sessions.length, 0);
  const me = await meHandler(context(request("/api/auth/me", { cookie }), db));
  assert.equal(me.status, 401);
});

test("expired sessions are rejected", async () => {
  const db = fakeDb();
  const registered = await register(db);
  const cookie = cookieHeader(registered);
  db.state.sessions[0].expires_at = Date.now() - 1;
  const response = await meHandler(context(request("/api/auth/me", { cookie }), db));
  assert.equal(response.status, 401);
});

test("authentication mutation endpoints reject missing or foreign Origin headers", async () => {
  const db = fakeDb();
  const noOrigin = await registerHandler(context(request("/api/auth/register", {
    method: "POST", body: USER_A, origin: null
  }), db));
  const foreignOrigin = await loginHandler(context(request("/api/auth/login", {
    method: "POST", body: USER_A, origin: "https://evil.example"
  }), db));
  assert.equal(noOrigin.status, 403);
  assert.equal(foreignOrigin.status, 403);
});

test("all alias endpoints require a valid session", async () => {
  const db = fakeDb();
  const id = "00000000-0000-4000-8000-000000000001";
  const get = await aliasesHandler(context(request("/api/aliases"), db));
  const post = await aliasesHandler(context(request("/api/aliases", {
    method: "POST", body: { name: "No session", category: "achats" }
  }), db));
  const patch = await aliasItemHandler(context(request("/api/aliases/" + id, {
    method: "PATCH", body: { status: "paused" }
  }), db, { id }));
  const deletion = await aliasItemHandler(context(request("/api/aliases/" + id, {
    method: "DELETE"
  }), db, { id }));
  for (const response of [get, post, patch, deletion]) assert.equal(response.status, 401);
});

test("user A cannot read user B aliases", async () => {
  const db = fakeDb();
  const a = cookieHeader(await register(db, USER_A));
  const b = cookieHeader(await register(db, USER_B));
  const created = await createAlias(db, b, "test-bob-private-alias");
  assert.equal(created.status, 201);
  const response = await aliasesHandler(context(request("/api/aliases", { cookie: a }), db));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).aliases, []);
  assert.match(db.state.lastSql, /owner_id = \?/);
});

test("user A cannot update or delete user B aliases", async () => {
  const db = fakeDb();
  const a = cookieHeader(await register(db, USER_A));
  const b = cookieHeader(await register(db, USER_B));
  const created = await createAlias(db, b, "test-bob-private-alias");
  const alias = (await created.json()).alias;
  const patch = await aliasItemHandler(context(request("/api/aliases/" + alias.id, {
    method: "PATCH", cookie: a, body: { status: "paused" }
  }), db, { id: alias.id }));
  const deletion = await aliasItemHandler(context(request("/api/aliases/" + alias.id, {
    method: "DELETE", cookie: a
  }), db, { id: alias.id }));
  assert.equal(patch.status, 404);
  assert.equal(deletion.status, 404);
  assert.equal(db.state.aliases.length, 1);
  assert.equal(db.state.aliases[0].status, "planned");
  assert.equal(db.state.aliases[0].owner_id, db.state.users.find((user) => user.username === "test-bob").id);
});

test("authenticated owner can create and list only their own alias", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const created = await createAlias(db, cookie, "test-book-shop");
  assert.equal(created.status, 201);
  const alias = (await created.json()).alias;
  assert.equal(db.state.aliases[0].owner_id, db.state.users[0].id);
  const listed = await aliasesHandler(context(request("/api/aliases", { cookie }), db));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).aliases[0].id, alias.id);
});

test("alias mutation rejects a foreign Origin", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const response = await aliasesHandler(context(request("/api/aliases", {
    method: "POST", cookie, origin: "https://evil.example",
    body: { name: "test-blocked", category: "achats" }
  }), db));
  assert.equal(response.status, 403);
  assert.equal(db.state.aliases.length, 0);
});

test("alias input trims names and defaults status", () => {
  assert.deepEqual(validateAliasInput({ name: "  test-livres  ", category: "achats" }), {
    value: { name: "test-livres", category: "achats", status: "planned" }
  });
});

test("alias input rejects empty, long, or invalid category", () => {
  assert.deepEqual(validateAliasInput({ name: " ", category: "achats" }), { error: "test_alias_name_required" });
  assert.deepEqual(validateAliasInput({ name: "test-" + "a".repeat(43), category: "achats" }), { error: "test_alias_name_required" });
  assert.deepEqual(validateAliasInput({ name: "test-site", category: "other" }), { error: "invalid_category" });
});

test("alias input rejects control characters including a NUL escape", () => {
  const nulCharacter = "shop" + String.fromCharCode(0) + "name";
  assert.equal(nulCharacter.charCodeAt(4), 0, "fixture must contain a real NUL control character");
  assert.deepEqual(validateAliasInput({ name: nulCharacter, category: "achats" }), { error: "test_alias_name_required" });
  const controlCodes = [...Array.from({ length: 0x20 }, (_, code) => code), 0x7f];
  for (const code of controlCodes) {
    const result = validateAliasInput({
      name: "shop" + String.fromCharCode(code) + "name",
      category: "achats"
    });
    assert.deepEqual(result, { error: "test_alias_name_required" }, "Expected control code " + code + " to be rejected");
  }
});

test("status validator only accepts known statuses", () => {
  assert.deepEqual(validateStatusInput({ status: "paused" }), { value: "paused" });
  assert.deepEqual(validateStatusInput({ status: "deleted" }), { error: "invalid_status" });
});

test("internal labels are normalized and are not email addresses", () => {
  const label = newInternalLabel("Café & Projets");
  assert.match(label, /^cafe-projets-[a-f0-9]{8}$/);
  assert.equal(label.includes("@"), false);
});

test("alias IDs reject malformed input", () => {
  assert.equal(isValidId("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isValidId("../secrets"), false);
  assert.equal(isValidId("not-an-id"), false);
});

test("JSON parser rejects wrong content type, malformed JSON, and arrays", async () => {
  const wrongType = await readJsonObject(request("/api/aliases", { method: "POST", body: "{}", contentType: "text/plain" }));
  assert.equal(wrongType.error.status, 415);
  const malformed = await readJsonObject(request("/api/aliases", { method: "POST", body: "{" }));
  assert.equal(malformed.error.status, 400);
  const array = await readJsonObject(request("/api/aliases", { method: "POST", body: "[]" }));
  assert.equal(array.error.status, 400);
});

test("JSON parser rejects invalid UTF-8 and oversized request bodies", async () => {
  const invalidUtf8Request = new Request(ORIGIN + "/api/aliases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new Uint8Array([0xc3, 0x28])
  });
  const invalidUtf8 = await readJsonObject(invalidUtf8Request);
  assert.equal(invalidUtf8.error.status, 400);
  assert.equal((await invalidUtf8.error.json()).error, "invalid_request_body_encoding");
  const oversized = await readJsonObject(request("/api/aliases", {
    method: "POST", body: { name: "x".repeat(5000), category: "achats" }
  }));
  assert.equal(oversized.error.status, 413);
});

test("alias names are bound as SQL parameters rather than interpolated", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const maliciousName = "x'); DROP TABLE aliases; --";
  const response = await createAlias(db, cookie, maliciousName);
  assert.equal(response.status, 201);
  assert.equal(db.state.lastSql.includes(maliciousName), false);
  assert.equal(db.state.lastValues.includes(maliciousName), true);
});

test("database failures return generic errors without exposing internals", async () => {
  const db = {
    prepare() { throw new Error("private SQL and connection details"); }
  };
  const response = await aliasesHandler(context(request("/api/aliases", {
    cookie: SESSION_COOKIE + "=" + "a".repeat(64)
  }), db));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "database_error" });
});

test("unsupported methods return 405", async () => {
  const collection = await aliasesHandler(context(request("/api/aliases", { method: "DELETE" }), fakeDb()));
  const auth = await registerHandler(context(request("/api/auth/register", { method: "GET" }), fakeDb()));
  assert.equal(collection.status, 405);
  assert.equal(auth.status, 405);
});


test("login rate limit blocks after ten failed attempts and exposes Retry-After", async () => {
  const db = fakeDb();
  const req = () => request("/api/auth/login", {
    method: "POST", body: { username: "test-unknown-user", password: "incorrect password" },
    origin: ORIGIN
  });
  assert.equal(LOGIN_RATE_LIMIT_POLICY.maxFailures, 10);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await loginHandler(context(req(), db));
    assert.equal(response.status, 401, "failed attempt " + (attempt + 1));
  }
  assert.ok(db.state.loginLimits.length >= 2);
  const blocked = await loginHandler(context(req(), db));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await blocked.json()).error, "too_many_login_attempts");
});


test("failed logins clean up stale rate-limit buckets without deleting recent buckets", async () => {
  const db = fakeDb();
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  db.state.loginLimits.push(
    { key_hash: "stale-bucket", failed_attempts: 1, window_started_at: now - 31 * 60 * 1000,
      blocked_until: null, updated_at: new Date(now - 31 * 60 * 1000).toISOString() },
    { key_hash: "recent-bucket", failed_attempts: 2, window_started_at: now - 2 * 60 * 1000,
      blocked_until: null, updated_at: new Date(now - 2 * 60 * 1000).toISOString() }
  );

  await recordLoginFailure(db, ["new-ip-bucket", "new-username-bucket"], now);

  assert.equal(db.state.loginLimits.some((row) => row.key_hash === "stale-bucket"), false);
  assert.equal(db.state.loginLimits.some((row) => row.key_hash === "recent-bucket"), true);
  assert.equal(db.state.loginLimits.some((row) => row.key_hash === "new-ip-bucket"), true);
  assert.equal(db.state.loginLimits.some((row) => row.key_hash === "new-username-bucket"), true);
});

test("successful login clears both hashed rate-limit buckets", async () => {
  const db = fakeDb();
  await register(db);
  const bad = await login(db, { username: USER_A.username, password: "incorrect password" });
  assert.equal(bad.status, 401);
  assert.ok(db.state.loginLimits.length >= 2);
  const good = await login(db, USER_A);
  assert.equal(good.status, 200);
  assert.equal(db.state.loginLimits.length, 0);
});

test("API middleware adds security headers to responses that lack them", async () => {
  const response = await apiMiddleware({
    request: request("/api/test"),
    next: async () => new Response("ok", { status: 200 })
  });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'none'/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});


test("legacy alias rows with owner_id NULL stay preserved and invisible to authenticated users", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const legacy = {
    id: "00000000-0000-4000-8000-000000000099",
    name: "Legacy synthetic alias",
    label: "legacy-synthetic",
    category: "public",
    status: "active",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    owner_id: null
  };
  db.state.aliases.push(legacy);

  const listed = await aliasesHandler(context(request("/api/aliases", { cookie }), db));
  assert.equal(listed.status, 200);
  assert.deepEqual((await listed.json()).aliases, []);
  assert.equal(db.state.aliases.length, 1, "legacy row must not be deleted");
  assert.equal(db.state.aliases[0].id, legacy.id);
  assert.equal(db.state.aliases[0].owner_id, null);
});

test("malformed session cookies are rejected without database access", async () => {
  const db = fakeDb();
  for (const cookie of [
    SESSION_COOKIE + "=not-a-token",
    SESSION_COOKIE + "=" + "a".repeat(63),
    SESSION_COOKIE + "=" + "g".repeat(64)
  ]) {
    const response = await meHandler(context(request("/api/auth/me", { cookie }), db));
    assert.equal(response.status, 401);
  }
  assert.equal(db.state.lastSql, "", "invalid cookie must not trigger a database query");
});


test("test-branch password records use the documented Workers-compatible test setting", async () => {
  const record = await createPasswordRecord("synthetic-test-password");
  assert.equal(record.password_iterations, 100_000);
  assert.match(record.password_hash, /^[a-f0-9]{64}$/);
  assert.match(record.password_salt, /^[a-f0-9]{32}$/);
});


test("registration stops at the 20-account synthetic test cap", async () => {
  const db = fakeDb();
  db.state.users = Array.from({ length: 20 }, (_, index) => ({
    id: "user-" + index,
    username: "test-fixture-" + index,
    password_hash: "a".repeat(64),
    password_salt: "b".repeat(32),
    password_iterations: 100_000,
    created_at: new Date(0).toISOString()
  }));
  const response = await register(db, { username: "test-new-user", password: USER_A.password });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "test_user_limit_reached" });
  assert.equal(db.state.users.length, 20);
  assert.equal(db.state.sessions.length, 0);
});

test("alias creation stops at 25 aliases per synthetic test user", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const ownerId = db.state.users[0].id;
  db.state.aliases = Array.from({ length: 25 }, (_, index) => ({
    id: "alias-" + index,
    name: "Fixture " + index,
    label: "fixture-" + index,
    category: "public",
    status: "active",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    owner_id: ownerId
  }));
  const response = await createAlias(db, cookie, "New synthetic alias");
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "test_alias_limit_reached" });
  assert.equal(db.state.aliases.length, 25);
});


test("API middleware handles allowed local CORS preflight and credentials", async () => {
  const preflight = await apiMiddleware({
    request: request("/api/auth/login", {
      method: "OPTIONS",
      origin: "http://localhost:3000",
      headers: { "access-control-request-method": "POST", "access-control-request-headers": "Content-Type" }
    }),
    next: async () => new Response("must not reach route")
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  assert.match(preflight.headers.get("access-control-allow-methods") || "", /PATCH/);

  const denied = await apiMiddleware({
    request: request("/api/auth/login", { method: "OPTIONS", origin: "https://evil.example" }),
    next: async () => new Response("must not reach route")
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "test_origin_not_allowed" });
});
