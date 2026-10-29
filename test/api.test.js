import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as aliasesHandler } from "../functions/api/aliases.js";
import { onRequest as aliasItemHandler } from "../functions/api/aliases/[id].js";
import { onRequestGet as healthHandler } from "../functions/api/health.js";
import {
  isValidId,
  newInternalLabel,
  readJsonObject,
  requireApiToken,
  validateAliasInput,
  validateStatusInput
} from "../functions/_lib/http.js";

const TOKEN = "test-token-that-is-at-least-32-characters-long";

function request(path, { method = "GET", token = TOKEN, body, contentType = "application/json" } = {}) {
  const headers = new Headers();
  if (token !== null) headers.set("authorization", "Bearer " + token);
  if (body !== undefined) {
    headers.set("content-type", contentType);
  }
  return new Request("https://apa.test" + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}

function context(req, { token = TOKEN, db = fakeDb() } = {}, params = {}) {
  return {
    request: req,
    env: { APA_API_TOKEN: token, DB: db },
    params,
    next: () => new Response(null, { status: 204 })
  };
}

function fakeDb() {
  const state = { rows: [], lastSql: "", lastValues: [] };
  return {
    state,
    prepare(sql) {
      state.lastSql = sql;
      const statement = {
        values: [],
        bind(...values) { this.values = values; state.lastValues = values; return this; },
        async all() {
          let rows = [...state.rows];
          const category = state.lastValues.find((v) => ["achats", "projets", "public", "personnel"].includes(v));
          const status = state.lastValues.find((v) => ["planned", "active", "paused"].includes(v));
          if (category) rows = rows.filter((row) => row.category === category);
          if (status) rows = rows.filter((row) => row.status === status);
          const limit = state.lastValues[state.lastValues.length - 1];
          return { results: rows.slice(0, typeof limit === "number" ? limit : 50) };
        },
        async first() { return state.rows[0] || null; },
        async run() {
          const sqlText = state.lastSql;
          const values = state.lastValues;
          if (sqlText.startsWith("INSERT")) {
            state.rows.push({
              id: values[0], name: values[1], label: values[2], category: values[3],
              status: values[4], created_at: values[5], updated_at: values[6]
            });
            return { meta: { changes: 1 } };
          }
          if (sqlText.startsWith("UPDATE")) {
            const row = state.rows.find((item) => item.id === values[2]);
            if (!row) return { meta: { changes: 0 } };
            row.status = values[0]; row.updated_at = values[1];
            return { meta: { changes: 1 } };
          }
          if (sqlText.startsWith("DELETE")) {
            const before = state.rows.length;
            state.rows = state.rows.filter((item) => item.id !== values[0]);
            return { meta: { changes: before - state.rows.length } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    }
  };
}

test("health endpoint returns minimal public status", async () => {
  const response = healthHandler();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "apa-api" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("API rejects requests without a valid bearer token", async () => {
  const req = request("/api/aliases", { token: null });
  const response = await aliasesHandler(context(req));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "unauthorized");
});

test("API fails closed when token secret is not configured", async () => {
  const req = request("/api/aliases");
  const response = await aliasesHandler(context(req, { token: "short" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "service_not_configured");
});

test("collection rejects unsupported HTTP methods", async () => {
  const response = await aliasesHandler(context(request("/api/aliases", { method: "DELETE" })));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, POST");
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

test("status validator only accepts the three known statuses", () => {
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

test("POST creates a D1 alias record and returns 201", async () => {
  const db = fakeDb();
  const response = await aliasesHandler(context(request("/api/aliases", {
    method: "POST",
    body: { name: "Boutique de livres", category: "achats" }
  }), { db }));
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.alias.name, "Boutique de livres");
  assert.equal(payload.alias.status, "planned");
  assert.match(payload.alias.label, /^boutique-de-livres-[a-f0-9]{8}$/);
  assert.equal(db.state.rows.length, 1);
});

test("GET supports safe category/status filters and rejects invalid limit", async () => {
  const db = fakeDb();
  db.state.rows.push({
    id: "00000000-0000-4000-8000-000000000001", name: "Test", label: "test-12345678",
    category: "achats", status: "active", created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  });
  const response = await aliasesHandler(context(request("/api/aliases?category=achats&status=active"), { db }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).aliases.length, 1);
  const invalid = await aliasesHandler(context(request("/api/aliases?limit=1000"), { db }));
  assert.equal(invalid.status, 400);
});

test("PATCH updates status and DELETE removes an alias", async () => {
  const db = fakeDb();
  const id = "00000000-0000-4000-8000-000000000001";
  db.state.rows.push({
    id, name: "Test", label: "test-12345678", category: "projets", status: "planned",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z"
  });
  const patch = await aliasItemHandler(context(request("/api/aliases/" + id, {
    method: "PATCH", body: { status: "paused" }
  }), { db }, { id }));
  assert.equal(patch.status, 200);
  assert.equal(db.state.rows[0].status, "paused");

  const deletion = await aliasItemHandler(context(request("/api/aliases/" + id, { method: "DELETE" }), { db }, { id }));
  assert.equal(deletion.status, 200);
  assert.equal(db.state.rows.length, 0);
});

test("item routes return 404 when alias does not exist", async () => {
  const id = "00000000-0000-4000-8000-000000000002";
  const response = await aliasItemHandler(context(request("/api/aliases/" + id, { method: "DELETE" }), {}, { id }));
  assert.equal(response.status, 404);
});

test("request body size is limited", async () => {
  const oversized = await readJsonObject(request("/api/aliases", {
    method: "POST",
    body: { name: "x".repeat(5000), category: "achats" }
  }));
  assert.equal(oversized.error.status, 413);
});
