import { useEffect, useState } from "react";
import {
  NavLink,
  Link,
  Route,
  Routes,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import {
  ArrowRight,
  Boxes,
  CheckCheck,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  X,
  WifiOff,
} from "lucide-react";
import { api, ApiError, setCsrf, type Auth } from "./api";
import type { Person, ProjectDTO } from "../shared/contracts";
import { WorkspaceContext, Avatar, ErrorBox } from "./context";
import { Button } from "./components/ui/button";
import { Overview, Projects, Members } from "./pages";
import { TaskWorkspace } from "./tasks";

function SignIn({ onSuccess }: { onSuccess: (auth: Auth) => void }) {
  const location = useLocation(),
    navigate = useNavigate();
  const accept = location.pathname === "/accept-invitation";
  const register = location.pathname === "/register";
  const [token] = useState(() => location.hash.slice(1));
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      if (accept) {
        await api("/auth/accept", {
          method: "POST",
          body: {
            token,
            name: data.get("name"),
            password: data.get("password"),
          },
        });
        setAccepted(true);
        navigate("/login", { replace: true });
      } else if (register) {
        onSuccess(
          await api<Auth>("/auth/register", {
            method: "POST",
            body: {
              companyName: data.get("companyName"),
              name: data.get("name"),
              email: data.get("email"),
              password: data.get("password"),
            },
          }),
        );
      } else
        onSuccess(
          await api<Auth>("/auth/login", {
            method: "POST",
            body: { email: data.get("email"), password: data.get("password") },
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Boxes size={21} />
          </span>
          DevTrack
        </div>
        <div>
          <span className="eyebrow">
            A LITTLE MORE CLARITY. A LOT MORE PROGRESS.
          </span>
          <h1>
            Good work.
            <br />
            Great teamwork.
          </h1>
          <p>
            One place to plan, build, and review.
            <br />
            Bring your next idea over the finish line.
          </p>
          <div className="story-board">
            <div>
              <span className="status-dot in-progress" /> In progress{" "}
              <span>03</span>
            </div>
            <article>
              <small>WEB-03</small>
              <strong>Create the component library</strong>
              <footer>
                <span className="mini-tag">Design system</span>
                <span className="avatar avatar-small">JP</span>
              </footer>
            </article>
            <div className="story-approved">
              <CheckCheck size={18} /> Reviewed. Ready to ship.
            </div>
          </div>
        </div>
        <small>Built for teams that care about the details.</small>
      </section>
      <section className="login-form">
        <div className="login-form-inner">
          <span className="eyebrow">YOUR TEAM'S WORKSPACE</span>
          <h2>
            {accept
              ? "Join your team"
              : register
                ? "Create your workspace"
                : "Welcome back"}
          </h2>
          <p className="muted">
            {accept
              ? "Create your account to start collaborating."
              : register
                ? "Set up a company space for your team. You’ll be its admin."
                : "Sign in to pick up where you left off."}
          </p>
          {accepted && (
            <div className="success-box">
              Account created. You can sign in now.
            </div>
          )}
          <form onSubmit={submit}>
            {register && (
              <label>
                Company name
                <input
                  name="companyName"
                  autoComplete="organization"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="Acme Studio"
                />
              </label>
            )}
            {(accept || register) && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
            )}
            {!accept && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  required
                />
              </label>
            )}
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  accept || register ? "new-password" : "current-password"
                }
                required
                minLength={accept || register ? 12 : 1}
                maxLength={128}
              />
            </label>
            {(accept || register) && (
              <small className="muted">Use at least 12 characters.</small>
            )}
            <ErrorBox error={error} />
            <Button disabled={busy} className="full-width">
              {busy
                ? "Please wait…"
                : accept
                  ? "Create account"
                  : register
                    ? "Create workspace"
                    : "Sign in"}
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="login-note">
            {accept ? (
              "Invitation links can only be used once."
            ) : register ? (
              <>
                <Link to="/login">Already have an account? Sign in.</Link> Team
                members join through an invitation.
              </>
            ) : (
              <>
                <Link to="/register">New company? Create a workspace.</Link>{" "}
                Team members need an invitation from their admin.
              </>
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
export default function App() {
  const client = useQueryClient(),
    navigate = useNavigate();
  const [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [online, setOnline] = useState(false);
  const authQuery = useQuery({
    queryKey: ["auth"],
    queryFn: async () => {
      const value = await api<Auth>("/auth/me");
      setCsrf(value.csrfToken);
      return value;
    },
    retry: false,
  });
  const auth =
    authQuery.error instanceof ApiError && authQuery.error.status === 401
      ? undefined
      : authQuery.data;
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<ProjectDTO[]>("/projects"),
    enabled: !!auth,
  });
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => api<Person[]>("/users"),
    enabled: !!auth,
  });
  const projects = projectsQuery.data || [],
    users = usersQuery.data || [];
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!auth) return;
    const socket = io({ auth: { csrfToken: auth.csrfToken } });
    const refresh = () => {
      for (const key of ["projects", "users", "tasks", "task", "activities"])
        void client.invalidateQueries({ queryKey: [key] });
    };
    socket.on("connect", () => {
      setOnline(true);
      projects.forEach((p) => socket.emit("project:join", p.id));
      refresh();
    });
    socket.on("disconnect", (reason) => {
      setOnline(false);
      if (reason === "io server disconnect")
        void client.invalidateQueries({ queryKey: ["auth"] });
    });
    socket.on("connect_error", () => {
      setOnline(false);
      void client.invalidateQueries({ queryKey: ["auth"] });
    });
    socket.on("project:changed", refresh);
    socket.on("access:changed", refresh);
    return () => {
      socket.disconnect();
    };
  }, [
    auth?.user.id,
    auth?.csrfToken,
    projects.map((p) => p.id).join(","),
    client,
  ]);
  if (authQuery.isPending)
    return <div className="page-loading">Opening your workspace…</div>;
  if (!auth) {
    if (authQuery.error instanceof ApiError && authQuery.error.status !== 401)
      return (
        <main className="page-loading">
          <ErrorBox error={authQuery.error} />
          <Button onClick={() => authQuery.refetch()}>Try again</Button>
        </main>
      );
    return (
      <SignIn
        onSuccess={(value) => {
          setCsrf(value.csrfToken);
          client.clear();
          client.setQueryData(["auth"], value);
          navigate("/");
        }}
      />
    );
  }
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      setCsrf("");
      client.clear();
      navigate("/login");
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  return (
    <WorkspaceContext.Provider
      value={{ auth, projects, users, notify: setToast }}
    >
      <div className="app-shell">
        <a className="skip-link" href="#workspace-content">
          Skip to content
        </a>
        <button
          className="mobile-menu icon-button"
          aria-label="Open navigation"
          onClick={() => setMobile(true)}
        >
          <Menu size={20} />
        </button>
        {mobile && (
          <div className="mobile-scrim" onClick={() => setMobile(false)} />
        )}
        <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
          <div className="brand">
            <span className="brand-mark">
              <Boxes size={20} />
            </span>
            DevTrack
            <button
              className="mobile-close icon-button"
              aria-label="Close navigation"
              onClick={() => setMobile(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="workspace-picker">
            <span className="workspace-icon">
              {auth.workspace.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{auth.workspace.name}</strong>
              <small>Software team</small>
            </div>
            <ChevronDown size={14} />
          </div>
          <nav onClick={() => setMobile(false)}>
            <span className="nav-heading">WORKSPACE</span>
            <NavLink to="/" end>
              <LayoutDashboard size={17} />
              Overview
            </NavLink>
            <NavLink to="/my-tasks">
              <CheckCheck size={17} />
              My tasks
            </NavLink>
            <NavLink to="/projects" end>
              <FolderKanban size={17} />
              Projects<span className="nav-count">{projects.length}</span>
            </NavLink>
            <NavLink to="/members">
              <Users size={17} />
              Members
            </NavLink>
            <span className="nav-heading project-heading">YOUR PROJECTS</span>
            {projects
              .filter((p) => !p.archived)
              .map((p) => (
                <NavLink key={p.id} to={`/projects/${p.id}`}>
                  <span className="project-glyph">{p.key.slice(0, 1)}</span>
                  <span className="truncate">{p.name}</span>
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="workspace-tip">
              <span className="tip-icon">↗</span>
              <strong>Small steps. Shared progress.</strong>
              <p>Keep work moving with thoughtful reviews.</p>
            </div>
            <div className="connection-state">
              <span className={`status-dot ${online ? "done" : "todo"}`} />
              {online ? "Connected to workspace" : "Reconnecting…"}
            </div>
            <div className="profile">
              <Avatar name={auth.user.name} />
              <div>
                <strong>{auth.user.name}</strong>
                <small>
                  {auth.user.isAdmin ? "Workspace admin" : "Team member"}
                </small>
              </div>
            </div>
          </div>
        </aside>
        <div className="main-shell" id="workspace-content" tabIndex={-1}>
          <header className="topbar">
            <span>
              {auth.workspace.name} <span className="crumb-separator">/</span>{" "}
              <strong>Team projects</strong>
            </span>
            <span className="topbar-right">
              <span className="subtle-pill">Local workspace</span>
              <Avatar name={auth.user.name} small />
              <button className="signout-button" onClick={logout}>
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </button>
            </span>
          </header>
          {!online && (
            <div className="connection-banner">
              <WifiOff size={14} />
              Live updates are reconnecting. Changes still require a server
              response.
            </div>
          )}
          <ErrorBox error={projectsQuery.error || usersQuery.error} />
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectId" element={<TaskWorkspace />} />
            <Route path="/my-tasks" element={<TaskWorkspace mine />} />
            <Route path="/members" element={<Members />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {toast && (
          <div role="status" className="toast">
            {toast}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
