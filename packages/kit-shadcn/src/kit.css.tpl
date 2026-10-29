/* Everything here reads the theme variables, so restyling means editing tokens (or custom/overrides.css). */
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
h1, h2, p { margin: 0; }
button, input, select { font: inherit; color: inherit; }
code { font-size: 0.9em; }

/* ---- shell: a full-height side rail and one content column */
.rw-shell { display: grid; grid-template-columns: 15rem minmax(0, 1fr); min-height: 100vh; }
.rw-side {
  position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column;
  padding: 1rem 0.5rem 0.75rem;
  background: var(--surface);
  border-right: 1px solid var(--border);
}
.rw-brand { font-family: var(--font-display); font-weight: 600; font-size: 1rem; padding: 0.25rem 0.75rem 1rem; }
.rw-nav { display: flex; flex-direction: column; gap: 2px; }
.rw-nav a { padding: 0.3rem 0.75rem; font-size: 0.925rem; border-radius: var(--radius); color: var(--foreground-muted); text-decoration: none; }
.rw-nav a:hover { color: var(--foreground); background: var(--muted); }
.rw-nav a.active { color: var(--foreground); background: var(--muted); font-weight: 600; }
.rw-me { margin-top: auto; padding: 0.9rem 0.75rem 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.15rem; align-items: flex-start; }
.rw-me strong { font-weight: 600; }
.rw-me .rw-faint { font-size: 0.85rem; }
.rw-main { padding: 4rem 4rem 6rem; width: 100%; max-width: 62rem; margin-inline: auto; }

/* ---- page header */
.rw-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; }
.rw-title { font-family: var(--font-display); font-weight: 600; font-size: 2.25rem; line-height: 1.15; letter-spacing: -0.02em; }
.rw-lede { color: var(--foreground-muted); margin-top: 0.35rem; max-width: 42rem; }
.rw-head-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

/* ---- toolbar and search */
.rw-body { display: flex; flex-direction: column; gap: 1rem; }
.rw-toolbar { display: flex; align-items: center; gap: 1rem; }
.rw-search {
  width: 20rem; max-width: 100%; height: 2.25rem; padding: 0 0.75rem;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--muted);
}
.rw-toolbar .rw-faint { margin-left: auto; font-size: 0.9rem; white-space: nowrap; }

/* ---- table: rows on hairlines, no box around it */
.rw-table-wrap { overflow-x: auto; background: var(--background); border: 1px solid var(--border); border-radius: var(--radius); }
.rw-table { width: 100%; border-collapse: collapse; }
.rw-table th {
  text-align: left; font-weight: 500; font-size: 0.85rem; color: var(--foreground-muted);
  padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); white-space: nowrap;
}
.rw-table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
.rw-table tbody tr:last-child td { border-bottom: 0; }
.rw-table tbody tr:hover { background: color-mix(in srgb, var(--muted) 55%, transparent); }
.rw-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.rw-row-actions { text-align: right; white-space: nowrap; }
.rw-row-actions > * + * { margin-left: 0.4rem; }

/* ---- board: a column per workflow state */
.rw-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(16rem, 1fr); gap: 1.25rem; overflow-x: auto; align-items: start; }
.rw-lane { display: flex; flex-direction: column; gap: 0.6rem; min-width: 0; }
.rw-lane-title { font-family: var(--font-display); font-weight: 600; font-size: 0.9rem; text-transform: capitalize; padding: 0 0.25rem 0.5rem; color: var(--foreground-muted); font-size: 0.9rem; }
.rw-lane-empty { padding: 0.5rem 0; }
.rw-card { background: var(--background); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: 0 1px 2px rgb(15 15 15 / 0.08); padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.2rem; }
.rw-card-line { font-size: 0.9rem; }
.rw-card-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }

/* ---- controls */
.rw-btn {
  height: 2.25rem; padding: 0 0.9rem; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--background); cursor: pointer; white-space: nowrap;
}
.rw-btn:hover { background: var(--muted); }
.rw-btn-small { height: 1.9rem; padding: 0 0.65rem; font-size: 0.9rem; }
.rw-btn-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.rw-btn-primary:hover { background: color-mix(in srgb, var(--primary) 88%, black); }
.rw-btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.rw-btn:focus-visible, .rw-link:focus-visible, .rw-input:focus-visible, .rw-search:focus-visible {
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
.rw-label { font-size: 0.9rem; font-weight: 500; }
.rw-input { height: 2.25rem; padding: 0 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--muted); }
.rw-check { width: 1.1rem; height: 1.1rem; accent-color: var(--primary); }
.rw-error { color: var(--danger); font-size: 0.9rem; }
.rw-form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.5rem; }
.rw-dialog { padding: 0; border: 1px solid var(--border); border-radius: calc(var(--radius) * 2); background: var(--background); color: var(--foreground); width: min(30rem, calc(100vw - 2rem)); box-shadow: 0 8px 30px rgb(15 15 15 / 0.14); }
.rw-dialog::backdrop { background: rgb(15 15 15 / 0.4); }
.rw-dialog-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1.25rem; }
.rw-dialog-title { font-family: var(--font-display); font-weight: 600; font-size: 1.35rem; letter-spacing: -0.01em; }

/* ---- detail pane */
.rw-detail {
  position: fixed; top: 0; right: 0; bottom: 0; width: 24rem; max-width: 100vw; z-index: 5;
  background: var(--surface); border-left: 1px solid var(--border); padding: 1.5rem;
  display: flex; flex-direction: column; gap: 1.25rem; overflow-y: auto;
  box-shadow: -4px 0 16px rgb(15 15 15 / 0.08);
}
.rw-detail-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
@media (min-width: 52.01rem) { .rw-has-detail .rw-main { padding-right: 27rem; } }
.rw-detail-title { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; letter-spacing: -0.01em; }
.rw-detail-list { margin: 0; }
.rw-detail-row { display: grid; grid-template-columns: 8rem 1fr; gap: 1rem; padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
.rw-detail-row dt { color: var(--foreground-muted); }
.rw-detail-row dd { margin: 0; }
.rw-detail-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: auto; }

/* ---- empty, placeholder, notifications */
.rw-empty { padding: 3rem 0; display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; }
.rw-empty-title { font-family: var(--font-display); font-weight: 600; font-size: 1.4rem; letter-spacing: -0.01em; }
.rw-placeholder { border: 1px dashed var(--foreground-muted); border-radius: var(--radius); padding: 0.9rem 1rem; color: var(--foreground-muted); }
.rw-placeholder strong { color: var(--foreground); }
.rw-notes { position: fixed; left: 1rem; bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem; z-index: 20; }
.rw-note { padding: 0.6rem 0.9rem; border-radius: var(--radius); background: var(--foreground); color: var(--background); max-width: 24rem; }
.rw-note-error { background: var(--danger); color: #fff; }

/* ---- home: the signed-in role's own stories */
.rw-stories { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border); }
.rw-story { display: flex; justify-content: space-between; align-items: baseline; gap: 2rem; padding: 1.1rem 0; border-bottom: 1px solid var(--border); }
.rw-story-text { font-size: 1.15rem; max-width: 40rem; }
.rw-story-gap { color: var(--foreground-muted); font-style: normal; }
.rw-section { font-family: var(--font-display); font-weight: 600; font-size: 1.2rem; margin: 2.25rem 0 0.75rem; }

/* ---- sign-in */
.rw-login { max-width: 26rem; margin: 14vh auto 3rem; padding: 2rem; border: 1px solid var(--border); border-radius: calc(var(--radius) * 2); box-shadow: 0 4px 16px rgb(15 15 15 / 0.10); }
.rw-login-title { font-family: var(--font-display); font-weight: 600; font-size: 2rem; line-height: 1.1; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
.rw-login .rw-form { margin-top: 2rem; }
.rw-demo { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.6rem; }
.rw-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }

@media (max-width: 52rem) {
  .rw-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; } /* spare height goes to the content, not the header */
  .rw-side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; padding: 0.75rem 1rem; border-right: 0; border-bottom: 1px solid var(--border); }
  .rw-brand { padding: 0; }
  .rw-nav { flex-direction: row; flex-wrap: wrap; }
  .rw-me { margin: 0 0 0 auto; padding: 0; border: 0; flex-direction: row; align-items: center; gap: 0.75rem; }
  .rw-main { padding: 1.5rem 1rem 4rem; }
  .rw-head { flex-direction: column; align-items: flex-start; }
  .rw-title { font-size: 1.6rem; }
  .rw-detail { width: 100vw; }
  .rw-search { width: 100%; }
  .rw-login { margin: 2rem 1rem; padding: 1.5rem; }
}
