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

/** Sidebar icons: 24x24 stroke paths, so the generated app needs no icon package. */
const NAV_ICONS: Record<string, string[]> = {
  home: ["M3 11l9-8 9 8", "M5 10v10h5v-6h4v6h5V10"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  feed: ["M23 7l-7 5 7 5V7z", "M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"],
  map: ["M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z", "M8 2v16", "M16 6v16"],
  chart: ["M18 20V10", "M12 20V4", "M6 20v-6"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M16 2v4", "M8 2v4", "M3 10h18"],
  box: ["M21 8l-9-5-9 5v8l9 5 9-5V8z", "M3 8l9 5 9-5", "M12 13v8"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
};
const ICON_WORDS: [string, RegExp][] = [
  ["users", /client|user|staff|customer|driver|people|team|member/i],
  ["feed", /feed|camera|stream|video/i],
  ["map", /region|map|floor|store|location|site/i],
  ["chart", /metric|report|health|batch|stat|dashboard|analytic|alert/i],
  ["calendar", /trip|schedule|calendar|booking|appointment|event/i],
  ["box", /bus|vehicle|product|item|stock|order|asset/i],
];
/** Picks an icon by the words in a screen's title, falling back to a plain list. */
export const navIcon = (title: string): string => ICON_WORDS.find(([, re]) => re.test(title))?.[0] ?? "list";

export function emitApp(spec: Spec): string {
  const entities = new Map(spec.entities.map((e) => [e.id, e]));
  const screens = spec.screens.map((s) => ({
    path: s.path,
    title: s.title,
    icon: navIcon(s.title),
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

const ICONS: Record<string, string[]> = ${JSON.stringify(
    Object.fromEntries(["home", ...new Set(screens.map((s) => s.icon))].sort().map((k) => [k, NAV_ICONS[k]!])),
  )};

function NavIcon({ name }: { name: string }) {
  return (
    <svg className="rw-nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const screens = [
${screens
  .map(
    (s) =>
      `  { path: ${str(s.path)}, title: ${str(s.title)}, icon: ${str(s.icon)}, roles: ${JSON.stringify(s.roles)}, table: ${s.table ? str(s.table) : "null"}, Component: ${s.component} },`,
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
            <NavLink to="/" end className={link}><NavIcon name="home" />Home</NavLink>
            {allowed.map((s) => <NavLink key={s.path} to={s.path} className={link}><NavIcon name={s.icon} />{s.title}</NavLink>)}
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
