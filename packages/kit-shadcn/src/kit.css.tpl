/* Everything here reads the theme variables, so restyling means editing tokens (or custom/overrides.css). */
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--sidebar);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
h1, h2, h3, p, dl, dd { margin: 0; }
button, input, select, textarea { font: inherit; color: inherit; }
code { font-size: 0.9em; }

/* ---- shell: a tinted rail, and the page as one sheet laid on it */
.rw-shell { container: shell / inline-size; height: 100%; }
.rw-frame { display: grid; grid-template-columns: 15.5rem minmax(0, 1fr); height: 100%; }
.rw-side { display: flex; flex-direction: column; gap: 1rem; padding: 1.1rem 0.75rem 0.9rem; overflow-y: auto; }
.rw-brand { display: flex; align-items: center; gap: 0.6rem; padding: 0 0.45rem; font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; line-height: 1.2; }
.rw-mark { flex: none; display: grid; place-content: center; width: 1.8rem; height: 1.8rem; border-radius: calc(var(--radius) * 0.7); background: var(--foreground); color: var(--background); font-family: var(--font-sans); font-size: 0.85rem; }
.rw-nav { display: flex; flex-direction: column; gap: 0.1rem; }
.rw-nav + .rw-nav { padding-top: 0.8rem; border-top: 1px solid color-mix(in srgb, var(--foreground) 12%, transparent); }
.rw-nav-group { padding: 0 0.6rem 0.3rem; font-size: 0.85rem; font-weight: 500; color: var(--foreground-muted); }
.rw-nav a { display: flex; align-items: center; gap: 0.6rem; min-height: 2.15rem; padding: 0.25rem 0.6rem; font-weight: 500; font-size: 0.95rem; border-radius: var(--radius); color: color-mix(in srgb, var(--foreground) 72%, transparent); text-decoration: none; }
.rw-nav-icon { flex: none; opacity: 0.8; }
.rw-nav a:hover { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 6%, transparent); }
.rw-nav a.active { color: var(--foreground); background: color-mix(in srgb, var(--foreground) 9%, transparent); }
.rw-count { margin-left: auto; min-width: 1.6rem; padding: 0 0.4rem; border-radius: 999px; background: var(--background); border: 1px solid var(--border); font-size: 0.75rem; font-weight: 500; text-align: center; color: var(--foreground); }
.rw-me { margin-top: auto; padding: 0.75rem 0.6rem 0; border-top: 1px solid color-mix(in srgb, var(--foreground) 12%, transparent); display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.rw-me strong { display: block; font-weight: 600; font-size: 0.92rem; }
.rw-me .rw-faint { font-size: 0.82rem; }
.rw-canvas { min-width: 0; height: 100%; padding: 0.6rem 0.6rem 0 0; }
.rw-main { height: 100%; overflow-y: auto; padding: 2.75rem clamp(1.5rem, 5cqw, 4rem) 5rem; background: var(--background); border: 1px solid var(--border); border-bottom: 0; border-radius: calc(var(--radius) * 1.6) calc(var(--radius) * 1.6) 0 0; }
.rw-page { width: 100%; max-width: 62rem; margin-inline: auto; }

/* ---- page header */
.rw-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; }
.rw-title { font-family: var(--font-display); font-weight: 600; font-size: 2rem; line-height: 1.15; letter-spacing: -0.01em; }
.rw-lede { color: var(--foreground-muted); margin-top: 0.3rem; max-width: 42rem; }
.rw-head-actions { display: flex; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

/* ---- toolbar and search */
.rw-body { display: flex; flex-direction: column; gap: 1rem; }
.rw-toolbar { display: flex; align-items: center; gap: 1rem; }
.rw-search { width: 20rem; max-width: 100%; height: 2.4rem; padding: 0 0.8rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); box-shadow: 0 1px 1px color-mix(in srgb, var(--foreground) 5%, transparent); }
.rw-toolbar .rw-faint { margin-left: auto; font-size: 0.9rem; white-space: nowrap; }

/* ---- table: rows on dotted rules, no box around it */
.rw-table-wrap { overflow-x: auto; }
.rw-table { width: 100%; border-collapse: collapse; }
.rw-table th { text-align: left; font-weight: 600; font-size: 0.85rem; padding: 0.6rem 0.75rem; border-bottom: 1px dotted var(--foreground-muted); white-space: nowrap; }
.rw-table td { padding: 0.75rem; border-bottom: 1px dotted var(--border); vertical-align: middle; }
.rw-table tbody tr:hover { background: var(--surface); }
.rw-table .num { text-align: right; }
.rw-row-actions { text-align: right; white-space: nowrap; }
.rw-row-actions > * + * { margin-left: 0.4rem; }

/* ---- board: a column per workflow state */
.rw-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(16rem, 1fr); gap: 1.25rem; overflow-x: auto; align-items: start; }
.rw-lane { display: flex; flex-direction: column; gap: 0.6rem; min-width: 0; }
.rw-lane-title { font-weight: 600; font-size: 0.9rem; text-transform: capitalize; padding: 0 0.25rem 0.5rem; border-bottom: 1px dotted var(--foreground-muted); }
.rw-lane-empty { padding: 0.5rem 0; }
.rw-card { background: var(--background); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 1px 2px color-mix(in srgb, var(--foreground) 7%, transparent); padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.rw-card-line { font-size: 0.9rem; }
.rw-card-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }

/* ---- controls */
.rw-btn { height: 2.4rem; padding: 0 0.95rem; border-radius: var(--radius); border: 1px solid var(--border); background: var(--background); box-shadow: 0 1px 1px color-mix(in srgb, var(--foreground) 5%, transparent); font-weight: 500; cursor: pointer; white-space: nowrap; }
.rw-btn:hover { background: var(--surface); }
.rw-btn-small { height: 1.95rem; padding: 0 0.65rem; font-size: 0.9rem; }
.rw-btn-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.rw-btn-primary:hover { background: color-mix(in srgb, var(--primary) 86%, var(--foreground-muted)); }
.rw-btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.rw-btn:focus-visible, .rw-link:focus-visible, .rw-input:focus-visible, .rw-search:focus-visible, .rw-tab:focus-visible {
  outline: 2px solid var(--primary); outline-offset: 1px;
}
.rw-btn:disabled { opacity: 0.5; cursor: default; }
.rw-link { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; text-align: left; }
.rw-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.rw-strong { font-weight: 600; }
.rw-faint { color: var(--foreground-muted); }

/* ---- forms and dialogs */
.rw-form { display: flex; flex-direction: column; gap: 1rem; }
.rw-field { display: flex; flex-direction: column; gap: 0.3rem; }
.rw-label { font-size: 0.9rem; font-weight: 600; }
.rw-input { width: 100%; height: 2.4rem; padding: 0 0.8rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--background); box-shadow: 0 1px 1px color-mix(in srgb, var(--foreground) 5%, transparent); }
.rw-input:disabled { background: var(--surface); color: var(--foreground-muted); }
.rw-check { width: 1.1rem; height: 1.1rem; accent-color: var(--primary); }
.rw-error { color: var(--danger); font-size: 0.9rem; }
.rw-form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem; }
.rw-dialog { padding: 0; border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.6); background: var(--background); color: var(--foreground); width: min(30rem, calc(100vw - 2rem)); box-shadow: 0 8px 30px color-mix(in srgb, var(--foreground) 16%, transparent); }
.rw-dialog::backdrop { background: color-mix(in srgb, var(--foreground) 40%, transparent); }
.rw-dialog-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; }
.rw-dialog-title { font-family: var(--font-display); font-weight: 600; font-size: 1.35rem; }

/* ---- one record: header, tabs, then label and control on dotted rows */
.rw-back { display: inline-block; margin-bottom: 1rem; font-size: 0.9rem; color: var(--foreground-muted); }
.rw-record-head { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
.rw-thumb { flex: none; width: 3rem; height: 3.75rem; object-fit: cover; border-radius: calc(var(--radius) * 0.4); }
.rw-record-text { flex: 1; min-width: 0; }
.rw-record-title { font-family: var(--font-display); font-weight: 600; font-size: 1.75rem; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.rw-summary { display: flex; flex-wrap: wrap; color: var(--foreground-muted); font-size: 0.95rem; }
.rw-summary span + span::before { content: "|"; margin: 0 0.5rem; opacity: 0.5; }
.rw-tabs { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; overflow-x: auto; }
.rw-tab { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.7rem; border: 0; border-radius: var(--radius); background: none; color: var(--foreground-muted); font-weight: 500; font-size: 0.92rem; cursor: pointer; white-space: nowrap; }
.rw-tab:hover { color: var(--foreground); }
.rw-tab[aria-selected="true"] { background: var(--muted); color: var(--foreground); font-weight: 600; }
.rw-section-title { font-weight: 600; font-size: 1.02rem; padding-bottom: 0.75rem; border-bottom: 1px dotted var(--foreground-muted); }
.rw-rows { display: flex; flex-direction: column; }
.rw-row-field { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 1.5rem; align-items: start; padding: 1.1rem 0; border-bottom: 1px dotted var(--foreground-muted); }
.rw-row-field .rw-label { padding-top: 0.45rem; }
.rw-row-note { display: block; font-weight: 400; font-size: 0.85rem; color: var(--foreground-muted); }
.rw-row-value { min-height: 2.4rem; padding-top: 0.45rem; overflow-wrap: anywhere; }
.rw-control { max-width: 19rem; }
.rw-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; padding: 0.9rem 0; background: var(--background); }
.rw-file { max-width: 9rem; border-radius: var(--radius); border: 1px solid var(--border); box-shadow: 0 4px 12px color-mix(in srgb, var(--foreground) 12%, transparent); }

/* ---- empty, placeholder, notifications */
.rw-empty { padding: 3rem 0; display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; }
.rw-empty-title { font-family: var(--font-display); font-weight: 600; font-size: 1.4rem; }
.rw-placeholder { border: 1px dashed var(--foreground-muted); border-radius: var(--radius); padding: 0.9rem 1rem; color: var(--foreground-muted); }
.rw-placeholder strong { color: var(--foreground); }
.rw-notes { position: fixed; left: 1rem; bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 20; }
.rw-note { padding: 0.6rem 0.9rem; border-radius: var(--radius); background: var(--foreground); color: var(--background); max-width: 24rem; }
.rw-note-error { background: var(--danger); color: var(--primary-foreground); }

/* ---- home: the signed-in role's own stories */
.rw-stories { list-style: none; margin: 0; padding: 0; border-top: 1px dotted var(--foreground-muted); }
.rw-story { display: flex; justify-content: space-between; align-items: baseline; gap: 2rem; padding: 1.1rem 0; border-bottom: 1px dotted var(--foreground-muted); }
.rw-story-text { font-size: 1.1rem; max-width: 40rem; }
.rw-story-gap { color: var(--foreground-muted); font-style: normal; }
.rw-section { font-weight: 600; font-size: 1.1rem; margin: 2.25rem 0 0.75rem; }

/* ---- sign-in */
.rw-login-wrap { min-height: 100%; display: grid; place-items: center; padding: 1.5rem; }
.rw-login { width: min(26rem, 100%); padding: 2rem; background: var(--background); border: 1px solid var(--border); border-radius: calc(var(--radius) * 1.6); box-shadow: 0 4px 16px color-mix(in srgb, var(--foreground) 9%, transparent); }
.rw-login-title { font-family: var(--font-display); font-weight: 600; font-size: 1.9rem; line-height: 1.15; margin-bottom: 0.4rem; }
.rw-login .rw-form { margin-top: 1.75rem; }
.rw-demo { margin-top: 2rem; padding-top: 1rem; border-top: 1px dotted var(--foreground-muted); display: flex; flex-direction: column; gap: 0.6rem; }
.rw-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* The shell measures itself, not the window, so it holds its shape inside the Builder's preview too. */
@container shell (max-width: 48rem) {
  .rw-frame { grid-template-columns: 11rem minmax(0, 1fr); }
  .rw-side { padding-inline: 0.5rem; }
  .rw-main { padding: 1.5rem 1.1rem 4rem; }
  .rw-head { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
  .rw-title { font-size: 1.6rem; }
  .rw-search { width: 100%; }
  .rw-row-field { grid-template-columns: minmax(0, 1fr); gap: 0.35rem; }
  .rw-control { max-width: none; }
  .rw-story { flex-direction: column; gap: 0.4rem; }
}
@container shell (max-width: 30rem) {
  .rw-frame { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .rw-side { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; padding: 0.6rem 0.75rem; }
  .rw-nav { flex-direction: row; flex-wrap: wrap; }
  .rw-nav + .rw-nav { padding-top: 0; border-top: 0; }
  .rw-nav-group { display: none; }
  .rw-me { margin: 0 0 0 auto; padding: 0; border: 0; }
  .rw-canvas { padding: 0; }
  .rw-main { padding: 1.25rem 1rem 4rem; border-width: 1px 0 0; border-radius: 0; }
  .rw-record-head { flex-wrap: wrap; }
}
