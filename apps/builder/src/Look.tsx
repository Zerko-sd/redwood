import { THEMES } from "@redwood/parts";
import { Select, type EditorProps } from "./ui";

const DENSITY: Record<string, { label: string; radius: string }> = {
  soft: { label: "Soft", radius: "10px" },
  tight: { label: "Tight", radius: "4px" },
  square: { label: "Square", radius: "0px" },
};

/** The app's look: a named theme, plus the two tokens people most often want to change on top of it. */
export function Look({ spec, send, canEdit }: EditorProps) {
  const t = spec.theme;
  const preset = THEMES[t.preset] ?? THEMES.default!;
  const accent = t.tokens.primary ?? preset.tokens.primary ?? "#1d1d1b";
  const set = (tokens: Record<string, string>) => void send([{ type: "setTheme", theme: { tokens: { ...t.tokens, ...tokens } } }]);
  const radius = Object.entries(DENSITY).find(([, d]) => d.radius === t.tokens.radius)?.[0] ?? "soft";

  return (
    <div className="dock-body">
      <h2>The look of the app</h2>
      <p className="hint">Generated apps read these values and nothing else, so a change here never touches a component.</p>
      <div className="theme-list">
        {Object.entries(THEMES).map(([id, theme]) => (
          <button key={id} disabled={!canEdit} className={id === t.preset ? "on" : ""} onClick={() => void send([{ type: "setTheme", theme: { preset: id, tokens: {} } }])}>
            <b>{id}</b><span>{theme.description}</span>
          </button>
        ))}
      </div>
      <label className="look-row">Accent
        <input type="color" aria-label="Accent colour" disabled={!canEdit} value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#1d1d1b"} onChange={(e) => set({ primary: e.target.value })} />
      </label>
      <label className="look-row">Corners
        <Select label="Corners" value={radius} disabled={!canEdit} options={Object.entries(DENSITY).map(([value, d]) => ({ value, label: d.label }))} onChange={(v) => set({ radius: DENSITY[v]!.radius })} />
      </label>
      {Object.keys(t.tokens).length > 0 && canEdit && <button className="ghost" onClick={() => void send([{ type: "setTheme", theme: { tokens: {} } }])}>Back to the theme's own values</button>}
    </div>
  );
}
