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
import { SESSION_COOKIE } from "../functions/_lib/auth.js";

const USER_A = { username: "alice", password: "correct horse battery" };
const USER_B = { username: "bob", password: "another strong password" };
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
  const state = { users: [], sessions: [], aliases: [], lastSql: "", lastValues: [] };
  return {
    state,
    prepare(sql) {
      state.lastSql = sql;
      const statement = {
        values: [],
        bind(...values) { this.values = values; state.lastValues = values; return this; },
        async first() {
          const values = state.lastValues;
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

async function createAlias(db, cookie, name = "Private alias") {
  return aliasesHandler(context(request("/api/aliases", {
    method: "POST", cookie, body: { name, category: "achats" }
  }), db));
}

test("health endpoint returns minimal public status", async () => {
  const response = healthHandler({ request: request("/api/health") });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "apa-api" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("registration creates a user and a secure HttpOnly session cookie", async () => {
  const db = fakeDb();
  const response = await register(db);
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.user.username, "alice");
  assert.equal("password" in payload, false);
  assert.equal("password_hash" in payload.user, false);
  assert.equal("password_salt" in payload.user, false);
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
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
  const response = await register(fakeDb(), { username: "alice", password: "short123" });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).fields.password, "must_be_10_to_128_characters");
});

test("registration normalizes usernames and rejects duplicate accounts", async () => {
  const db = fakeDb();
  const first = await register(db, { username: "Alice", password: USER_A.password });
  const duplicate = await register(db, { username: "ALICE", password: USER_A.password });
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "username_unavailable" });
  assert.equal(db.state.users.length, 1);
});

test("registration rejects malformed usernames", async () => {
  const response = await register(fakeDb(), { username: "a!", password: USER_A.password });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).fields.username,
    "must_be_3_to_32_lowercase_letters_numbers_underscores_or_hyphens");
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
  assert.deepEqual((await newMe.json()).user.username, "alice");
});

test("login refuses an incorrect password without issuing a cookie", async () => {
  const db = fakeDb();
  await register(db);
  const response = await login(db, { username: "alice", password: "wrong password here" });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  assert.equal(response.headers.has("set-cookie"), false);
});

test("login uses a generic failure for an unknown username", async () => {
  const response = await login(fakeDb(), { username: "unknown", password: "wrong password here" });
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
  const created = await createAlias(db, b, "Bob private alias");
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
  const created = await createAlias(db, b, "Bob private alias");
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
  assert.equal(db.state.aliases[0].owner_id, db.state.users.find((user) => user.username === "bob").id);
});

test("authenticated owner can create and list only their own alias", async () => {
  const db = fakeDb();
  const cookie = cookieHeader(await register(db));
  const created = await createAlias(db, cookie, "Book shop");
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
    body: { name: "Blocked", category: "achats" }
  }), db));
  assert.equal(response.status, 403);
  assert.equal(db.state.aliases.length, 0);
});

test("alias input trims names and defaults status", () => {
  assert.deepEqual(validateAliasInput({ name: "  Livres  ", category: "achats" }), {
    value: { name: "Livres", category: "achats", status: "planned" }
  });
});

test("alias input rejects empty, long, or invalid category", () => {
  assert.equal(Boolean(validateAliasInput({ name: " ", category: "achats" }).errors), true);
  assert.equal(Boolean(validateAliasInput({ name: "a".repeat(49), category: "achats" }).errors), true);
  assert.equal(Boolean(validateAliasInput({ name: "Site", category: "other" }).errors), true);
});

test("alias input rejects every ASCII control character", () => {
  const controlCodes = [...Array.from({ length: 0x20 }, (_, code) => code), 0x7f];
  for (const code of controlCodes) {
    const result = validateAliasInput({
      name: "shop" + String.fromCharCode(code) + "name",
      category: "achats"
    });
    assert.equal(Boolean(result.errors?.name), true, "Expected control code " + code + " to be rejected");
  }
});

test("status validator only accepts known statuses", () => {
  assert.deepEqual(validateStatusInput({ status: "paused" }), { value: { status: "paused" } });
  assert.equal(Boolean(validateStatusInput({ status: "deleted" }).errors), true);
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
  const invalidUtf8 = await readJsonObject(request("/api/aliases", {
    method: "POST", body: new Uint8Array([0xc3, 0x28])
  }));
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
  const response = await aliasesHandler(context(request("/api/aliases"), db));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "database_error" });
});

test("unsupported methods return 405", async () => {
  const collection = await aliasesHandler(context(request("/api/aliases", { method: "DELETE" }), fakeDb()));
  const auth = await registerHandler(context(request("/api/auth/register", { method: "GET" }), fakeDb()));
  assert.equal(collection.status, 405);
  assert.equal(auth.status, 405);
});
