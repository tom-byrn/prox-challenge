import { type FormEvent, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import App from "./App";

type GateState = "checking" | "locked" | "open" | "unavailable";

interface SessionResponse {
  authenticated?: boolean;
  configured?: boolean;
}

export default function AccessGate() {
  const [state, setState] = useState<GateState>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const checkSession = async (signal?: AbortSignal) => {
    setState("checking");
    setError("");
    try {
      const response = await fetch("/api/auth/session", { signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("The server did not respond.");
      const session = await response.json() as SessionResponse;
      if (session.authenticated) setState("open");
      else if (session.configured === false) setState("unavailable");
      else setState("locked");
    } catch (sessionError) {
      if (sessionError instanceof DOMException && sessionError.name === "AbortError") return;
      setState("unavailable");
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void checkSession(controller.signal);
    return () => controller.abort();
  }, []);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Unable to unlock the site.");
        return;
      }
      setPassword("");
      setState("open");
    } catch {
      setError("The server could not be reached. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "open") return <App />;

  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-mark" aria-hidden="true">
          {state === "checking" ? <LoaderCircle className="spinning" size={22} /> : <LockKeyhole size={22} />}
        </div>
        <p className="access-eyebrow">Vulcan OmniPro 220</p>
        <h1 id="access-title">{state === "checking" ? "Checking access" : "Private workspace"}</h1>
        {state === "checking" ? (
          <p className="access-copy">Confirming this browser’s session…</p>
        ) : state === "unavailable" ? (
          <>
            <p className="access-copy">Access control is unavailable or has not been configured on the server.</p>
            <button className="access-retry" type="button" onClick={() => void checkSession()}>Try again</button>
          </>
        ) : (
          <>
            <p className="access-copy">Enter the site password to use the assistant and its tools.</p>
            <form className="access-form" onSubmit={submitPassword}>
              <label htmlFor="site-password">Site password</label>
              <div className="access-input-wrap">
                <KeyRound size={16} aria-hidden="true" />
                <input
                  id="site-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {error && <p className="access-error" role="alert">{error}</p>}
              <button className="access-submit" type="submit" disabled={!password || submitting}>
                {submitting ? <><LoaderCircle className="spinning" size={15} /> Checking…</> : "Enter site"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
