import test from "node:test";
import assert from "node:assert/strict";

const enabled = process.env.APA_RUN_REMOTE_TESTS === "1";
const baseUrl = (process.env.APA_TEST_API_BASE_URL ||
  "https://apa-test-api.ethan-galea1000.workers.dev").replace(/\/$/, "");
const allowedOrigin = "http://localhost:3000";
const remoteTest = { skip: !enabled };

async function call(path, init = {}) {
  return fetch(baseUrl + path, {
    redirect: "manual",
    ...init,
    headers: {
      ...(init.headers || {})
    }
  });
}

test("REMOTE: health reports the test D1 binding as available", remoteTest, async () => {
  const response = await call("/api/health");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.database, "ok");
});

test("REMOTE: unauthenticated session lookup is rejected", remoteTest, async () => {
  const response = await call("/api/auth/me");
  assert.equal(response.status, 401);
});

test("REMOTE: mutation from a disallowed Origin is rejected before writes", remoteTest, async () => {
  const response = await call("/api/aliases", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://not-allowed.example"
    },
    body: JSON.stringify({ name: "test-remote-origin-denied", category: "public" })
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "test_origin_not_allowed");
});

test("REMOTE: malformed JSON is rejected without creating a test account", remoteTest, async () => {
  const response = await call("/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: allowedOrigin
    },
    body: "{"
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_json");
});

test("REMOTE: unsupported method on health is rejected", remoteTest, async () => {
  const response = await call("/api/health", { method: "POST" });
  assert.equal(response.status, 405);
});

test("REMOTE: health response includes baseline security headers", remoteTest, async () => {
  const response = await call("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("REMOTE: unknown API path returns not found", remoteTest, async () => {
  const response = await call("/api/remote-regression-path-that-does-not-exist");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});


test("REMOTE: allowed browser origin receives a CORS preflight response", remoteTest, async () => {
  const response = await call("/api/auth/login", {
    method: "OPTIONS",
    headers: {
      origin: allowedOrigin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert.ok([200, 204].includes(response.status), "expected successful preflight");
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
});
