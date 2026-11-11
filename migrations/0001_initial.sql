-- APA D1 schema — initial migration.
-- This file defines a database schema only; it does not create a Cloudflare resource.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 48),
  label TEXT NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 40),
  category TEXT NOT NULL CHECK (category IN ('achats', 'projets', 'public', 'personnel')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aliases_category_created
  ON aliases(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aliases_status_created
  ON aliases(status, created_at DESC);
