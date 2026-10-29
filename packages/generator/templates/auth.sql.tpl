CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE "sessions" (
  "token" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "expires_at" TEXT NOT NULL
);
