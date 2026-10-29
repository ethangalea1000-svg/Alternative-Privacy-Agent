CREATE TABLE IF NOT EXISTS auth_login_limits (
  key_hash TEXT PRIMARY KEY NOT NULL CHECK (length(key_hash) = 64),
  failed_attempts INTEGER NOT NULL CHECK (failed_attempts >= 1),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_login_limits_blocked_until
  ON auth_login_limits(blocked_until);
