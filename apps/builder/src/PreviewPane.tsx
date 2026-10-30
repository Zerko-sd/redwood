import { useEffect, useRef, useState } from "react";
import type { PreviewStatus, Spec } from "./api";

const LABEL: Record<PreviewStatus["state"], string> = {
  stopped: "Not running",
  starting: "Starting (the first run installs packages, about a minute)",
  running: "Running",
  error: "Stopped working",
};

export function PreviewPane({ spec, status, canRun, onAction, onHold }: {
  spec: Spec;
  status: PreviewStatus | null;
  canRun: boolean;
  onAction: (a: "start" | "stop" | "confirm") => void;
  onHold: (held: boolean) => void;
}) {
  const [logs, setLogs] = useState(false);
  const [page, setPage] = useState("/");
  const state = status?.state ?? "stopped";
  // Keeping the last good address means a failed rebuild shows on top of the app, not instead of it.
  const last = useRef<string | undefined>(undefined);
  if (status?.webUrl) last.current = status.webUrl;
  useEffect(() => { if (state === "stopped") last.current = undefined; }, [state]);
  const url = last.current;

  return (
    <div className="preview">
      <header>
        <span className={`dot ${state}`} />
        <strong>{LABEL[state]}</strong>
        <span className="spacer" />
        {state === "running" && canRun && (
          <label className="check" title="Rebuild the preview on every change">
            <input type="checkbox" checked={!status?.held} onChange={(e) => onHold(!e.target.checked)} /> Live
          </label>
        )}
        {canRun && (state === "running" || state === "starting"
          ? <button onClick={() => onAction("stop")}>Stop</button>
          : <button className="primary" onClick={() => onAction("start")}>Run preview</button>)}
      </header>

      {status?.pendingDestructive?.length ? (
        <div className="devneeded">
          <b>This change would delete data in the preview database</b>
          <ul>{status.pendingDestructive.map((x) => <li key={x}>{x}</li>)}</ul>
          {canRun && <button onClick={() => onAction("confirm")}>Apply and lose that data</button>}
        </div>
      ) : null}

      {url && state !== "stopped" ? (
        <>
          <div className="preview-bar">
            <select aria-label="Page" value={page} onChange={(e) => setPage(e.target.value)}>
              <option value="/">Home</option>
              {spec.screens.map((s) => <option key={s.id} value={s.path}>{s.title}</option>)}
            </select>
            {status && status.accounts.length > 0 && <span className="muted small">Sign in as {status.accounts.join(", ")}, password <code>redwood</code></span>}
            <a className="small" href={url} target="_blank" rel="noreferrer">Open</a>
          </div>
          <div className="frame">
            <iframe key={page} title="Preview of the app" src={`${url}${page}`} />
            {state === "error" && (
              <div className="frame-fail" role="alert">
                <b>The last change didn't build</b>
                <p>{status?.error ?? "See the log."} This is the last version that worked.</p>
              </div>
            )}
          </div>
          {status?.seedNote && <p className="hint small">Sample rows replaced what was typed in the preview.</p>}
        </>
      ) : (
        <div className="placeholder">
          <p><strong>Your app shows up here.</strong></p>
          <p className="muted">Add a story, a table and a page, then run the preview. It rebuilds on every change.</p>
          {status?.error && <p className="error small">{status.error}</p>}
        </div>
      )}

      {status && status.logs.length > 0 && (
        <div className="logs">
          <button className="ghost" onClick={() => setLogs(!logs)}>{logs ? "Hide" : "Show"} log</button>
          {logs && <pre>{status.logs.slice(-60).join("\n")}</pre>}
        </div>
      )}
    </div>
  );
}
