import type { Db } from "./db";

export type ProjectRole = "owner" | "editor" | "reviewer" | "viewer";

/** What each role may do. Reviewers' extra rights (comments, approving AI suggestions) arrive with those features. */
export const CAN = {
  read: ["owner", "editor", "reviewer", "viewer"],
  edit: ["owner", "editor"],
  preview: ["owner", "editor"],
  manage: ["owner"],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type Action = keyof typeof CAN;

/**
 * A user's role on a project: their explicit membership, else owner if they administer the
 * project's organisation, else nothing (the project is invisible to them).
 */
export function roleOn(db: Db, userId: string, projectId: string): ProjectRole | null {
  const member = db
    .prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`)
    .get(projectId, userId) as { role: ProjectRole } | undefined;
  if (member) return member.role;
  const admin = db
    .prepare(
      `SELECT 1 FROM projects p JOIN org_members m ON m.org_id = p.org_id
       WHERE p.id = ? AND m.user_id = ? AND m.role = 'admin'`,
    )
    .get(projectId, userId);
  return admin ? "owner" : null;
}

export const allowed = (role: ProjectRole | null, action: Action): boolean =>
  !!role && (CAN[action] as readonly string[]).includes(role);
