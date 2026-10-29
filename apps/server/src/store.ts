import { randomUUID } from "node:crypto";
import { applyCommand, canonicalJson, checkSpec, specHash, touches, type Spec } from "@redwood/spec";
import { tx, type Db } from "./db";

export interface Head {
  rev: number;
  spec: Spec;
}

export class ConflictError extends Error {
  constructor(public items: string[], public headRev: number) {
    super(`someone else changed these items since you loaded them: ${items.join(", ")}`);
  }
}

export class StoreError extends Error {
  constructor(message: string, public status: 400 | 404 | 422 = 400) {
    super(message);
  }
}

export const blankSpec = (title: string): Spec => checkSpec({ schemaVersion: 1, title }).spec!;

export function createProject(db: Db, p: { orgId: string; name: string; spec: Spec; userId: string }): string {
  return tx(db, () => {
    const id = randomUUID();
    db.prepare(`INSERT INTO projects (id, org_id, name) VALUES (?, ?, ?)`).run(id, p.orgId, p.name);
    db.prepare(`INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')`).run(id, p.userId);
    db.prepare(`INSERT INTO revisions (project_id, rev, spec, commands, author_id) VALUES (?, 1, ?, '[]', ?)`).run(
      id, canonicalJson(p.spec), p.userId,
    );
    return id;
  });
}

export function head(db: Db, projectId: string): Head {
  const row = db
    .prepare(`SELECT rev, spec FROM revisions WHERE project_id = ? ORDER BY rev DESC LIMIT 1`)
    .get(projectId) as { rev: number; spec: string } | undefined;
  if (!row) throw new StoreError("project not found", 404);
  return { rev: row.rev, spec: JSON.parse(row.spec) as Spec };
}

export function revision(db: Db, projectId: string, rev: number): Head {
  const row = db.prepare(`SELECT rev, spec FROM revisions WHERE project_id = ? AND rev = ?`).get(projectId, rev) as
    | { rev: number; spec: string }
    | undefined;
  if (!row) throw new StoreError(`revision ${rev} not found`, 404);
  return { rev: row.rev, spec: JSON.parse(row.spec) as Spec };
}

/**
 * Applies a batch of commands made against `baseRev`.
 * - Nothing newer than baseRev: applied directly.
 * - Newer revisions touched different items: rebased onto the head and applied.
 * - Newer revisions touched the same items: rejected, nothing is lost or merged silently.
 * The whole batch is one revision, or none.
 */
export function applyBatch(
  db: Db,
  projectId: string,
  baseRev: number,
  commands: unknown[],
  authorId: string,
): { rev: number; spec: Spec; rebased: boolean } {
  if (!commands.length) throw new StoreError("no commands");
  return tx(db, () => {
    const cur = head(db, projectId);
    if (baseRev > cur.rev || baseRev < 1) throw new StoreError(`unknown baseRevision ${baseRev}`);

    if (baseRev < cur.rev) {
      const since = db
        .prepare(`SELECT commands FROM revisions WHERE project_id = ? AND rev > ? ORDER BY rev`)
        .all(projectId, baseRev) as { commands: string }[];
      const theirs = new Set(since.flatMap((r) => (JSON.parse(r.commands) as unknown[]).flatMap(touches)));
      const mine = commands.flatMap(touches);
      const clash = mine.filter((m) => theirs.has("*") || theirs.has(m) || m === "*");
      if (clash.length) throw new ConflictError([...new Set(clash)].sort(), cur.rev);
    }

    let spec = cur.spec;
    try {
      for (const c of commands) spec = applyCommand(spec, c);
    } catch (e) {
      throw new StoreError((e as Error).message, 422);
    }
    const rev = cur.rev + 1;
    db.prepare(`INSERT INTO revisions (project_id, rev, spec, commands, author_id) VALUES (?, ?, ?, ?, ?)`).run(
      projectId, rev, canonicalJson(spec), JSON.stringify(commands), authorId,
    );
    return { rev, spec, rebased: baseRev < cur.rev };
  });
}

export interface HistoryEntry {
  rev: number;
  author: string | null;
  label: string | null;
  createdAt: string;
  summary: string;
}

const summarise = (commands: { type?: string }[]): string => {
  if (!commands.length) return "created";
  const types = [...new Set(commands.map((c) => c.type ?? "change"))];
  return `${commands.length} ${commands.length === 1 ? "change" : "changes"}: ${types.join(", ")}`;
};

export function history(db: Db, projectId: string): HistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT r.rev, r.label, r.created_at AS createdAt, r.commands, u.username AS author
       FROM revisions r LEFT JOIN users u ON u.id = r.author_id
       WHERE r.project_id = ? ORDER BY r.rev DESC`,
    )
    .all(projectId) as { rev: number; label: string | null; createdAt: string; commands: string; author: string | null }[];
  return rows.map((r) => ({
    rev: r.rev, author: r.author, label: r.label, createdAt: r.createdAt,
    summary: summarise(JSON.parse(r.commands) as { type?: string }[]),
  }));
}

/** Names a revision so it is easy to find and restore. A label is unique within a project. */
export function nameVersion(db: Db, projectId: string, rev: number, label: string | null): void {
  revision(db, projectId, rev);
  if (label !== null) {
    label = label.trim();
    if (!label || label.length > 80) throw new StoreError("label must be 1-80 characters");
    const taken = db.prepare(`SELECT rev FROM revisions WHERE project_id = ? AND label = ? AND rev != ?`).get(projectId, label, rev);
    if (taken) throw new StoreError(`"${label}" already names another version`);
  }
  db.prepare(`UPDATE revisions SET label = ? WHERE project_id = ? AND rev = ?`).run(label, projectId, rev);
}

/** Restoring never rewrites history: the old spec becomes a new revision on top. */
export function restore(db: Db, projectId: string, rev: number, authorId: string): { rev: number; spec: Spec } {
  return tx(db, () => {
    const old = revision(db, projectId, rev);
    const cur = head(db, projectId);
    const next = cur.rev + 1;
    db.prepare(`INSERT INTO revisions (project_id, rev, spec, commands, author_id) VALUES (?, ?, ?, ?, ?)`).run(
      projectId, next, canonicalJson(old.spec), JSON.stringify([{ type: "restore", from: rev }]), authorId,
    );
    return { rev: next, spec: old.spec };
  });
}

export const specId = (spec: Spec) => specHash(spec).slice(0, 12);
