import { useEffect, useMemo, useRef, useState } from "react";
import type { Spec } from "./api";
import { type GhostDiff } from "./sheet/bind";
import { allFlags } from "./sheet/rules";
import type { Spot } from "./sheet/Grid";

type State = "ok" | "suggested" | "warn" | "bad";
interface Item { x: number; y: number; state: State }
interface Cluster { id: string; name: string; x: number; y: number; items: Item[]; tab: string; spot?: Spot }
interface Pin { key: string; x: number; y: number; level: "bad" | "warn"; why: string; tab: string; spot: Spot }

const COLOR: Record<State, [number, number, number]> = { ok: [47, 195, 154], suggested: [214, 222, 218], warn: [240, 138, 60], bad: [239, 90, 79] };
const STEP = 7;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Share of the canvas the whole project covers, so a small spec and a large one both read as a landscape. */
const COVER = 0.42;

/** Smooth noise over the lattice. It only roughens the edge of a patch; it never adds or removes one. */
function noise(x: number, y: number): number {
  const a = Math.sin(x * 0.021 + 1.3) * Math.cos(y * 0.027 - 0.7);
  const b = Math.sin(x * 0.053 - y * 0.041 + 2.1);
  const c = Math.sin(x * 0.117 + y * 0.093);
  return 0.5 * a + 0.32 * b + 0.18 * c;
}
/** How far one item's light reaches, chosen so all the items together cover about COVER of the canvas. */
const patchRadius = (items: number, width: number, height: number) =>
  Math.max(26, Math.min(170, Math.sqrt((COVER * width * height) / (Math.PI * Math.max(items, 1)))));

const hashOf = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/**
 * The project as terrain. Every lit patch is one real story, field or page, gathered around the table it belongs
 * to, so the shape of the map is the shape of the spec. Nothing here is decoration: an empty project is a dark grid.
 */
function layout(spec: Spec, ghosts: GhostDiff | null, width: number, height: number): { clusters: Cluster[]; pins: Pin[] } {
  const flags = allFlags(spec);
  const groups = [...spec.entities.map((e) => ({ id: e.id, name: e.name })), { id: "", name: "No table yet" }];
  const members = (id: string) => {
    const screens = spec.screens.filter((s) => (s.entity ?? "") === id);
    const stories = id
      ? spec.stories.filter((s) => screens.some((sc) => sc.stories.includes(s.id)))
      : spec.stories.filter((s) => !spec.screens.some((sc) => sc.stories.includes(s.id)));
    const fields = spec.entities.find((e) => e.id === id)?.fields ?? [];
    return { screens, stories, fields };
  };
  const live = groups.filter((g) => { const m = members(g.id); return g.id ? true : m.stories.length + m.screens.length > 0; });
  const total = live.reduce((n, g) => { const m = members(g.id); return n + m.stories.length + m.fields.length + m.screens.length; }, 0);
  const patch = patchRadius(total, width, height);
  const cols = Math.max(1, Math.ceil(Math.sqrt(live.length * (width / Math.max(1, height)))));
  const rows = Math.max(1, Math.ceil(live.length / cols));

  const clusters: Cluster[] = [];
  const pins: Pin[] = [];
  live.forEach((g, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? live.length - cols * row : cols;
    const jitter = hashOf(g.name);
    const x = ((i % cols) + 0.5) / inRow * width + ((jitter % 40) - 20);
    const y = (row + 0.5) / rows * height + (((jitter >> 5) % 30) - 15);
    const m = members(g.id);
    const stateOf = (tab: string, rowId: string, col: string): State => {
      const hit = flags.find((f) => f.tab === tab && f.rowId === rowId && (col === "" || f.col === col));
      return hit ? hit.flag.level : "ok";
    };
    const pending = [...(ghosts?.rows.get("data") ?? []), ...(ghosts?.rows.get("screens") ?? [])]
      .filter((r) => (r.cells.entity ?? "") === g.name).length;
    const states: State[] = [
      ...m.stories.map((s) => stateOf("stories", s.id, "")),
      ...m.fields.map((f) => stateOf("data", `${g.id}|${f.id}`, "")),
      ...m.screens.map((s) => stateOf("screens", s.id, "")),
      ...Array<State>(pending).fill("suggested"),
    ];
    const count = Math.max(states.length, 1);
    const spread = patch * 0.62;
    const items = states.map((state, n) => {
      const r = spread * Math.sqrt(n + 0.5);
      const a = n * GOLDEN + (jitter % 7);
      return { x: x + r * Math.cos(a), y: y + r * Math.sin(a) * 0.82, state };
    });
    clusters.push({
      id: g.id, name: g.name, x, y: Math.min(height - 96, y + spread * Math.sqrt(count) * 0.82 + patch * 0.72), items,
      tab: g.id ? "data" : "stories",
      ...(g.id && m.fields[0] ? { spot: { rowId: `${g.id}|${m.fields[0].id}`, col: "name" } } : {}),
    });
    const hits = flags.filter((f) => {
      if (f.tab === "stories") return m.stories.some((s) => s.id === f.rowId);
      if (f.tab === "screens") return m.screens.some((s) => s.id === f.rowId);
      if (f.tab === "data") return f.rowId.startsWith(`${g.id}|`) && !!g.id;
      if (f.tab.startsWith("rows:")) return f.tab === `rows:${g.id}`;
      return false;
    });
    // A map full of pins says nothing, so each table shows only what is worst, and Health lists the rest.
    for (const f of [...hits].sort((a, b) => (a.flag.level === "bad" ? -1 : 1) - (b.flag.level === "bad" ? -1 : 1)).slice(0, 2)) {
      const n = pins.length + 1;
      pins.push({
        key: `${f.tab}\0${f.rowId}\0${f.col}`, level: f.flag.level, why: f.flag.why, tab: f.tab, spot: { rowId: f.rowId, col: f.col },
        x: x + spread * 1.5 * Math.cos(n * 2.4), y: y + spread * 1.2 * Math.sin(n * 2.4),
      });
    }
  });
  return { clusters, pins };
}

function draw(canvas: HTMLCanvasElement, clusters: Cluster[], width: number, height: number) {
  const dpr = devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  const cols = Math.ceil(width / STEP);
  const lines = Math.ceil(height / STEP);
  const heat = new Float32Array(cols * lines * 4);
  const order: State[] = ["ok", "suggested", "warn", "bad"];
  const items = clusters.flatMap((c) => c.items);
  const patch = patchRadius(items.length, width, height);
  const reach = Math.ceil((patch * 1.3) / STEP);
  for (const it of items) {
    const cx = Math.round(it.x / STEP);
    const cy = Math.round(it.y / STEP);
    const layer = order.indexOf(it.state);
    for (let y = cy - reach; y <= cy + reach; y++) {
      if (y < 0 || y >= lines) continue;
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (x < 0 || x >= cols) continue;
        const d = Math.hypot(x * STEP - it.x, y * STEP - it.y) / (patch * (1 + noise(x * STEP, y * STEP) * 0.34));
        if (d >= 1) continue;
        heat[(y * cols + x) * 4 + layer]! += (1 - d) * (1 - d) * 1.7;
      }
    }
  }
  for (let y = 0; y < lines; y++) {
    for (let x = 0; x < cols; x++) {
      const at = (y * cols + x) * 4;
      let total = 0;
      let top = 0;
      for (let k = 0; k < 4; k++) {
        total += heat[at + k]!;
        if (heat[at + k]! > heat[at + top]!) top = k;
      }
      if (total < 0.04) {
        g.fillStyle = "rgba(255,255,255,.06)";
        g.fillRect(x * STEP, y * STEP, 1, 1);
        continue;
      }
      const [r, gr, b] = COLOR[order[top]!];
      const level = Math.min(1, total);
      // Height shows as size and brightness, and a grain of the lattice stays dark, so it reads as a surface.
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      const size = 0.9 + level * 3.6 + Math.abs(grain) * 0.8;
      g.fillStyle = `rgba(${r},${gr},${b},${0.22 + level * 0.78})`;
      g.fillRect(x * STEP - size / 2, y * STEP - size / 2, size, size);
    }
  }
}

function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const share = total ? value / total : 0;
  const r = 24;
  const length = 2 * Math.PI * r;
  return (
    <figure className="ring">
      <svg viewBox="0 0 60 60" width="60" height="60" role="img" aria-label={`${label}: ${value} of ${total}`}>
        <circle cx="30" cy="30" r={r} className="ring-track" />
        <circle cx="30" cy="30" r={r} className="ring-value" strokeDasharray={`${length * share} ${length}`} transform="rotate(-90 30 30)" />
      </svg>
      <figcaption>{label}</figcaption>
      <strong>{value}<small> / {total}</small></strong>
    </figure>
  );
}

function RoleBars({ spec }: { spec: Spec }) {
  const counts = spec.roles.map((r) => ({ name: r.name, n: spec.stories.filter((s) => s.role === r.id).length }));
  const top = Math.max(1, ...counts.map((c) => c.n));
  if (!counts.length) return null;
  return (
    <figure className="role-bars">
      <figcaption>Stories by role</figcaption>
      {counts.map((c) => (
        <div key={c.name} className="role-bar" title={`${c.name}: ${c.n}`}>
          <span>{c.name}</span>
          <i style={{ width: `${(c.n / top) * 100}%` }} />
          <b>{c.n}</b>
        </div>
      ))}
    </figure>
  );
}

export function SpecMap({ spec, ghosts, onJump }: { spec: Spec; ghosts: GhostDiff | null; onJump: (tab: string, spot?: Spot) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { clusters, pins } = useMemo(() => layout(spec, ghosts, size.width, size.height), [spec, ghosts, size]);
  useEffect(() => {
    if (canvas.current && size.width) draw(canvas.current, clusters, size.width, size.height);
  }, [clusters, size]);

  const placed = spec.stories.filter((s) => spec.screens.some((sc) => sc.stories.includes(s.id))).length;
  const working = spec.screens.filter((s) => s.endpoints.length && (s.entity ? spec.access.some((a) => a.entity === s.entity) : false)).length;

  return (
    <div className="map" ref={wrap}>
      <canvas ref={canvas} aria-hidden />
      {clusters.map((c) => (
        <button key={c.id || "none"} className="map-label" style={{ left: c.x, top: c.y }} onClick={() => onJump(c.tab, c.spot)}>{c.name}</button>
      ))}
      {pins.map((p) => (
        <button key={p.key} className={`map-pin ${p.level}`} style={{ left: p.x, top: p.y }} title={p.why} aria-label={p.why} onClick={() => onJump(p.tab, p.spot)}>!</button>
      ))}
      <div className="map-side">
        <Ring value={placed} total={spec.stories.length} label="Stories on a page" />
        <Ring value={working} total={spec.screens.length} label="Pages working" />
      </div>
      <div className="map-foot">
        <RoleBars spec={spec} />
        <ul className="map-legend" aria-label="Key">
          <li><i className="ok" />Accepted</li>
          <li><i className="suggested" />Suggested</li>
          <li><i className="warn" />To look at</li>
          <li><i className="bad" />Problem</li>
          <li className="muted">One patch is one story, field or page.</li>
        </ul>
      </div>
      {!spec.stories.length && !spec.entities.length && (
        <div className="map-empty">
          <h2>Nothing on the map yet</h2>
          <p>Each story, field and page you add lights up here.</p>
          <button className="primary" onClick={() => onJump("roles")}>Start with who uses it</button>
        </div>
      )}
    </div>
  );
}
