import type { Command, Issue, Spec } from "@redwood/spec";
import type { ScreenPlan } from "@redwood/planner";
import type { Suggestion } from "@redwood/suggest/src/types";
import type { StaleItem } from "@redwood/suggest/src/stale";
import type { Recommendation } from "@redwood/suggest/src/recommend";
import type { ChangeOp } from "@redwood/suggest/src/change";

export type { ChangeOp, Command, Issue, Recommendation, Spec, ScreenPlan, StaleItem, Suggestion };

export interface User { id: string; username: string }
export interface ProjectRow { id: string; name: string; role: string; rev: number; updatedAt: string | null }
export interface Project { id: string; name: string; role: "owner" | "editor" | "reviewer" | "viewer"; rev: number; spec: Spec }
export interface PreviewStatus {
  state: "stopped" | "starting" | "running" | "error";
  webUrl?: string;
  apiUrl?: string;
  accounts: string[];
  error?: string;
  pendingDestructive?: string[];
  /** Live is off: edits wait until it is on again. */
  held?: boolean;
  /** The sample rows changed, so the preview database was reloaded. */
  seedNote?: boolean;
  logs: string[];
}
export interface HistoryEntry { rev: number; author: string | null; label: string | null; createdAt: string; summary: string }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly items?: string[]) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; items?: string[] };
  if (!res.ok) throw new ApiError(data.error ?? `request failed (${res.status})`, res.status, data.items);
  return data as T;
}

export const api = {
  me: () => call<User>("GET", "/auth/me"),
  login: (username: string, password: string) => call<User>("POST", "/auth/login", { username, password }),
  signup: (username: string, password: string) => call<User>("POST", "/auth/signup", { username, password }),
  logout: () => call<void>("POST", "/auth/logout"),
  projects: () => call<ProjectRow[]>("GET", "/projects"),
  createProject: (name: string, template: "blank" | "example") => call<{ id: string }>("POST", "/projects", { name, template }),
  deleteProject: (id: string) => call<void>("DELETE", `/projects/${id}`),
  project: (id: string) => call<Project>("GET", `/projects/${id}`),
  commands: (id: string, baseRevision: number, commands: Command[]) =>
    call<{ rev: number; spec: Spec; rebased: boolean }>("POST", `/projects/${id}/commands`, { baseRevision, commands }),
  plan: (id: string) => call<ScreenPlan[]>("GET", `/projects/${id}/plan`),
  check: (id: string) => call<Issue[]>("GET", `/projects/${id}/check`),
  stale: (id: string) => call<StaleItem[]>("GET", `/projects/${id}/stale`),
  recommendations: (id: string) => call<Recommendation[]>("GET", `/projects/${id}/recommendations`),
  describeChange: (id: string, text: string) => call<ChangeOp[]>("POST", `/projects/${id}/change`, { text }),
  history: (id: string) => call<HistoryEntry[]>("GET", `/projects/${id}/history`),
  restore: (id: string, rev: number) => call<{ rev: number; spec: Spec }>("POST", `/projects/${id}/restore`, { rev }),
  preview: (id: string) => call<PreviewStatus>("GET", `/projects/${id}/preview`),
  startPreview: (id: string) => call<PreviewStatus>("POST", `/projects/${id}/preview/start`),
  stopPreview: (id: string) => call<void>("POST", `/projects/${id}/preview/stop`),
  holdPreview: (id: string, held: boolean) => call<PreviewStatus>("POST", `/projects/${id}/preview/hold`, { held }),
  copyProject: (id: string, name: string) => call<{ id: string }>("POST", `/projects/${id}/copy`, { name }),
  exportUrl: (id: string) => `/api/projects/${id}/export`,
  specUrl: (id: string) => `/api/projects/${id}/spec`,
  ai: () => call<{ enabled: boolean; model: string | null }>("GET", "/ai"),
  suggestion: (id: string) => call<{ rev: number; suggestion: Suggestion | null }>("GET", `/projects/${id}/suggestion`),
  skipSuggestion: (id: string, key: string) => call<void>("POST", `/projects/${id}/suggestion/skip`, { key }),
  confirmDestructive: (id: string) => call<PreviewStatus>("POST", `/projects/${id}/preview/confirm-destructive`),
};

/** `Trip Status` -> `trip-status`; used to build the stable IDs the spec refers to. */
export const slug = (text: string): string =>
  text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

/** The first `<kind>:<slug>` not already taken. */
export function freshId(kind: string, text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${kind}:${slug(text) || kind}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}
