import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as aliasesHandler } from "../functions/api/aliases.js";
import { onRequest as aliasItemHandler } from "../functions/api/aliases/[id].js";
import { onRequest as registerHandler } from "../functions/api/auth/register.js";
import { onRequest as loginHandler } from "../functions/api/auth/login.js";
import { onRequest as logoutHandler } from "../functions/api/auth/logout.js";
import { onRequest as meHandler } from "../functions/api/auth/me.js";
import { readJsonObject } from "../functions/_lib/http.js";
import { SESSION_COOKIE } from "../functions/_lib/auth.js";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";

const ORIGIN = "https://apa.test";
const COOKIE = SESSION_COOKIE + "=" + "a".repeat(64);
const USER = { id: "user-a", username: "alice", created_at: "2026-01-01T00:00:00.000Z" };
const ALIAS_ID = "00000000-0000-4000-8000-000000000001";

function request(path, {
  method = "GET",
  body,
  contentType = "application/json",
  cookie = COOKIE,
  origin = ["POST", "PATCH", "DELETE"].includes(method) ? ORIGIN : null,
  headers: extraHeaders = {}
} = {}) {
  const headers = new Headers(extraHeaders);
  if (body !== undefined) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

function apiDb({
  user = USER,
  aliases = [],
  runResult = { meta: { changes: 1 } },
  runError = null,
  allError = null
} = {}) {
  const state = { calls: [], aliases };
  return {
    state,
    prepare(sql) {
      const call = { sql, values: [] };
      state.calls.push(call);
      return {
        bind(...values) { call.values = values; return this; },
        async first() {
          if (/FROM sessions s JOIN users u/i.test(sql)) {
            return user ? { ...user, expires_at: Date.now() + 60_000 } : null;
          }
          return null;
        },
        async all() {
          if (allError) throw allError;
          if (/FROM aliases WHERE/i.test(sql)) return { results: aliases };
          return { results: [] };
        },
        async run() {
          if (runError) throw runError;
          return runResult;
        }
      };
    }
  };
}

function context(req, db = apiDb(), params = {}) {
  return { request: req, env: { DB: db }, params };
}

test("authenticated alias listing binds owner, filters, and bounded limit", async () => {
  const db = apiDb({ aliases: [{ id: ALIAS_ID, name: "Books", category: "achats", status: "active" }] });
  const response = await aliasesHandler(context(request("/api/aliases?category=achats&status=active&limit=25"), db));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).aliases.length, 1);
  const query = db.state.calls.find((call) => /FROM aliases WHERE/i.test(call.sql));
  assert.ok(query);
  assert.match(query.sql, /owner_id = \?/);
  assert.match(query.sql, /category = \?/);
  assert.match(query.sql, /status = \?/);
  assert.deepEqual(query.values, [USER.id, "achats", "active", 25]);
});

test("alias listing rejects invalid category, status, and limit values", async () => {
  for (const [query, expectedError] of [
    ["?category=unknown", "invalid_category"],
    ["?status=deleted", "invalid_status"],
    ["?limit=0", "invalid_limit"],
    ["?limit=101", "invalid_limit"],
    ["?limit=1.5", "invalid_limit"],
    ["?limit=NaN", "invalid_limit"]
  ]) {
    const response = await aliasesHandler(context(request("/api/aliases" + query), apiDb()));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, expectedError, query);
  }
});

test("alias creation rejects bad input before writing and maps label conflicts to 409", async () => {
  const invalidDb = apiDb();
  const invalid = await aliasesHandler(context(request("/api/aliases", {
    method: "POST", body: { name: "bad\u0000name", category: "achats" }
  }), invalidDb));
  assert.equal(invalid.status, 400);
  assert.equal(invalidDb.state.calls.some((call) => /^INSERT INTO aliases/i.test(call.sql)), false);

  const conflictDb = apiDb({ runError: new Error("UNIQUE constraint failed: aliases.label") });
  const conflict = await aliasesHandler(context(request("/api/aliases", {
    method: "POST", body: { name: "Books", category: "achats" }
  }), conflictDb));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: "alias_conflict_retry" });
});

test("alias list and mutation endpoints fail closed when the database is missing", async () => {
  const req = request("/api/aliases");
  const noDb = { request: req, env: {} };
  const response = await aliasesHandler(noDb);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "database_not_configured" });

  const register = await registerHandler({ request: request("/api/auth/register", {
    method: "POST", body: { username: "alice", password: "correct horse battery" }
  }), env: {} });
  const login = await loginHandler({ request: request("/api/auth/login", {
    method: "POST", body: { username: "alice", password: "correct horse battery" }
  }), env: {} });
  const logout = await logoutHandler({ request: request("/api/auth/logout", { method: "POST" }), env: {} });
  assert.equal(register.status, 503);
  assert.equal(login.status, 503);
  assert.equal(logout.status, 503);
});

test("alias item rejects malformed IDs and invalid status before database writes", async () => {
  const db = apiDb();
  const malformed = await aliasItemHandler(context(request("/api/aliases/not-an-id", {
    method: "PATCH", body: { status: "paused" }
  }), db, { id: "not-an-id" }));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "invalid_alias_id" });

  const invalidStatus = await aliasItemHandler(context(request("/api/aliases/" + ALIAS_ID, {
    method: "PATCH", body: { status: "deleted" }
  }), db, { id: ALIAS_ID }));
  assert.equal(invalidStatus.status, 400);
  assert.deepEqual((await invalidStatus.json()).fields, { status: "invalid_status" });
  assert.equal(db.state.calls.some((call) => /^(UPDATE|DELETE) aliases/i.test(call.sql)), false);
});

test("alias item mutations return 404 for missing rows and 500 without leaking database details", async () => {
  const missingDb = apiDb({ runResult: { meta: { changes: 0 } } });
  const patch = await aliasItemHandler(context(request("/api/aliases/" + ALIAS_ID, {
    method: "PATCH", body: { status: "paused" }
  }), missingDb, { id: ALIAS_ID }));
  const deletion = await aliasItemHandler(context(request("/api/aliases/" + ALIAS_ID, {
    method: "DELETE"
  }), missingDb, { id: ALIAS_ID }));
  assert.equal(patch.status, 404);
  assert.equal(deletion.status, 404);

  const brokenDb = apiDb({ runError: new Error("secret SQL connection detail") });
  const failed = await aliasItemHandler(context(request("/api/aliases/" + ALIAS_ID, {
    method: "DELETE"
  }), brokenDb, { id: ALIAS_ID }));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "database_error" });
  assert.equal(JSON.stringify(await failed.clone().json()).includes("secret SQL"), false);
});

test("state-changing API routes reject foreign origins before database access", async () => {
  for (const [handler, path, method, body, params] of [
    [aliasesHandler, "/api/aliases", "POST", { name: "Books", category: "achats" }, {}],
    [aliasItemHandler, "/api/aliases/" + ALIAS_ID, "PATCH", { status: "paused" }, { id: ALIAS_ID }],
    [aliasItemHandler, "/api/aliases/" + ALIAS_ID, "DELETE", undefined, { id: ALIAS_ID }],
    [logoutHandler, "/api/auth/logout", "POST", undefined, {}]
  ]) {
    const db = apiDb();
    const response = await handler(context(request(path, {
      method, body, origin: "https://evil.example"
    }), db, params));
    assert.equal(response.status, 403, method + " " + path);
    assert.equal(db.state.calls.length, 0, "foreign-origin request must be rejected before DB access");
  }
});

test("JSON parser rejects invalid and oversized declared Content-Length values", async () => {
  const invalid = await readJsonObject(request("/api/aliases", {
    method: "POST", body: "{}", headers: { "content-length": "2x" }
  }));
  assert.equal(invalid.error.status, 400);
  assert.equal((await invalid.error.json()).error, "invalid_content_length");

  const oversized = await readJsonObject(request("/api/aliases", {
    method: "POST", body: "{}", headers: { "content-length": "4097" }
  }));
  assert.equal(oversized.error.status, 413);
  assert.equal((await oversized.error.json()).error, "request_body_too_large");
});

test("authentication endpoints expose method contracts and reject foreign logout origins", async () => {
  const wrongMethod = await meHandler(context(request("/api/auth/me", { method: "POST" }), apiDb()));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");

  const foreignLogout = await logoutHandler(context(request("/api/auth/logout", {
    method: "POST", origin: "https://evil.example"
  }), apiDb()));
  assert.equal(foreignLogout.status, 403);
  assert.deepEqual(await foreignLogout.json(), { error: "same_origin_required" });
});

test("API middleware applies the complete security-header baseline without overwriting explicit headers", async () => {
  const response = await apiMiddleware({
    request: request("/api/test"),
    next: async () => new Response("ok", {
      headers: { "content-security-policy": "default-src 'self'", "x-custom": "kept" }
    })
  });
  const expected = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=31536000"
  };
  for (const [header, value] of Object.entries(expected)) {
    assert.equal(response.headers.get(header), value, header);
  }
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.equal(response.headers.get("x-custom"), "kept");
});
