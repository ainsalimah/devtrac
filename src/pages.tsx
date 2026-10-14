import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Clock,
  FolderKanban,
  Plus,
  Users,
  Activity,
  Search,
  Settings2,
  Copy,
  Link2,
} from "lucide-react";
import { api } from "./api";
import { Avatar, ErrorBox, prettyDate, timeAgo, useWorkspace } from "./context";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import type { Person, ProjectDTO, TaskDTO } from "../shared/contracts";
import { statusLabels } from "../shared/contracts";
import { TaskDialog } from "./tasks";
import { projectProgress } from "./progress";

export function Overview() {
  const { auth, projects } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<TaskDTO[]>("/tasks"),
  });
  const activity = useQuery({
    queryKey: ["activities"],
    queryFn: () =>
      api<
        {
          id: string;
          text: string;
          createdAt: string;
          user: Person;
          project: { name: string; key: string };
          task: null | { title: string; number: number };
        }[]
      >("/activities"),
  });
  const all = tasks.data || [],
    active = all.filter((t) => t.status !== "DONE"),
    review = all.filter((t) => t.status === "REVIEW"),
    overdue = active.filter(
      (t) => t.dueDate && new Date(t.dueDate) < new Date(),
    );
  const focus = active
    .filter(
      (t) =>
        t.assigneeId === auth.user.id ||
        (t.status === "REVIEW" && t.reviewerId === auth.user.id),
    )
    .slice(0, 5);
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">WORKSPACE OVERVIEW</span>
          <h1>A clear view of what’s next.</h1>
          <p>
            Welcome back, {auth.user.name.split(" ")[0]}. Let’s keep things
            moving.
          </p>
        </div>
        <span className="date-label">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
      <ErrorBox error={tasks.error} />
      <div className="stats-grid">
        {[
          [FolderKanban, "Active tasks", active.length, "Across your projects"],
          [
            Clock,
            "In review",
            review.length,
            "Ready for a second pair of eyes",
          ],
          [Activity, "Overdue", overdue.length, "Could use a little attention"],
          [
            CheckCheck,
            "Completed",
            all.length - active.length,
            "Reviewed and ready to ship",
          ],
        ].map(([Icon, label, count, note], i) => {
          const I = Icon as typeof Clock;
          return (
            <div className="stat" key={String(label)}>
              <div>
                <span>{String(label)}</span>
                <I size={17} className={i === 1 ? "indigo" : ""} />
              </div>
              <strong>{tasks.isPending ? "—" : String(count)}</strong>
              <small>{String(note)}</small>
            </div>
          );
        })}
      </div>
      <div className="overview-grid">
        <section>
          <div className="section-title">
            <h2>
              Your projects <span className="count">{projects.length}</span>
            </h2>
            <Link to="/projects">
              View all <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="project-list">
            {projects.length ? (
              projects.map((p) => {
                const pt = all.filter((t) => t.projectId === p.id),
                  progress = projectProgress(pt);
                return (
                  <Link
                    to={`/projects/${p.id}`}
                    key={p.id}
                    className="project-summary"
                  >
                    <div className="project-symbol">
                      <FolderKanban size={20} />
                    </div>
                    <div className="project-summary-main">
                      <strong>{p.name}</strong>
                      <p>{p.description || "Your team’s next project."}</p>
                      <div className="progress-track">
                        <span
                          style={{
                            width: `${progress.percent}%`,
                          }}
                        />
                      </div>
                      <small>
                        {progress.DONE} of {progress.total} tasks complete ·{" "}
                        {progress.REVIEW} in review · {progress.overdue} overdue
                      </small>
                    </div>
                    <ArrowUpRight size={17} />
                  </Link>
                );
              })
            ) : (
              <div className="empty-state">
                Your projects will appear here once you are added to a team.
              </div>
            )}
          </div>
          <div className="section-title section-spaced">
            <h2>Your focus</h2>
            <Link to="/my-tasks">
              My tasks <ArrowRight size={15} />
            </Link>
          </div>
          {tasks.isPending ? (
            <div className="empty-state">Loading your tasks…</div>
          ) : focus.length ? (
            <div className="focus-list">
              {focus.map((t) => (
                <button key={t.id} onClick={() => setSelected(t.id)}>
                  <span
                    className={`status-dot ${t.status.toLowerCase().replace("_", "-")}`}
                  />
                  <span>
                    <small>
                      {t.project.key}-{t.number}
                    </small>
                    <strong>{t.title}</strong>
                  </span>
                  <span className="muted">{prettyDate(t.dueDate)}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <CheckCheck size={23} />
              <strong>You’re all caught up</strong>
              <p>Assigned tasks and review requests will appear here.</p>
            </div>
          )}
        </section>
        <section className="activity-panel">
          <div className="section-title">
            <h2>Team activity</h2>
            <span className="live-label">
              <span className="status-dot done" />
              Live
            </span>
          </div>
          <ErrorBox error={activity.error} />
          {activity.data?.length ? (
            activity.data.slice(0, 8).map((a) => (
              <div className="activity-item" key={a.id}>
                <Avatar name={a.user.name} small />
                <div>
                  <p>
                    <strong>{a.user.name}</strong> {a.text}
                  </p>
                  <small>
                    {a.task
                      ? `${a.project.key}-${a.task.number} · ${a.task.title}`
                      : a.project.name}
                  </small>
                  <time>{timeAgo(a.createdAt)}</time>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Activity appears as your team works.</p>
          )}
          <div className="activity-footnote">
            A shared story of your team’s progress.
          </div>
        </section>
      </div>
      {selected && <TaskDialog id={selected} close={() => setSelected(null)} />}
    </main>
  );
}

export function Projects() {
  const { auth, projects, users, notify } = useWorkspace();
  const client = useQueryClient();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/projects", { method: "POST", body: Object.fromEntries(f) });
      await client.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      notify("Project created. Add your team to get started.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">PLAN. BUILD. SHIP.</span>
          <h1>Projects</h1>
          <p>A shared space for each thing your team is building.</p>
        </div>
        {auth.user.isAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} />
            New project
          </Button>
        )}
      </div>
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">{projects.length} projects</span>
      </div>
      <div className="projects-grid">
        {projects
          .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
          .map((p) => (
            <Link className="project-card" key={p.id} to={`/projects/${p.id}`}>
              <header>
                <span className="project-symbol">
                  <FolderKanban size={22} />
                </span>
                <span className="subtle-pill">
                  {p.archived ? "Archived" : "Active"}
                </span>
              </header>
              <h2>{p.name}</h2>
              <p>{p.description || "No description yet."}</p>
              <footer>
                <span>
                  <span className="project-key">{p.key}</span> {p._count.tasks}{" "}
                  tasks
                </span>
                <span className="avatar-stack">
                  {p.members.slice(0, 4).map((m) => (
                    <Avatar key={m.userId} name={m.user.name} small />
                  ))}
                </span>
              </footer>
            </Link>
          ))}
      </div>
      {!projects.length && (
        <div className="empty-state">
          <FolderKanban />
          <h2>No projects yet</h2>
          <p>
            {auth.user.isAdmin
              ? "Create a project to get your team started."
              : "Your admin will add you to a project."}
          </p>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Create a project"
        description="Give your team a shared goal and a place to work."
      >
        <form onSubmit={create} className="form-stack">
          <label>
            Project name
            <input
              name="name"
              placeholder="Customer portal"
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label>
            Project key
            <input
              name="key"
              placeholder="PORTAL"
              pattern="[A-Z]{2,6}"
              title="2–6 uppercase letters"
              required
            />
          </label>
          <label>
            Description
            <textarea name="description" rows={3} maxLength={2000} />
          </label>
          <label>
            Project manager
            <select name="managerId" required>
              <option value="">Select a manager</option>
              {users
                .filter((u) => u.active)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <ErrorBox error={error} />
          <Button disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </form>
      </Dialog>
    </main>
  );
}

export function ProjectSettings({
  project,
  close,
}: {
  project: ProjectDTO;
  close: () => void;
}) {
  const { users, notify } = useWorkspace(),
    client = useQueryClient();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(url: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(url, { method, body });
      await client.invalidateQueries({ queryKey: ["projects"] });
      notify("Project updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={close}
      title="Project settings"
      description="Manage the project and the people working on it."
    >
      <div className="form-stack">
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(`/projects/${project.id}`, "PATCH", {
              name: f.get("name"),
              description: f.get("description"),
              archived: f.get("archived") === "on",
            });
          }}
        >
          <label>
            Name
            <input
              name="name"
              defaultValue={project.name}
              required
              minLength={2}
            />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={project.description} />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={project.archived}
            />
            Archive project (make tasks read-only)
          </label>
          <Button variant="outline" disabled={busy}>
            Save settings
          </Button>
        </form>
        <h3>Project members</h3>
        <div className="member-settings">
          {project.members.map((m) => (
            <div key={m.userId}>
              <Avatar name={m.user.name} small />
              <span>
                {m.user.name}
                <small>
                  {m.user.jobTitle ? `${m.user.jobTitle} · ` : ""}
                  {m.isManager ? "Project manager" : "Member"}
                </small>
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(`/projects/${project.id}/members`, "POST", {
                    userId: m.userId,
                    isManager: !m.isManager,
                  })
                }
              >
                {m.isManager ? "Make member" : "Make manager"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    `/projects/${project.id}/members/${m.userId}`,
                    "DELETE",
                    {},
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(`/projects/${project.id}/members`, "POST", {
              userId: f.get("userId"),
              isManager: false,
            });
          }}
        >
          <select name="userId" aria-label="Add project member" required>
            <option value="">Select a team member</option>
            {users
              .filter(
                (u) =>
                  u.active && !project.members.some((m) => m.userId === u.id),
              )
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
          <Button disabled={busy}>
            <Plus size={15} />
            Add
          </Button>
        </form>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}

type Invitation = {
  id: string;
  email: string;
  jobTitle: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};
export function Members() {
  const { auth, users, notify } = useWorkspace(),
    client = useQueryClient();
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Person | null>(null),
    [url, setUrl] = useState(""),
    [sentEmail, setSentEmail] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const invitations = useQuery({
    queryKey: ["invitations"],
    queryFn: () => api<Invitation[]>("/invitations"),
    enabled: auth.user.isAdmin,
  });
  async function run(path: string, method: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      const result = await api<{ url?: string; delivery?: "sent" | "manual" }>(
        path,
        { method, body },
      );
      if (result.url) setUrl(result.url);
      if (path === "/invitations" && result.delivery === "sent")
        setSentEmail((body as { email: string }).email);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["users"] }),
        client.invalidateQueries({ queryKey: ["invitations"] }),
      ]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">BETTER, TOGETHER</span>
          <h1>Members</h1>
          <p>The people behind the progress.</p>
        </div>
        {auth.user.isAdmin && (
          <Button
            onClick={() => {
              setOpen(true);
              setUrl("");
              setSentEmail("");
              setError("");
            }}
          >
            <Plus size={16} />
            Invite member
          </Button>
        )}
      </div>
      <ErrorBox error={!open ? error : null} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Job title</th>
              <th>Workspace role</th>
              <th>Status</th>
              {auth.user.isAdmin && (
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="person-cell">
                    <Avatar name={u.name} />
                    <strong>{u.name}</strong>
                  </span>
                </td>
                <td>{u.email}</td>
                <td>{u.jobTitle || "—"}</td>
                <td>{u.isAdmin ? "Admin" : "Member"}</td>
                <td>
                  <span className={`badge ${u.active ? "badge-green" : ""}`}>
                    {u.active ? "Active" : "Inactive"}
                  </span>
                </td>
                {auth.user.isAdmin && (
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setEditing(u);
                        setError("");
                      }}
                    >
                      Edit title
                    </Button>
                    {u.id !== auth.user.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(`/users/${u.id}`, "PATCH", { active: !u.active })
                        }
                      >
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {auth.user.isAdmin && (
        <section className="section-spaced">
          <div className="section-title">
            <h2>Invitations</h2>
            <span className="muted">Links expire after 48 hours</span>
          </div>
          <ErrorBox error={invitations.error} />
          {invitations.data?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Job title</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.data.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{i.jobTitle || "—"}</td>
                      <td>
                        {i.usedAt
                          ? "Accepted"
                          : i.revokedAt
                            ? "Revoked"
                            : new Date(i.expiresAt) < new Date()
                              ? "Expired"
                              : "Pending"}
                      </td>
                      <td>{prettyDate(i.expiresAt)}</td>
                      <td>
                        {!i.usedAt && !i.revokedAt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(`/invitations/${i.id}`, "DELETE", {})
                            }
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact">
              <Users size={22} />
              <p>No invitations yet. Invite someone to join your workspace.</p>
            </div>
          )}
        </section>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Invite a teammate"
        description="Invite a teammate to your workspace with a link that expires in 48 hours."
      >
        {sentEmail ? (
          <div className="form-stack">
            <div className="success-box" role="status">
              Invitation email sent to {sentEmail}. The link expires in 48
              hours.
            </div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : url ? (
          <div className="form-stack">
            <div className="success-box" role="status">
              <Link2 size={17} />
              Email delivery is not configured. Copy and share this one-time
              link.
            </div>
            <label>
              Invitation link
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  notify("Invitation link copied.");
                } catch {
                  notify("Select and copy the link manually.");
                }
              }}
            >
              <Copy size={16} />
              Copy link
            </Button>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void run("/invitations", "POST", {
                email: form.get("email"),
                jobTitle: form.get("jobTitle"),
              });
            }}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                required
                placeholder="teammate@company.com"
              />
            </label>
            <label>
              Job title (optional)
              <input
                name="jobTitle"
                maxLength={80}
                placeholder="e.g. UI Designer"
              />
            </label>
            <ErrorBox error={error} />
            <Button disabled={busy}>
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </form>
        )}
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        title="Edit job title"
        description={
          editing ? `Set ${editing.name}'s position in the team.` : ""
        }
      >
        {editing && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get("jobTitle");
              void run(`/users/${editing.id}/job-title`, "PATCH", {
                jobTitle: value,
              }).then((ok) => {
                if (ok) setEditing(null);
              });
            }}
          >
            <label>
              Job title
              <input
                name="jobTitle"
                defaultValue={editing.jobTitle}
                maxLength={80}
                placeholder="e.g. UI Designer"
              />
            </label>
            <ErrorBox error={error} />
            <Button disabled={busy}>Save title</Button>
          </form>
        )}
      </Dialog>
    </main>
  );
}
