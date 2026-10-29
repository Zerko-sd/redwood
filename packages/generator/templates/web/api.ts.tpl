import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Row } from "./ui/contract";

export interface Me {
  id: string;
  username: string;
  role: string;
}

class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError((body as { error?: string }).error ?? `request failed (${res.status})`, res.status);
  return body as T;
}

const MeContext = createContext<Me | null>(null);
export const MeProvider = ({ me, children }: { me: Me; children: ReactNode }) =>
  createElement(MeContext.Provider, { value: me }, children);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside MeProvider");
  return me;
}

export const session = {
  me: () => call<Me>("/api/me"),
  login: (username: string, password: string) =>
    call<Me>("/api/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => call<void>("/api/logout", { method: "POST" }),
};

/** How a record is named in tables and pickers: its entity's display column, else its id. */
export function recordLabel(row: Row, display: string): string {
  const v = row[display];
  return v === null || v === undefined || v === "" ? String(row.id) : String(v);
}

/**
 * Records of one table. Writes resolve to null on success or the server's message on failure,
 * so the caller decides where the message belongs (a form, a toast).
 */
export function useRecords(table: string, enabled = true) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setRows(await call<Row[]>(`/api/${table}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [table, enabled]);
  useEffect(() => { void reload(); }, [reload]);

  const write = async (fn: () => Promise<unknown>): Promise<string | null> => {
    try {
      await fn();
      await reload();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  return {
    rows,
    loading,
    error,
    create: (values: Row) => write(() => call(`/api/${table}`, { method: "POST", body: JSON.stringify(values) })),
    update: (id: unknown, values: Row) => write(() => call(`/api/${table}/${id}`, { method: "PATCH", body: JSON.stringify(values) })),
    remove: (id: unknown) => write(() => call(`/api/${table}/${id}`, { method: "DELETE" })),
  };
}

export type ActionResult = { ok: true } | { ok: false; notBuilt: boolean; message: string };

/** Runs a custom action. A 501 means the spec names it but no developer has built it yet. */
export async function runAction(table: string, id: unknown, action: string): Promise<ActionResult> {
  try {
    await call(`/api/${table}/${id}/${action}`, { method: "POST", body: "{}" });
    return { ok: true };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    return { ok: false, notBuilt: status === 501, message: (e as Error).message };
  }
}
