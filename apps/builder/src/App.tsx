import { Component, useEffect, useState, type ReactNode } from "react";
import { api, type User } from "./api";
import { Editor } from "./Editor";
import { Login } from "./Login";
import { Projects } from "./Projects";

/** A broken render says so, and offers a way out, instead of leaving an empty dark page. */
class Boundary extends Component<{ onBack: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading">
        <p className="error">This project couldn't be shown: {this.state.error.message}</p>
        <button onClick={this.props.onBack}>Back to projects</button>
      </div>
    );
  }
}

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
  if (project) return <Boundary key={project} onBack={() => open(null)}><Editor id={project} me={user.username} onBack={() => open(null)} /></Boundary>;
  return <Projects user={user} onOpen={open} onSignOut={() => void api.logout().then(() => setUser(null))} />;
}
