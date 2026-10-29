import { useEffect, useState } from "react";
import { api, type User } from "./api";
import { Editor } from "./Editor";
import { Login } from "./Login";
import { Projects } from "./Projects";

/** The open project lives in the URL (`?project=<id>`) so a refresh or a shared link lands in the same place. */
const readProject = () => new URLSearchParams(location.search).get("project");

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [project, setProject] = useState<string | null>(readProject());

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
    const onPop = () => setProject(readProject());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const open = (id: string | null) => {
    history.pushState(null, "", id ? `?project=${encodeURIComponent(id)}` : location.pathname);
    setProject(id);
  };

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (!user) return <Login onUser={setUser} />;
  if (project) return <Editor key={project} id={project} me={user.username} onBack={() => open(null)} />;
  return <Projects user={user} onOpen={open} onSignOut={() => void api.logout().then(() => setUser(null))} />;
}
