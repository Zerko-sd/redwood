import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MeProvider, session, type Me } from "./api";
import { Button, Notifications } from "./ui";
import { appTitle } from "../shared/model";
import { roles } from "../shared/policy";
import "./ui/theme.css";
import "./ui/kit.css";
import "../../custom/overrides.css";

function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [error, setError] = useState("");
  const attempt = (username: string, password: string) =>
    session.login(username, password).then(onSignedIn).catch((err: Error) => setError(err.message));
  return (
    <div className="rw-login-wrap">
    <main className="rw-login">
      <h1 className="rw-login-title">{appTitle}</h1>
      <p className="rw-lede">Sign in to continue.</p>
      <form
        className="rw-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void attempt(String(f.get("username")), String(f.get("password")));
        }}
      >
        <label className="rw-field">
          <span className="rw-label">Username</span>
          <input className="rw-input" name="username" autoComplete="username" autoFocus required />
        </label>
        <label className="rw-field">
          <span className="rw-label">Password</span>
          <input className="rw-input" name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="rw-error">{error}</p>}
        <div className="rw-form-actions">
          <Button variant="primary" type="submit">Sign in</Button>
        </div>
      </form>
      {import.meta.env.DEV && (
        // Development builds only: the preview seeds one demo user per role.
        <div className="rw-demo">
          <span className="rw-faint">Preview accounts. Each role signs in with the password “redwood”.</span>
          <div className="rw-row">
            {roles.map((r) => <Button key={r} onClick={() => void attempt(r, "redwood")}>{r}</Button>)}
          </div>
        </div>
      )}
    </main>
    </div>
  );
}

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    session.me().then(setMe).catch(() => setMe(null)).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  return (
    <>
      {me ? (
        <MeProvider me={me}>
          <App onSignOut={async () => { await session.logout(); setMe(null); }} />
        </MeProvider>
      ) : (
        <SignIn onSignedIn={setMe} />
      )}
      <Notifications />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
