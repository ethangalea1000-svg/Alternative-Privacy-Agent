-- Add self-hosted users and hashed sessions, then isolate aliases by owner.
-- This is a migration file only; it does not create or modify a remote Cloudflare resource.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(username) BETWEEN 3 AND 32),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 64),
  password_salt TEXT NOT NULL CHECK (length(password_salt) = 32),
  password_iterations INTEGER NOT NULL CHECK (password_iterations BETWEEN 100000 AND 1000000),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiration ON sessions(expires_at);

-- Existing rows receive NULL and are deliberately invisible to authenticated users.
-- New alias creation always supplies owner_id, and all API reads/writes scope by it.
ALTER TABLE aliases ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_aliases_owner_created
  ON aliases(owner_id, created_at DESC);
