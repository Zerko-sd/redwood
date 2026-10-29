import type { Spec } from "@redwood/spec";
import { tableName } from "@redwood/migrations";
import { roleSlug } from "./model";
import { pascal } from "./util";

export type { Gap } from "./registry";
import type { Gap } from "./registry";

export const screenFile = (screenId: string) => `src/web/screens/${pascal(screenId)}.tsx`;

const str = (s: string) => JSON.stringify(s);

/** The home screen: the signed-in role's own stories, each linking to the screen that serves it, or showing the gap. */
export function emitHome(spec: Spec, gaps: Gap[]): string {
  const entities = new Map(spec.entities.map((e) => [e.id, e]));
  const homes: Record<string, unknown> = {};
  for (const role of spec.roles) {
    homes[roleSlug(role.id)] = {
      name: role.name,
      stories: spec.stories
        .filter((s) => s.role === role.id)
        .map((s) => {
          const candidates = spec.screens
            .filter((sc) => sc.stories.includes(s.id) && (sc.roles.length === 0 || sc.roles.includes(role.id)))
            .map((sc) => ({
              path: sc.path,
              title: sc.title,
              table: sc.entity ? tableName(entities.get(sc.entity)!) : null,
            }));
          if (!candidates.length) gaps.push({ what: s.id, why: "no screen serves this story for its role" });
          return { text: s.action, reason: s.reason, screens: candidates };
        }),
    };
  }
  return `import { Page, StoryList } from "./ui";
import { useMe } from "./api";
import { appTitle } from "../shared/model";
import { can } from "../shared/policy";

const HOMES: Record<string, { name: string; stories: { text: string; reason: string; screens: { path: string; title: string; table: string | null }[] }[] }> = ${JSON.stringify(homes, null, 2)};

export default function Home() {
  const me = useMe();
  const home = HOMES[me.role] ?? { name: me.role, stories: [] };
  const items = home.stories.map((s) => {
    // The first screen this role may actually open; none means the story has no working screen yet.
    const screen = s.screens.find((sc) => !sc.table || can(me.role, sc.table, "list"));
    return {
      text: s.text,
      reason: s.reason,
      to: screen ? { path: screen.path, label: "Open " + screen.title } : undefined,
    };
  });
  return (
    <Page title={home.name} subtitle={"What you can do in " + appTitle + "."}>
      <StoryList items={items} />
    </Page>
  );
}
`;
}

export function emitApp(spec: Spec): string {
  const entities = new Map(spec.entities.map((e) => [e.id, e]));
  const screens = spec.screens.map((s) => ({
    path: s.path,
    title: s.title,
    roles: s.roles.map(roleSlug),
    table: s.entity ? tableName(entities.get(s.entity)!) : null,
    component: `${pascal(s.id)}Screen`,
    file: `./screens/${pascal(s.id)}`,
  }));
  return `import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
${screens.map((s) => `import ${s.component} from ${str(s.file)};`).join("\n")}
import Home from "./Home";
import { useMe } from "./api";
import { appTitle } from "../shared/model";
import { can } from "../shared/policy";

const screens = [
${screens
  .map(
    (s) =>
      `  { path: ${str(s.path)}, title: ${str(s.title)}, roles: ${JSON.stringify(s.roles)}, table: ${s.table ? str(s.table) : "null"}, Component: ${s.component} },`,
  )
  .join("\n")}
];

export function App({ onSignOut }: { onSignOut: () => void }) {
  const me = useMe();
  // A screen shows only to its roles, and only if the role may list the entity behind it.
  const allowed = screens.filter(
    (s) => (s.roles.length === 0 || s.roles.includes(me.role)) && (!s.table || can(me.role, s.table, "list")),
  );
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : undefined);
  return (
    <BrowserRouter>
      <div className="rw-shell">
        <aside className="rw-side">
          <div className="rw-brand">{appTitle}</div>
          <nav className="rw-nav" aria-label="Main">
            <NavLink to="/" end className={link}>Home</NavLink>
            {allowed.map((s) => <NavLink key={s.path} to={s.path} className={link}>{s.title}</NavLink>)}
          </nav>
          <div className="rw-me">
            <strong>{me.username}</strong>
            {me.username !== me.role && <span className="rw-faint">{me.role}</span>}
            <button className="rw-link rw-faint" onClick={onSignOut}>Sign out</button>
          </div>
        </aside>
        <main className="rw-main">
          <Routes>
            <Route path="/" element={<Home />} />
            {allowed.map((s) => <Route key={s.path} path={s.path} element={<s.Component />} />)}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
`;
}
