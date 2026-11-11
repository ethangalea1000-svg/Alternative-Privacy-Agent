import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Node 22's built-in SQLite lets CI smoke-test the SQL migrations without a
// Cloudflare account, a remote D1 database, external dependencies, or real data.
const sqlite = await import("node:sqlite").catch(() => null);
const root = new URL("../", import.meta.url);

test("D1 migrations preserve legacy rows and enforce ownership and auth constraints", {
  skip: !sqlite
}, async () => {
  const { DatabaseSync } = sqlite;
  const db = new DatabaseSync(":memory:");
  try {
    const migrationPaths = [
      "migrations/0001_initial.sql",
      "migrations/0002_auth_and_ownership.sql",
      "migrations/0003_login_rate_limits.sql"
    ];

    // Simulate a pre-auth alias before applying the ownership migration.
    db.exec(await readFile(new URL(migrationPaths[0], root), "utf8"));
    db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("legacy-id", "Legacy alias", "legacy-label", "public", "active",
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

    db.exec(await readFile(new URL(migrationPaths[1], root), "utf8"));
    db.exec(await readFile(new URL(migrationPaths[2], root), "utf8"));

    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(db.prepare("SELECT owner_id FROM aliases WHERE id = ?").get("legacy-id").owner_id, null,
      "legacy rows must remain unowned and invisible to authenticated users");

    const username = "alice";
    const userId = "user-a";
    db.prepare(
      "INSERT INTO users (id, username, password_hash, password_salt, password_iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(userId, username, "a".repeat(64), "b".repeat(32), 310000, "2026-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run("c".repeat(64), userId, Date.now() + 60_000, "2026-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("owned-id", "Owned alias", "owned-label", "achats", "planned",
      "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", userId);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM aliases WHERE owner_id = ?").get(userId).count, 1);
    assert.throws(() => db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bad-category", "Invalid", "invalid-label", "not-a-category", "planned",
      "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z", userId),
    /CHECK constraint failed/);
    assert.throws(() => db.prepare(
      "INSERT INTO aliases (id, name, label, category, status, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bad-owner", "Invalid owner", "invalid-owner-label", "achats", "planned",
      "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "missing-user"),
    /FOREIGN KEY constraint failed/);
    assert.throws(() => db.prepare(
      "INSERT INTO auth_login_limits (key_hash, failed_attempts, window_started_at, blocked_until, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("short-hash", 1, Date.now(), null, "2026-01-03T00:00:00.000Z"),
    /CHECK constraint failed/);

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(userId).count, 0,
      "deleting a user must cascade to sessions");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM aliases WHERE owner_id = ?").get(userId).count, 0,
      "deleting a user must cascade to owned aliases");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM aliases WHERE id = ?").get("legacy-id").count, 1,
      "legacy unowned aliases must not be deleted with a user");
  } finally {
    db.close();
  }
});
