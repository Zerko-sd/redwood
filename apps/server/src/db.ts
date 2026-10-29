import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Loaded through require so test runners that don't know "node:sqlite" leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  PRIMARY KEY (project_id, user_id)
);
-- Every revision keeps the whole spec (specs are small), so history, diff and restore need no replay.
CREATE TABLE IF NOT EXISTS revisions (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,
  spec TEXT NOT NULL,
  commands TEXT NOT NULL,
  author_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, rev)
);
-- Suggestions a person skipped, or that needed no change, so they are not asked again.
CREATE TABLE IF NOT EXISTS decided_suggestions (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);
`;

export function openDb(path = process.env.REDWOOD_DB ?? "data/redwood.db"): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

/** Runs fn in one transaction; rolls back if it throws. IMMEDIATE takes the write lock up front. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
