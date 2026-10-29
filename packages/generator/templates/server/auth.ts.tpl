import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

export interface User {
  id: string;
  username: string;
  role: string;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const given = scryptSync(password, salt, 64);
  const want = Buffer.from(hash, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createUser(username: string, password: string, role: string): User {
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`).run(
    id, username, hashPassword(password), role,
  );
  return { id, username, role };
}

const SESSION_HOURS = 12;

export function login(username: string, password: string): { token: string; user: User } | null {
  const row = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as
    | { id: string; username: string; role: string; password_hash: string }
    | undefined;
  // Always hash-compare so a missing user costs the same as a wrong password.
  const ok = verifyPassword(password, row?.password_hash ?? "00:00");
  if (!row || !ok) return null;
  const token = randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(
    token, row.id, `+${SESSION_HOURS} hours`,
  );
  return { token, user: { id: row.id, username: row.username, role: row.role } };
}

export function userForToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as User | undefined;
  return row ? { id: row.id, username: row.username, role: row.role } : null;
}

export function logout(token: string | undefined): void {
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
