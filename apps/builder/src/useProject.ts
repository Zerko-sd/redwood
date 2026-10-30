import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type Command, type HistoryEntry, type Issue, type PreviewStatus, type Project, type ScreenPlan, type Spec, type StaleItem } from "./api";

export interface Notice { kind: "error" | "info"; text: string; items?: string[] }

/**
 * One project, kept in step with the server. Every edit is a batch of commands sent with the revision it
 * was based on; the server rebases it or refuses it with the clashing items, and we show that as-is.
 * Edits made by someone else arrive over the socket and replace what we hold.
 */
export function useProject(id: string, me: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<ScreenPlan[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stale, setStale] = useState<StaleItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const [presence, setPresence] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const rev = useRef(0);
  const newest = useRef<Spec | null>(null);
  /** The spec as of the last accepted edit, ahead of React's next render. */
  const latest = useCallback(() => newest.current!, []);

  const fail = useCallback((e: unknown) => {
    setNotice({ kind: "error", text: e instanceof Error ? e.message : String(e), items: e instanceof ApiError ? e.items : undefined });
  }, []);

  const loadDerived = useCallback(async () => {
    const [p, c, h, st] = await Promise.all([api.plan(id), api.check(id), api.history(id), api.stale(id)]);
    setPlan(p);
    setIssues(c);
    setHistory(h);
    setStale(st);
  }, [id]);

  const reload = useCallback(async () => {
    const p = await api.project(id);
    rev.current = p.rev;
    newest.current = p.spec;
    setProject(p);
    await loadDerived();
  }, [id, loadDerived]);

  useEffect(() => {
    setProject(null);
    reload().catch(fail);
    api.preview(id).then(setPreview).catch(() => {});
  }, [id, reload, fail]);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?project=${encodeURIComponent(id)}`);
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as { type: string; rev?: number; author?: string; presence?: string[] };
      if (e.type === "presence" || e.type === "hello") setPresence(e.presence ?? []);
      if (e.type === "revision" && e.author !== me && (e.rev ?? 0) > rev.current) {
        reload().catch(fail);
        setNotice({ kind: "info", text: `${e.author} changed the spec` });
      }
      if (e.type === "preview") api.preview(id).then(setPreview).catch(() => {});
    };
    return () => ws.close();
  }, [id, me, reload, fail]);

  /** Sends one batch. Resolves true when the server accepted it. */
  const send = useCallback(
    async (commands: Command[]): Promise<boolean> => {
      if (!commands.length) return true;
      setBusy(true);
      try {
        const r = await api.commands(id, rev.current, commands);
        rev.current = r.rev;
        newest.current = r.spec;
        setProject((p) => (p ? { ...p, rev: r.rev, spec: r.spec } : p));
        setNotice(null);
        await loadDerived();
        return true;
      } catch (e) {
        fail(e);
        // A clash means what we hold is stale; show the server's version again.
        if (e instanceof ApiError && e.status === 409) await reload().catch(() => {});
        return false;
      } finally {
        setBusy(false);
      }
    },
    [id, loadDerived, reload, fail],
  );

  const restore = useCallback(
    async (to: number) => {
      try {
        await api.restore(id, to);
        await reload();
        setNotice({ kind: "info", text: `Restored revision ${to} as a new revision` });
      } catch (e) {
        fail(e);
      }
    },
    [id, reload, fail],
  );

  const previewAction = useCallback(
    async (what: "start" | "stop" | "confirm") => {
      try {
        if (what === "start") setPreview(await api.startPreview(id));
        else if (what === "stop") { await api.stopPreview(id); setPreview(await api.preview(id)); }
        else setPreview(await api.confirmDestructive(id));
      } catch (e) {
        fail(e);
      }
    },
    [id, fail],
  );

  // While the preview is coming up the socket only says "state changed"; poll so the URL shows as soon as it exists.
  useEffect(() => {
    if (preview?.state !== "starting") return;
    const t = setInterval(() => api.preview(id).then(setPreview).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [id, preview?.state]);

  const hold = useCallback(
    async (held: boolean) => {
      try {
        setPreview(await api.holdPreview(id, held));
      } catch (e) {
        fail(e);
      }
    },
    [id, fail],
  );

  const canEdit = project?.role === "owner" || project?.role === "editor";
  return { project, plan, issues, stale, history, preview, presence, notice, setNotice, busy, canEdit, send, latest, restore, previewAction, hold, reload };
}
