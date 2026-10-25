
import React, { useEffect, useState } from "react";
import "./App.css";
import Dashboard from "./Dashboard";

const API = "http://localhost:5000/api";

const EMPTY_FORM = {
  companyName: "",
  adminName: "",
  email: "",
  password: "",
};

export default function App() {
  const [page, setPage] = useState("loading");
  const [token, setToken] = useState(
    () => sessionStorage.getItem("hcm_token") || ""
  );
  const [user, setUser] = useState(
    () => {
      try {
        return JSON.parse(sessionStorage.getItem("hcm_user") || "null");
      } catch {
        return null;
      }
    }
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  async function request(path, options = {}) {
    const { auth = false, headers = {}, ...fetchOptions } = options;

    const activeToken = sessionStorage.getItem("hcm_token") || token;

    const response = await fetch(`${API}${path}`, {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        ...headers,
        ...(auth && activeToken
          ? { Authorization: `Bearer ${activeToken}` }
          : {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    return data;
  }

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const status = await request("/setup/status");

        if (cancelled) return;

        const setupComplete = Boolean(status.setupComplete);

        if (token) {
          try {
            const result = await request("/me", { auth: true });

            if (cancelled) return;

            const restoredUser = result.user || result;

            setUser(restoredUser);
            sessionStorage.setItem(
              "hcm_user",
              JSON.stringify(restoredUser)
            );
            setPage("dashboard");
            return;
          } catch {
            sessionStorage.removeItem("hcm_token");
            sessionStorage.removeItem("hcm_user");

            if (!cancelled) {
              setToken("");
              setUser(null);
            }
          }
        }

        if (!cancelled) {
          setPage(setupComplete ? "login" : "setup");
        }
      } catch {
        if (!cancelled) {
          setError(
            "Backend se connection nahi ho raha. Check karo ke server port 5000 par chal raha hai."
          );
          setPage("error");
        }
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  function updateForm(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (busy) return;

    setBusy(true);

    try {
      const result =
        page === "setup"
          ? await request("/setup", {
              method: "POST",
              body: JSON.stringify(form),
            })
          : await request("/auth/login", {
              method: "POST",
              body: JSON.stringify({
                email: form.email.trim(),
                password: form.password,
              }),
            });

      if (!result.token || !result.user) {
        throw new Error(
          "Server ka response expected format mein nahi hai. Backend response check karna hoga."
        );
      }

      sessionStorage.setItem("hcm_token", result.token);
      sessionStorage.setItem("hcm_user", JSON.stringify(result.user));

      setToken(result.token);
      setUser(result.user);
      setForm(EMPTY_FORM);
      setPage("dashboard");
    } catch (err) {
      setError(err.message || "Kuch ghalat ho gaya. Dobara try karo.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("hcm_token");
    sessionStorage.removeItem("hcm_user");

    setToken("");
    setUser(null);
    setForm(EMPTY_FORM);
    setError("");
    setPage("login");
  }

  if (page === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">H</div>
            <div>
              <h1>HCM Lite</h1>
              <p>Human Capital Management</p>
            </div>
          </div>
          <p>Workspace load ho raha hai...</p>
        </div>
      </div>
    );
  }

  if (page === "error") {
    return (
      <div className="auth-screen">
        <section className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">H</div>
            <div>
              <h1>HCM Lite</h1>
              <p>Human Capital Management</p>
            </div>
          </div>

          <h2>Connection error</h2>
          <p>{error}</p>

          <button
            className="auth-submit"
            type="button"
            onClick={() => window.location.reload()}
          >
            Retry connection
          </button>
        </section>
      </div>
    );
  }

  if (page === "dashboard" && user) {
    return (
      <div className="app-root">
        <div className="session-bar">
          <div>
            <strong>{user.name || user.email || "HCM User"}</strong>
            <span>{user.role || "Employee"}</span>
          </div>

          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>

        <Dashboard />
      </div>
    );
  }

  const isSetup = page === "setup";

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">H</div>
          <div>
            <h1>HCM Lite</h1>
            <p>Human Capital Management</p>
          </div>
        </div>

        <div className="auth-heading">
          <span className="auth-eyebrow">
            {isSetup ? "GET STARTED" : "WELCOME BACK"}
          </span>

          <h2>
            {isSetup
              ? "Set up your company"
              : "Sign in to your account"}
          </h2>

          <p>
            {isSetup
              ? "Create your company workspace and first administrator account."
              : "Enter your registered email and password to continue."}
          </p>
        </div>

        <form onSubmit={submit}>
          {isSetup && (
            <>
              <label htmlFor="companyName">Company name</label>
              <input
                id="companyName"
                name="companyName"
                value={form.companyName}
                onChange={updateForm}
                placeholder="Nexora HR Solutions"
                autoComplete="organization"
                required
              />

              <label htmlFor="adminName">Admin full name</label>
              <input
                id="adminName"
                name="adminName"
                value={form.adminName}
                onChange={updateForm}
                placeholder="Your full name"
                autoComplete="name"
                required
              />
            </>
          )}

          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={updateForm}
            placeholder="you@company.com"
            autoComplete="username"
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={updateForm}
            placeholder="Enter your password"
            autoComplete={isSetup ? "new-password" : "current-password"}
            minLength={isSetup ? 10 : undefined}
            required
          />

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Please wait..."
              : isSetup
                ? "Create company & Admin"
                : "Sign in"}
          </button>
        </form>

        <div className="auth-footer">
          {isSetup
            ? "Your first account will have Admin access."
            : "Access is available to accounts created by your company administrator."}
        </div>
      </section>
    </main>
  );
}
