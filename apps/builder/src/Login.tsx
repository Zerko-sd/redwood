import { useState } from "react";
import { api, type User } from "./api";

export function Login({ onUser }: { onUser: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    try {
      onUser(await (mode === "login" ? api.login : api.signup)(username.trim(), password));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page narrow centre">
      <h1>Redwood</h1>
      <p className="muted">Write stories and a spec. Redwood builds the app.</p>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label>Username<input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={!username.trim() || !password}>{mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <button className="ghost" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}>
        {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </div>
  );
}
