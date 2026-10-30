import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Access } from "./Access";
import { api } from "./api";
import { History } from "./History";
import { Look } from "./Look";
import { SpecMap } from "./Map";
import { Palette } from "./Palette";
import { PreviewPane } from "./PreviewPane";
import { Pipeline, stepsOf } from "./Rail";
import { Recommendations } from "./Recommendations";
import { Health, Review } from "./Review";
import { allFlags } from "./sheet/rules";
import { previewOf, Sheet } from "./sheet/Sheet";
import type { Spot } from "./sheet/Grid";
import { Suggestions } from "./Suggestions";
import { useProject } from "./useProject";
import { useSuggestions } from "./useSuggestions";

const DOCK = ["Preview", "Rules", "Health", "Review", "Missing", "Look", "History"] as const;
type DockTab = (typeof DOCK)[number];
type View = "Map" | "Sheet";

const stored = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* a remembered layout is a convenience */ } };

export function Editor({ id, me, onBack }: { id: string; me: string; onBack: () => void }) {
  const p = useProject(id, me);
  const s = useSuggestions(id, me, p.send);
  const [view, setView] = useState<View>("Sheet");
  const [tab, setTab] = useState("stories");
  const [dock, setDock] = useState<DockTab>("Preview");
  const [dockOpen, setDockOpen] = useState(() => stored("redwood.dock", "1") === "1");
  const [dockWidth, setDockWidth] = useState(() => Number(stored("redwood.dockWidth", "520")) || 520);
  const [palette, setPalette] = useState(false);
  const [goTo, setGoTo] = useState<(Spot & { n: number }) | null>(null);
  const [filter, setFilter] = useState({ role: "", entity: "" });
  const counter = useRef(0);

  useEffect(() => store("redwood.dock", dockOpen ? "1" : "0"), [dockOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(true); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const jump = useCallback((to: string, spot?: Spot) => {
    setView("Sheet");
    setTab(to);
    setFilter({ role: "", entity: "" });
    if (spot) setGoTo({ ...spot, n: ++counter.current });
  }, []);

  const openDock = useCallback((d: DockTab) => { setDock(d); setDockOpen(true); }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const from = e.clientX;
    const width = dockWidth;
    let latest = width;
    const move = (m: PointerEvent) => { latest = Math.min(innerWidth * 0.7, Math.max(320, width + from - m.clientX)); setDockWidth(latest); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); store("redwood.dockWidth", String(latest)); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  const project = p.project;
  const ghosts = useMemo(() => (project ? previewOf(project.spec, s.current) : null), [project, s.current]);
  const name = project?.name ?? "";
  const commands = useMemo(() => [
    ...DOCK.map((d) => ({ name: `Open ${d}`, run: () => openDock(d) })),
    { name: "Show the map", run: () => setView("Map") },
    { name: "Show the sheet", run: () => setView("Sheet") },
    { name: "Run preview", run: () => { openDock("Preview"); void p.previewAction("start"); } },
    { name: "Download the app as a zip", run: () => { location.href = api.exportUrl(id); } },
    { name: "Download the spec file", run: () => { location.href = api.specUrl(id); } },
    { name: "Copy this project", run: () => { void api.copyProject(id, `${name} copy`).then((c) => { location.search = `?project=${encodeURIComponent(c.id)}`; }); } },
  ], [openDock, p.previewAction, id, project?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) {
    return (
      <div className="loading">
        {p.notice?.kind === "error" ? <><p className="error">{p.notice.text}</p><button onClick={onBack}>Back to projects</button></> : "Loading…"}
      </div>
    );
  }
  const { spec, role, rev } = project;
  const tell = (text: string) => p.setNotice({ kind: "error", text });
  const editor = { spec, send: p.send, tell, canEdit: p.canEdit };
  const flags = allFlags(spec);
  const errors = p.issues.filter((i) => i.severity === "error").length + flags.filter((f) => f.flag.level === "bad").length;
  const warnings = p.issues.filter((i) => i.severity === "warning").length + flags.filter((f) => f.flag.level === "warn").length;
  const steps = stepsOf(spec, p.stale);
  const others = p.presence.filter((u) => u !== me);

  return (
    <div className="app" style={{ "--dock": dockOpen ? `${dockWidth}px` : "0px" } as React.CSSProperties}>
      <header className="chrome">
        <button className="brand" onClick={onBack} title="Back to projects"><i aria-hidden>R</i>redwood</button>
        <div className="filters">
          <label className="pill-select"><span>Role</span>
            <select aria-label="Filter by role" value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })}>
              <option value="">All</option>
              {spec.roles.map((r) => <option key={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="pill-select"><span>Table</span>
            <select aria-label="Filter by table" value={filter.entity} onChange={(e) => setFilter({ ...filter, entity: e.target.value })}>
              <option value="">All</option>
              {spec.entities.map((x) => <option key={x.id}>{x.name}</option>)}
            </select>
          </label>
        </div>
        <span className="spacer" />
        {others.length > 0 && <span className="muted small">Also here: {others.join(", ")}</span>}
        <button className={`status-pill${errors ? " bad" : ""}`} onClick={() => openDock("Health")}>
          {errors ? `${errors} ${errors > 1 ? "problems" : "problem"}` : "No problems"}{warnings ? ` · ${warnings} to look at` : ""}
        </button>
        <button className="search" onClick={() => setPalette(true)}><span>Search rows and sheets</span><kbd>Ctrl K</kbd></button>
        <button className="round" title={dockOpen ? "Hide the side panel" : "Show the side panel"} aria-label="Toggle the side panel" aria-pressed={dockOpen} onClick={() => setDockOpen(!dockOpen)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /></svg>
        </button>
      </header>

      {p.notice && (
        <div className={`notice ${p.notice.kind}`} role="status">
          <span>{p.notice.text}</span>
          {p.notice.items?.length ? <span className="muted"> ({p.notice.items.join(", ")})</span> : null}
          <button className="ghost" onClick={() => p.setNotice(null)}>Dismiss</button>
        </div>
      )}
      {!p.canEdit && <div className="notice info">You can look but not change this project ({role}).</div>}

      <div className="workspace">
        <aside className="rail">
          <button className="back" onClick={onBack} aria-label="Back to projects" title="Back to projects">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          </button>
          <h1>{name}</h1>
          <p className="muted small">Revision {rev} · {role}{p.busy ? " · saving…" : ""}</p>
          <Pipeline steps={steps} tab={view === "Sheet" ? tab : ""} onTab={(t) => jump(t)} />
          <Suggestions s={s} spec={spec} canEdit={p.canEdit} />
        </aside>

        <main className="canvas">
          <div className="view-switch" role="tablist" aria-label="View">
            {(["Map", "Sheet"] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v}</button>
            ))}
          </div>
          {view === "Map"
            ? <SpecMap spec={spec} ghosts={ghosts} onJump={jump} />
            : (
              <Sheet
                spec={spec}
                latest={p.latest}
                send={p.send}
                tell={tell}
                canEdit={p.canEdit}
                tab={tab}
                onTab={setTab}
                goTo={goTo}
                filter={filter}
                suggestion={s.phase === "showing" ? s.current : null}
                onAcceptSuggestion={() => { if (s.current) void s.accept(s.current); }}
                onSkipSuggestion={() => { if (s.current) void s.skip(s.current); }}
                onDecideMyself={s.dismiss}
              />
            )}
        </main>

        {dockOpen && (
          <aside className="dock" aria-label="Side panel">
            <span className="dock-grip" onPointerDown={startResize} aria-hidden />
            <nav className="dock-tabs">
              {DOCK.map((d) => <button key={d} className={d === dock ? "on" : ""} onClick={() => setDock(d)}>{d}</button>)}
            </nav>
            {dock === "Preview" && <PreviewPane spec={spec} status={p.preview} canRun={p.canEdit} onAction={p.previewAction} onHold={p.hold} />}
            {dock === "Rules" && <Access {...editor} />}
            {dock === "Health" && <Health spec={spec} issues={p.issues} onJump={jump} />}
            {dock === "Review" && <Review id={id} aiEnabled={!!s.ai?.enabled} spec={spec} plan={p.plan} stale={p.stale} send={p.send} tell={tell} canEdit={p.canEdit} />}
            {dock === "Missing" && <Recommendations id={id} rev={rev} send={p.send} canEdit={p.canEdit} />}
            {dock === "Look" && <Look {...editor} />}
            {dock === "History" && <History entries={p.history} current={rev} canEdit={p.canEdit} onRestore={p.restore} />}
          </aside>
        )}
      </div>

      {palette && <Palette spec={spec} commands={commands} onJump={jump} onClose={() => setPalette(false)} />}
    </div>
  );
}
