import { useState } from "react";
import { Access } from "./Access";
import { Data } from "./Data";
import { History } from "./History";
import { PreviewPane } from "./PreviewPane";
import { Screens } from "./Screens";
import { Stories } from "./Stories";
import { Suggestions } from "./Suggestions";
import { useProject } from "./useProject";

const TABS = ["Stories", "Data", "Pages", "Access", "History"] as const;
type Tab = (typeof TABS)[number];

export function Editor({ id, me, onBack }: { id: string; me: string; onBack: () => void }) {
  const p = useProject(id, me);
  const [tab, setTab] = useState<Tab>("Stories");
  const [showIssues, setShowIssues] = useState(false);

  if (!p.project) {
    return (
      <div className="loading">
        {p.notice?.kind === "error" ? <><p className="error">{p.notice.text}</p><button onClick={onBack}>Back to projects</button></> : "Loading…"}
      </div>
    );
  }
  const { spec, role, name, rev } = p.project;
  const tell = (text: string) => p.setNotice({ kind: "error", text });
  const editor = { spec, send: p.send, tell, canEdit: p.canEdit };

  const errors = p.issues.filter((i) => i.severity === "error");
  const warnings = p.issues.filter((i) => i.severity === "warning");

  // The tab counts are the quickest "is this project filled in" signal.
  const count: Record<Tab, number | undefined> = {
    Stories: spec.stories.length, Data: spec.entities.length, Pages: spec.screens.length,
    Access: spec.access.length, History: undefined,
  };

  return (
    <div className="editor">
      <header className="topbar">
        <button className="ghost" onClick={onBack}>← Projects</button>
        <h1>{name}</h1>
        <span className="muted">rev {rev} · {role}{p.busy ? " · saving…" : ""}</span>
        <span className="spacer" />
        {p.presence.filter((u) => u !== me).length > 0 && <span className="muted">also here: {p.presence.filter((u) => u !== me).join(", ")}</span>}
        <button className={`issues${errors.length ? " bad" : ""}`} onClick={() => setShowIssues(!showIssues)}>
          {errors.length ? `${errors.length} problem${errors.length > 1 ? "s" : ""}` : "No problems"}{warnings.length ? ` · ${warnings.length} to look at` : ""}
        </button>
      </header>

      {showIssues && p.issues.length > 0 && (
        <ul className="issue-list">
          {p.issues.map((i, n) => <li key={n} className={i.severity}><code>{i.path}</code> {i.message}</li>)}
        </ul>
      )}
      {p.notice && (
        <div className={`notice ${p.notice.kind}`} role="status">
          <span>{p.notice.text}</span>
          {p.notice.items?.length ? <span className="muted"> ({p.notice.items.join(", ")})</span> : null}
          <button className="ghost" onClick={() => p.setNotice(null)}>Dismiss</button>
        </div>
      )}
      {!p.canEdit && <div className="notice info">You can look but not change this project ({role}).</div>}

      <div className="split">
        <main>
          <Suggestions id={id} me={me} spec={spec} send={p.send} canEdit={p.canEdit} />
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>
                {t}{count[t] !== undefined && <small>{count[t]}</small>}
              </button>
            ))}
          </nav>
          {tab === "Stories" && <Stories {...editor} />}
          {tab === "Data" && <Data {...editor} />}
          {tab === "Pages" && <Screens {...editor} plan={p.plan} />}
          {tab === "Access" && <Access {...editor} />}
          {tab === "History" && <History entries={p.history} current={rev} canEdit={p.canEdit} onRestore={p.restore} />}
        </main>
        <PreviewPane status={p.preview} canRun={p.canEdit} onAction={p.previewAction} />
      </div>
    </div>
  );
}
