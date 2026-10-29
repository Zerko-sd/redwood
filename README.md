# Redwood

You write user stories and a spec; Redwood generates a working business app from it.

The AI only ever **picks from closed lists**, a person accepts each pick, and the picks are saved in the spec. Generating the app from that spec uses no AI, and the same spec always produces byte-for-byte the same app. The full idea is in [`concept.md`](concept.md).

## Status

Early. What runs today:

| Piece | State |
|---|---|
| Spec format, validation, commands | Working |
| Planner (what each screen becomes, and why) | Working, rule-based |
| Generator (frontend, API, database migrations, tests) | Working |
| CLI | Working (this page) |
| Server: accounts, projects, roles, history, live preview | Working |
| Builder UI (stories, data, pages, access, history, live preview) | Working, forms and tables (no spreadsheet grid yet) |
| AI suggestions from stories (Nebius, any OpenAI-compatible endpoint) | Working; tested against a stand-in model, not yet against the hosted one |
| Google Sheets connector, Excel/CSV import | **Not built yet** |

You can use Redwood from the Builder in a browser (see below), from the command line, or through the server's HTTP API.

## Requirements

- **Node 22.13 or newer.** Check with `node -v`. Redwood and the apps it generates use Node's built-in SQLite, so there is no database to install.
- Windows, macOS or Linux.

## Install

```
npm install
```

## Quick start: from a spec to a running app

```
npx redwood init "Bus Fleet" --example     # writes bus-fleet.spec.json
npx redwood check bus-fleet.spec.json      # validates it
npx redwood plan bus-fleet.spec.json       # shows what each screen becomes, and which story justifies it
npx redwood generate bus-fleet.spec.json -o my-app
```

Run the generated app:

```
cd my-app
npm install
npm run dev:api      # terminal 1: the API on http://127.0.0.1:8787, with demo users
npm run dev:web      # terminal 2: the UI on http://localhost:5173
```

Open http://localhost:5173. In development the sign-in page has a button per role (`admin`, `driver`); the demo password is `redwood`. Try both: the driver sees only their own trips and cannot open Buses.

Run the app's own tests (they check every role against every operation of the API):

```
npm test
```

## The commands

| Command | What it does |
|---|---|
| `redwood init <name> [--example] [-o file]` | Write a starter spec: blank, or the Bus Fleet example. Never overwrites a file. |
| `redwood check <spec>` | Validate a spec. Lists errors and warnings; exit code 1 if there are errors. |
| `redwood plan <spec>` | For each screen, show the parts chosen, the story each one serves, and what was dropped and why. |
| `redwood generate <spec> -o <dir>` | Generate the app. Running it again only replaces files it wrote itself. |
| `redwood verify <dir>` | List generated files that someone edited by hand. |

`generate` options:

- `--force` overwrites generated files that were edited by hand. Without it, Redwood refuses and tells you which files.
- `--allow-destructive` accepts a migration that drops a column or table. Without it, Redwood stops and lists what would be lost.

### Changing an app after it is generated

Edit the spec, then run `generate` again into the same folder.

- Renaming a field becomes a database rename, not a drop and re-add, so data survives.
- Your own code goes in `custom/` (extra API routes in `custom/routes.ts`, CSS in `custom/overrides.css`). Redwood creates those files once and never touches them again.
- Anything Redwood has no template for is left as a visible placeholder and listed as "needs a developer". It never guesses.

## Layouts, blocks, themes: how the look is chosen and extended

A screen's page is **a layout filled with blocks**, on top of a theme. Each is a named, registered unit, so adding one never means editing the others.

| Thing | Picked by | Where it is declared |
|---|---|---|
| **Layout** (`list`, `board`, `form-page`) | the screen's `layout`, else a rule: a screen that only creates records becomes a `form-page`, anything else a `list` | the closed list in `packages/parts`, the renderer in `packages/generator/src/layouts.ts` |
| **Block** (table, search, dialogs, detail pane, ...) | the layout | `packages/generator/src/blocks.ts` |
| **Theme** (`default`, `harbor`, `graphite`) | `theme.preset`, with `theme.tokens` overriding single values | `THEMES` in `packages/parts` |
| **UI kit** (components, CSS) | `theme.kit` | `packages/kit-shadcn`; a kit lists the parts it lacks |

`redwood plan` shows the layout each screen got and why. To ask for another shape, set it in the spec:

```json
{ "id": "screen:trips", "layout": "board", "blocks": ["live-map"], "...": "..." }
```

A name that does not exist is refused by `redwood check` with the list of valid ones. A `board` needs an entity with a workflow (one column per state).

**Adding a layout:** add its id and a one-line description to `LAYOUTS` in `packages/parts`, then `registerLayout({ id, blocks, shell })`. A test fails if an id has no renderer.
**Adding a block:** `registerBlock({ id, render })`, then list it in a layout. A block reads the names the page scaffold provides (`rows`, `visible`, `columns`, `editing`, ...) and never needs to know which layout it is in.

### When Redwood has no template

It never guesses and never leaves something out silently:

- **A named block it does not know** (`"blocks": ["live-map"]`): it writes `custom/blocks/LiveMap.tsx` once, with a brief at the top (the screen, the stories it serves, the columns it receives) that renders a visible "Developer needed" notice. Redwood never overwrites that file. The notice is listed as needing a developer until the file stops rendering the placeholder.
- **A UI kit part that does not exist:** a visible placeholder in its place.
- **A custom action** (`operation: "custom"`): a button that opens a "Not built yet" dialog, and a `501` route until you build it in `custom/routes.ts`.
- **A story no screen serves:** a gap row on that role's Home page.

## The Builder

```
npm start            # terminal 1: the server on http://127.0.0.1:8800
npm run builder      # terminal 2: the Builder on http://localhost:5180
```

Open http://localhost:5180, create an account, and start a project (tick the example to begin from Bus Fleet). Five tabs, one per step:

- **Stories**: roles, and what each one needs to do. A story with no screen is marked.
- **Data**: tables and fields. Choosing `reference` or `choice` fills in a target or options so the spec stays valid.
- **Pages**: each page's layout, the stories it serves, and every part with the reason for it. Questions no rule can answer (a totals strip) are asked here as Yes/No and saved in the spec.
- **Access**: a role-by-table grid of operations, and "own rows only".
- **History**: every revision; restoring adds a new one.

The right-hand pane runs the generated app and rebuilds it on every change. The header lists problems the spec has. If someone else edits the same project, you see it and your next edit is rebased or refused with the clashing items.

The Builder holds no state of its own: every edit is a command sent to the server. To use another server port, set `REDWOOD_PORT` for `npm run builder`.

## The server and live preview

```
npm start
```

Starts the Redwood server on http://127.0.0.1:8800 (set `PORT` to change it; data goes to `data/redwood.db`, or set `REDWOOD_DB`). It offers accounts, organisations, projects with owner / editor / reviewer / viewer roles, a versioned spec with history and named versions, live updates over a WebSocket, and a **live preview** that runs the generated app and regenerates it on every change to the spec.

The Builder drives this API; you can also call it directly. A short tour with `curl` (Git Bash or macOS/Linux; use `-c`/`-b` to keep the session cookie):

```
curl -c jar -H 'content-type: application/json' -d '{"username":"you","password":"a long password"}' localhost:8800/api/auth/signup
curl -b jar -H 'content-type: application/json' -d '{"name":"Fleet","template":"example"}' localhost:8800/api/projects
curl -b jar -X POST localhost:8800/api/projects/<id>/preview/start     # first start installs dependencies (about 20s)
curl -b jar localhost:8800/api/projects/<id>/preview                   # state, and the preview's URL when running
```

Edits are sent as small commands (`addStory`, `updateField`, `grant`, ...) with the revision they were based on. An edit based on an old revision is applied if it touches different items than what changed since, and rejected with the clashing items listed if it does not. Nothing is overwritten silently.

The preview binds to `127.0.0.1` only, because it seeds demo accounts with a known password. Do not expose it to a network.

## Building the spec from your stories

Write the roles and stories, then click **Build it all** in the Builder (or **Suggest next** to go one at a time). It asks one question at a time, in this order:

| Step | Decided by | Becomes |
|---|---|---|
| Where a story lives: its table and page | the model, from the story and the tables and pages so far | a table, a page, the story linked to the page |
| What a table stores | the model, from that table's stories only | fields (type from the closed list, options for a choice, references to other tables) |
| What a page can do | the model, from the page's stories | `list` / `read` / `create` / `update` / `delete`, plus named custom actions |
| Who opens a page | **a rule**: the roles whose stories are on it | the page's roles |
| Who can do what | **a rule**: what the pages a role's stories live on can do | access rules |
| Status buttons, own records | the model | workflow transitions, "own rows only" |
| The look | the model, from the fixed theme list | the theme preset |

Rules the model works under: it only picks from closed lists, anything outside a list is refused (after one retry it is shown to you as "could not answer", never guessed), a suggestion changes nothing until it is accepted, and every item it creates records the model, the prompt hash, the stories it came from and who accepted it. A skipped question is not asked again; an edited story is.

To turn it on, copy `.env.example` to `.env`, fill in `NEBIUS_API_KEY` (`NEBIUS_BASE_URL` and `NEBIUS_MODEL` have defaults), and restart `npm start`. `.env` is git-ignored; never commit a key. Without a key the Builder works as before and says suggestions are off. Any OpenAI-compatible endpoint works if you change the base URL and model.

Answers are asked at temperature 0 with a fixed seed and remembered by exact prompt while the server runs.

## Layouts, blocks, themes: how the look is chosen and extended

A screen's page is **a layout filled with blocks**, on top of a theme. Each is a named, registered unit, so adding one never means editing the others.

| Thing | Picked by | Where it is declared |
|---|---|---|
| **Layout** (`list`, `board`, `form-page`) | the screen's `layout`, else a rule: a screen that only creates records becomes a `form-page`, anything else a `list` | the closed list in `packages/parts`, the renderer in `packages/generator/src/layouts.ts` |
| **Block** (table, search, dialogs, detail pane, ...) | the layout | `packages/generator/src/blocks.ts` |
| **Theme** (`default`, `harbor`, `graphite`) | `theme.preset`, with `theme.tokens` overriding single values | `THEMES` in `packages/parts` |
| **UI kit** (components, CSS) | `theme.kit` | `packages/kit-shadcn`; a kit lists the parts it lacks |

`redwood plan` shows the layout each screen got and why. To ask for another shape, set it in the spec:

```json
{ "id": "screen:trips", "layout": "board", "blocks": ["live-map"], "...": "..." }
```

A name that does not exist is refused by `redwood check` with the list of valid ones. A `board` needs an entity with a workflow (one column per state).

**Adding a layout:** add its id and a one-line description to `LAYOUTS` in `packages/parts`, then `registerLayout({ id, blocks, shell })`. A test fails if an id has no renderer.
**Adding a block:** `registerBlock({ id, render })`, then list it in a layout. A block reads the names the page scaffold provides (`rows`, `visible`, `columns`, `editing`, ...) and never needs to know which layout it is in.

### When Redwood has no template

It never guesses and never leaves something out silently:

- **A named block it does not know** (`"blocks": ["live-map"]`): it writes `custom/blocks/LiveMap.tsx` once, with a brief at the top (the screen, the stories it serves, the columns it receives) that renders a visible "Developer needed" notice. Redwood never overwrites that file. The notice is listed as needing a developer until the file stops rendering the placeholder.
- **A UI kit part that does not exist:** a visible placeholder in its place.
- **A custom action** (`operation: "custom"`): a button that opens a "Not built yet" dialog, and a `501` route until you build it in `custom/routes.ts`.
- **A story no screen serves:** a gap row on that role's Home page.

## The Builder

```
npm start            # terminal 1: the server on http://127.0.0.1:8800
npm run builder      # terminal 2: the Builder on http://localhost:5180
```

Open http://localhost:5180, create an account, and start a project (tick the example to begin from Bus Fleet). Five tabs, one per step:

- **Stories**: roles, and what each one needs to do. A story with no screen is marked.
- **Data**: tables and fields. Choosing `reference` or `choice` fills in a target or options so the spec stays valid.
- **Pages**: each page's layout, the stories it serves, and every part with the reason for it. Questions no rule can answer (a totals strip) are asked here as Yes/No and saved in the spec.
- **Access**: a role-by-table grid of operations, and "own rows only".
- **History**: every revision; restoring adds a new one.

The right-hand pane runs the generated app and rebuilds it on every change. The header lists problems the spec has. If someone else edits the same project, you see it and your next edit is rebased or refused with the clashing items.

The Builder holds no state of its own: every edit is a command sent to the server. To use another server port, set `REDWOOD_PORT` for `npm run builder`.

## The server and live preview

```
npm start
```

Starts the Redwood server on http://127.0.0.1:8800 (set `PORT` to change it; data goes to `data/redwood.db`, or set `REDWOOD_DB`). It offers accounts, organisations, projects with owner / editor / reviewer / viewer roles, a versioned spec with history and named versions, live updates over a WebSocket, and a **live preview** that runs the generated app and regenerates it on every change to the spec.

The Builder drives this API; you can also call it directly. A short tour with `curl` (Git Bash or macOS/Linux; use `-c`/`-b` to keep the session cookie):

```
curl -c jar -H 'content-type: application/json' -d '{"username":"you","password":"a long password"}' localhost:8800/api/auth/signup
curl -b jar -H 'content-type: application/json' -d '{"name":"Fleet","template":"example"}' localhost:8800/api/projects
curl -b jar -X POST localhost:8800/api/projects/<id>/preview/start     # first start installs dependencies (about 20s)
curl -b jar localhost:8800/api/projects/<id>/preview                   # state, and the preview's URL when running
```

Edits are sent as small commands (`addStory`, `updateField`, `grant`, ...) with the revision they were based on. An edit based on an old revision is applied if it touches different items than what changed since, and rejected with the clashing items listed if it does not. Nothing is overwritten silently.

The preview binds to `127.0.0.1` only, because it seeds demo accounts with a known password. Do not expose it to a network.

## Using a hosted model (not wired up yet)

The AI decision engine will use an OpenAI-compatible endpoint. Copy `.env.example` to `.env` and fill in `NEBIUS_API_KEY`. `.env` is git-ignored; never commit a key.

## Layout

```
packages/
  spec/         the spec schema, validation, canonical JSON, and the command layer every editor uses
  parts/        the abstract parts every UI kit must provide (Table, Form, ...) and the theme tokens
  planner/      spec -> per-screen plan, with the reason for every choice
  migrations/   spec diff -> SQL; renames are detected by stable ID
  kit-shadcn/   the first UI kit (shadcn-style components driven by CSS variables)
  generator/    plan -> files, manifest, and the refusal to overwrite hand edits
apps/
  cli/          the redwood command
  server/       accounts, projects, history, WebSocket, live preview
  suggest/      stories -> proposed spec changes: the prompts, the closed-list checks, the model client
  builder/      the browser UI: React + Vite, talks only to the server
examples/       bus-fleet.spec.json
```

## Development

```
npm test           # all packages
npm run typecheck
```

## Known limits

- Suggestions do not yet choose a page's visible fields, a page's place in the navigation, who may set an individual field, validation rules or services. The old Redwood decided some of these; the new spec has nowhere to keep them yet.
- A status button's label is not stored (the generator labels it with the state it moves to).
- A role that may not list a table sees no names for references to it (it shows "(unavailable)") and gets no picker. Access rules are never bypassed to make a label prettier.
- Custom actions on an entity (`operation: "custom"`) are answered with `501` until a developer implements them in `custom/routes.ts`.
- The UI kit is shadcn-style, not the vendored shadcn registry. Swapping kits is designed for but only one exists.
- Three layouts and three themes exist so far. A company can register more, but there is no loader for a separate "company pack" yet: registration happens in code.
- Spec-named blocks that Redwood has no template for are never rendered from a library; only the developer-file path exists today.
- Generated apps use caret version ranges and no lockfile, so two machines can resolve slightly different dependency versions.
- Several preview apps open on `localhost` at once share the `sid` cookie name and can sign each other out.
