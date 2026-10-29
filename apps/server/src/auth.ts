import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { tx } from "./db";

export interface User {
  id: string;
  username: string;
}

const SESSION_HOURS = 24 * 7;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export class AuthError extends Error {}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(password, salt, 64);
  const want = Buffer.from(hash, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Creates the account and a personal organisation it administers. */
export function signup(db: Db, username: string, password: string): User {
  username = username.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new AuthError("username must be 3-32 characters: a-z, 0-9, . _ -");
  if (password.length < 8) throw new AuthError("password must be at least 8 characters");
  return tx(db, () => {
    if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) throw new AuthError("username is taken");
    const id = randomUUID();
    const orgId = randomUUID();
    db.prepare(`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`).run(id, username, hashPassword(password));
    db.prepare(`INSERT INTO orgs (id, name) VALUES (?, ?)`).run(orgId, `${username}'s workspace`);
    db.prepare(`INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, 'admin')`).run(orgId, id);
    return { id, username };
  });
}

export function login(db: Db, username: string, password: string): { token: string; user: User } | null {
  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username.trim().toLowerCase()) as
    | { id: string; username: string; password_hash: string }
    | undefined;
  // Hash-compare even for unknown users so timing doesn't reveal which usernames exist.
  const ok = verifyPassword(password, row?.password_hash ?? "00:00");
  if (!row || !ok) return null;
  const token = randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    token, row.id, `+${SESSION_HOURS} hours`,
  );
  return { token, user: { id: row.id, username: row.username } };
}

export function userForToken(db: Db, token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as User | undefined;
  return row ? { id: row.id, username: row.username } : null;
}

export function logout(db: Db, token: string | undefined): void {
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
