# Redwood — Concept

What this project is, what it decides, and what it must produce. It says
**what**, never **how**, so the "how" can be redesigned from scratch.

---

## 1. The core idea (the edge)

**You write user stories, and you get a working business app.**

Most AI app builders let a model write the code. Redwood doesn't. Its edge is:

1. **The AI only makes choices; it never writes code.** Every AI answer is a
   pick from a closed list (which entity, which layout, which role, which
   theme). A bad answer gets refused, so it can't turn into bad code.
2. **The decisions are saved in a spec.** Once a person has accepted the
   AI's answers, they live in one spec file. Building the app from that spec
   needs no AI at all.
3. **One spec always gives the same app.** It comes out byte for byte the same
   on any machine, every time, so it can be reviewed, tested and versioned.
4. **Company rules are enforced, not suggested.** Who may do what is one
   matrix, and it's applied the same way to every screen and every endpoint.
   Approved company components are pinned to a version and a hash.
5. **Gaps are never improvised.** If Redwood has nothing that fits, it leaves
   a visible placeholder for a developer and says so. It never guesses.
6. **It works without a model.** When no AI is available, it falls back to
   deterministic suggestions and says that it did.

---

## 2. What goes in (the spec)

A person describes the app, in a spreadsheet-like Builder or as one spec file:

| Part | Meaning |
|---|---|
| **Title** | The app's name |
| **Roles** | Who uses it (admin, driver, manager…) |
| **User stories** | "As a *role* I want *action* so that *reason*" — the source of truth |
| **Entities + fields** | The things the app stores (Bus, Trip, Member…) and their columns |
| **Screens** | Each page: its path, what it shows, which stories it serves |
| **Endpoints** | What each screen can do: read, create, update, delete, custom actions |
| **Services** | Background or external work the app relies on |
| **Access rules** | Which role may see or do what (one matrix) |
| **Theme** | The look, picked from a fixed set |

Everything else gets decided from these.

---

## 3. Where the AI is used

### What the AI decides
Each decision is one small, separate question:

| Decision | Question it answers |
|---|---|
| Entity | Which thing is this story about? |
| Fields | What columns does this entity need? |
| Endpoints | What operations does this screen need? |
| Screen operations | Which actions belong on this screen? |
| Screen layout | Which page shape fits this screen, and which fields show? |
| App structure | Where does each page sit, and which roles can open it? |
| Access rules | Who may do what? |
| Validation rules | Which guard conditions protect an endpoint? |
| Services | What supporting services are implied? |
| Theme | Which look fits this app? |

There's also a **story check**, which uses no AI: it lists stories the spec is
probably missing, such as security, privacy and multi-tenancy.

### Rules every AI call follows
- The answer must match a strict shape and pick from a closed list.
- A refused answer is retried **once**, with the reason it was refused.
- Temperature is 0, so the same question gets the same answer.
- Every answer is cached, so a question is only paid for once.
- If the model fails, that's treated as "no suggestion", never as a crash.
- A person sees and accepts each suggestion before it goes into the spec.
- A set of example questions with accepted answers is used to score a model
  before switching models or prompts.

### Models
| Use | Model |
|---|---|
| Everyday decisions | Small local open-source model by default (via Ollama). Swappable for a hosted model or any OpenAI-compatible endpoint |
| Writing new company components | A stronger hosted model. Optional: a person starts it, and a person approves the result |

### Writing new components (separate and opt-in)
When a screen needs something Redwood doesn't have (a live map, a GPS tracker,
a calendar):
- if the company pack has it, the approved version gets used;
- if not, a placeholder goes in for a developer;
- optionally, a stronger model drafts it. It must pass the same automatic
  checks a developer's version would (a safe set of imports, no network or
  storage calls, it builds, it renders). Then a person approves it into the
  company pack.

Generating the app itself never calls a model.

---

## 4. The flow

```
 Stories + roles
       │
       ▼
 AI suggests, a person accepts ──►  entities, fields, screens, endpoints,
 (one small question at a time)     layouts, structure, access, theme
       │
       ▼
 Story check: "you are probably missing these stories"
       │
       ▼
 Spec (one file, versioned, with full history)
       │
       ▼
 Check the spec: does it build? what should be fixed?
       │
       ▼
 Plan each screen: what it will become, and why (reviewable before any code)
       │
       ▼
 Generate (no AI): frontend + backend + manifest + placeholders
       │
       ├──► Live preview beside the spec (sign in as each role)
       └──► Download as a zip / write to disk from the command line
```

Regenerating only replaces what the previous generation wrote. Files a person
added are never touched. A generated file that someone edited by hand is
refused rather than silently overwritten.

---

## 5. What gets generated

### Frontend (web app)
- One page per screen, each built from a known page shape filled with known
  parts: tables, forms, detail panes, stat cards, dialogs, empty states,
  toolbars…
- Navigation and a home page for each role.
- Sign-in and sign-up (secure by default).
- Every page and action hidden or blocked according to the access matrix.
- The chosen theme, mobile-friendly.
- Approved company components where the spec names them.
- Placeholders for anything Redwood doesn't have.

### Backend (API + database)
- A database schema from the entities.
- One API route per endpoint, built from known route shapes.
- Authentication, and the same access matrix enforced on every route.
- Validation guards on the endpoints.
- Tests for the generated app.

### Manifest
- Which generator version and which spec made this app.
- A fingerprint of every generated file, so any hand edit is detectable.
- Which company component versions were used.
- What still needs a developer.

### Reports along the way
- The plan for each screen: the shape, the parts, what was kept or dropped, and why.
- Warnings, things that had to be inferred, and missing stories.

---

## 6. The API (by capability)

| Capability | What it offers |
|---|---|
| **Health** | Is the service up, which model is in use, is it reachable |
| **AI decisions** | One endpoint per decision in section 3, plus a general "ask anything" endpoint for other software (behind a key) |
| **Story recommendations** | The stories a spec is probably missing |
| **Projects** | Create, list, rename and delete projects. Each has its own spec and history |
| **Spec / workbook** | Save and load the spec, with protection against two tabs overwriting each other |
| **History** | Version history; name a version to keep it; restore any version |
| **Spec file** | The spec's schema; check a spec; build a whole app from one spec |
| **Planning** | What a screen would become, before any code |
| **Generators** | List what's known (page shapes, parts, route shapes, themes); generate the frontend, backend or whole app; zip download |
| **Preview** | Start, check on, and stop a live running copy of the generated app |
| **Company components** | List approved ones; start an AI drafting job; see its result and screenshot; approve or reject it |

The same things are also available from the command line: create a starter
spec, check, generate, batch-generate many specs, verify an app hasn't been
hand-edited, and manage company components.

---

## 7. Non-negotiables

- The AI chooses; it never writes the app's code.
- The same spec gives the same app.
- No template means a placeholder, not a guess.
- Access rules come from one place and are enforced everywhere.
- A person approves what the AI suggests.
- Everything works, in a reduced form, without a model.
- Don't add a capability unless a real spec needs it.

---

## 8. Direction being explored: bento decisions

Today the AI picks a **whole page shape** for a screen in one go.

The idea being explored is to break that down:

- A screen is a **bento box**: a fixed grid of sections (header, main area,
  side panel, footer…).
- Each section is filled by a series of **yes/no questions**, e.g. "Does
  this screen list many records?", "Can this role create one here?", "Does
  anyone need to see totals?"
- The answers come from the **user stories**, and each "yes" should point to
  the story that justifies it.
- A **small local open-source model** answers the questions the spec can't
  answer by itself.
- The answers are saved in the spec, so building stays AI-free and repeatable.
