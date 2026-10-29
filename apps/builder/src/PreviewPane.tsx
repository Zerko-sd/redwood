import { useState } from "react";
import type { PreviewStatus } from "./api";

const LABEL: Record<PreviewStatus["state"], string> = {
  stopped: "Not running",
  starting: "Starting (the first run installs packages, about a minute)",
  running: "Running",
  error: "Could not start",
};

export function PreviewPane({ status, canRun, onAction }: { status: PreviewStatus | null; canRun: boolean; onAction: (a: "start" | "stop" | "confirm") => void }) {
  const [logs, setLogs] = useState(false);
  const state = status?.state ?? "stopped";
  return (
    <aside className="preview">
      <header>
        <span className={`dot ${state}`} />
        <strong>{LABEL[state]}</strong>
        <span className="spacer" />
        {canRun && (state === "running" || state === "starting"
          ? <button onClick={() => onAction("stop")}>Stop</button>
          : <button className="primary" onClick={() => onAction("start")}>Run preview</button>)}
      </header>

      {status?.error && <p className="error">{status.error}</p>}

      {status?.pendingDestructive?.length ? (
        <div className="devneeded">
          <b>This change would delete data in the preview database</b>
          <ul>{status.pendingDestructive.map((x) => <li key={x}>{x}</li>)}</ul>
          {canRun && <button onClick={() => onAction("confirm")}>Apply and lose that data</button>}
        </div>
      ) : null}

      {state === "running" && status?.webUrl ? (
        <>
          <p className="muted small">
            <a href={status.webUrl} target="_blank" rel="noreferrer">{status.webUrl}</a>
            {status.accounts.length > 0 && <> · sign in as {status.accounts.join(", ")} (password <code>redwood</code>)</>}
          </p>
          <iframe title="Preview of the app" src={status.webUrl} />
        </>
      ) : (
        <div className="placeholder">
          <p><strong>Your app shows up here.</strong></p>
          <p className="muted">Add a story, a table and a page, then run the preview. It rebuilds on every change.</p>
        </div>
      )}

      {status && status.logs.length > 0 && (
        <div className="logs">
          <button className="ghost" onClick={() => setLogs(!logs)}>{logs ? "Hide" : "Show"} log</button>
          {logs && <pre>{status.logs.slice(-60).join("\n")}</pre>}
        </div>
      )}
    </aside>
  );
}
