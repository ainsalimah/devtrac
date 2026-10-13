import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowUpRight,
  Bug,
  Calendar,
  Check,
  CheckCheck,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Send,
  ExternalLink,
  Clock,
} from "lucide-react";
import { api } from "./api";
import { Avatar, ErrorBox, prettyDate, timeAgo, useWorkspace } from "./context";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { ProjectSettings } from "./pages";
import {
  statuses,
  statusLabels,
  type ProjectDTO,
  type TaskDTO,
  type TaskDetail,
} from "../shared/contracts";

const statusClass = (s: string) => s.toLowerCase().replaceAll("_", "-");
export function Status({ status }: { status: TaskDTO["status"] }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <span className={`status-dot ${statusClass(status)}`} />
      {statusLabels[status]}
    </span>
  );
}
function Priority({ priority }: { priority: string }) {
  return (
    <span className={`priority priority-${priority.toLowerCase()}`}>
      <span>
        {priority === "HIGH" ? "▰" : priority === "MEDIUM" ? "▰" : "▱"}
      </span>
      {priority[0] + priority.slice(1).toLowerCase()}
    </span>
  );
}
function Card({
  task,
  onOpen,
  disabled,
}: {
  task: TaskDTO;
  onOpen: () => void;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled });
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="task-card"
      data-testid={`card-${task.id}`}
    >
      <header>
        <span className="task-code">
          {task.type === "BUG" ? (
            <Bug size={13} />
          ) : (
            <span className="task-type-icon" />
          )}
          {task.project.key}-{task.number}
        </span>
        {!disabled && (
          <button
            {...attributes}
            {...listeners}
            className="drag-handle"
            aria-label={`Drag ${task.title}`}
          >
            <GripVertical size={14} />
          </button>
        )}
      </header>
      <button className="card-title" onClick={onOpen}>
        {task.title}
      </button>
      <div className="card-meta">
        <Priority priority={task.priority} />
        {task.type === "BUG" && <span className="badge badge-red">Bug</span>}
      </div>
      <footer>
        <span
          className={
            task.dueDate &&
            new Date(task.dueDate) < new Date() &&
            task.status !== "DONE"
              ? "overdue"
              : ""
          }
        >
          <Calendar size={12} />
          {prettyDate(task.dueDate)}
        </span>
        <div>
          {task._count.comments > 0 && (
            <span>
              <MessageSquare size={12} />
              {task._count.comments}
            </span>
          )}
          {task.checklist.length > 0 && (
            <span>
              <CheckCheck size={13} />
              {task.checklist.filter((c) => c.done).length}/
              {task.checklist.length}
            </span>
          )}
          <Avatar name={task.assignee.name} small />
        </div>
      </footer>
    </article>
  );
}
function Column({
  status,
  children,
  count,
  onAdd,
}: {
  status: TaskDTO["status"];
  children: ReactNode;
  count: number;
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? "drag-over" : ""}`}
    >
      <header>
        <span className={`status-dot ${statusClass(status)}`} />
        <h2>{statusLabels[status]}</h2>
        <span className="count">{count}</span>
        {onAdd && (
          <button
            className="icon-button"
            aria-label={`Add task in ${statusLabels[status]}`}
            onClick={onAdd}
          >
            <Plus size={16} />
          </button>
        )}
      </header>
      <div className="column-cards">
        {children}
        {count === 0 && <div className="empty-column">No tasks here yet</div>}
      </div>
      {onAdd && (
        <button className="add-card" onClick={onAdd}>
          <Plus size={14} />
          Add task
        </button>
      )}
    </section>
  );
}

export function TaskWorkspace({ mine = false }: { mine?: boolean }) {
  const { projectId } = useParams();
  const { auth, projects, notify } = useWorkspace(),
    client = useQueryClient();
  const project = projects.find((p) => p.id === projectId),
    manager =
      !!project &&
      (auth.user.isAdmin ||
        project.members.some((m) => m.userId === auth.user.id && m.isManager));
  const [view, setView] = useState<"board" | "list">("board"),
    [search, setSearch] = useState(""),
    [priority, setPriority] = useState(""),
    [person, setPerson] = useState(""),
    [mineTab, setMineTab] = useState("assigned"),
    [selected, setSelected] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [settings, setSettings] = useState(false),
    [filters, setFilters] = useState(false);
  const key = ["tasks", mine ? "all" : projectId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api<TaskDTO[]>(`/tasks${mine ? "" : `?projectId=${projectId}`}`),
  });
  const all = query.data || [];
  const visible = all.filter(
    (t) =>
      (!mine ||
        (mineTab === "assigned"
          ? t.assigneeId === auth.user.id
          : t.reviewerId === auth.user.id && t.status === "REVIEW")) &&
      (!priority || t.priority === priority) &&
      (!person || t.assigneeId === person) &&
      `${t.title} ${t.project.key}-${t.number}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const move = useMutation({
    mutationFn: ({
      task,
      status,
      position,
    }: {
      task: TaskDTO;
      status: string;
      position: number;
    }) =>
      api(`/tasks/${task.id}/move`, {
        method: "POST",
        body: { version: task.version, status, position },
      }),
    onMutate: async ({ task, status, position }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<TaskDTO[]>(key);
      client.setQueryData<TaskDTO[]>(key, (old) =>
        old?.map((t) =>
          t.id === task.id
            ? { ...t, status: status as TaskDTO["status"], position }
            : t,
        ),
      );
      return { previous };
    },
    onError: (e, _v, context) => {
      client.setQueryData(key, context?.previous);
      notify(e.message);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["activities"] });
    },
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const task = all.find((t) => t.id === active.id);
    if (!task) return;
    const target = all.find((t) => t.id === over.id),
      status = target?.status || String(over.id);
    if (status !== "TODO" && status !== "IN_PROGRESS") {
      notify("Open the task to submit work or complete its review.");
      return;
    }
    const column = all
      .filter((t) => t.status === status && t.id !== task.id)
      .sort((a, b) => a.position - b.position);
    const i = target ? column.findIndex((t) => t.id === target.id) : -1;
    const position =
      i >= 0
        ? ((column[i - 1]?.position || 0) + column[i].position) / 2
        : (column.at(-1)?.position || 0) + 1024;
    move.mutate({ task, status, position });
  }
  if (query.isPending)
    return (
      <main className="page">
        <div className="page-loading">Loading tasks…</div>
      </main>
    );
  if (query.error)
    return (
      <main className="page">
        <ErrorBox error={query.error} />
        <Button variant="outline" onClick={() => query.refetch()}>
          Try again
        </Button>
      </main>
    );
  return (
    <main className="page tasks-page">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {mine
              ? "YOUR PERSONAL WORKSPACE"
              : `${project?.key || "PROJECT"} / PROJECT WORKSPACE`}
          </span>
          <h1>{mine ? "My tasks" : project?.name || "Project"}</h1>
          <p>
            {mine
              ? "Your next steps, and the work waiting for your review."
              : project?.description}
          </p>
        </div>
        <div className="title-actions">
          {!mine && (
            <div className="avatar-stack">
              {project?.members.slice(0, 4).map((m) => (
                <Avatar key={m.userId} name={m.user.name} small />
              ))}
            </div>
          )}
          {manager && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Project settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={17} />
            </Button>
          )}
          {manager && !project?.archived && (
            <Button onClick={() => setCreate(true)}>
              <Plus size={16} />
              New task
            </Button>
          )}
        </div>
      </div>
      {project?.archived && (
        <div className="notice">
          This project is archived. Restore it in settings to make changes.
        </div>
      )}
      <div className="view-bar">
        <div className="segmented">
          {mine ? (
            <>
              <button
                className={mineTab === "assigned" ? "active" : ""}
                onClick={() => setMineTab("assigned")}
              >
                Assigned to me
              </button>
              <button
                className={mineTab === "reviews" ? "active" : ""}
                onClick={() => setMineTab("reviews")}
              >
                Needs my review{" "}
                <span className="count">
                  {
                    all.filter(
                      (t) =>
                        t.status === "REVIEW" && t.reviewerId === auth.user.id,
                    ).length
                  }
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                className={view === "board" ? "active" : ""}
                onClick={() => setView("board")}
              >
                <LayoutGrid size={15} />
                Board
              </button>
              <button
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
              >
                <List size={15} />
                List
              </button>
            </>
          )}
        </div>
        <span className="muted">{visible.length} tasks</span>
      </div>
      <div className="toolbar">
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFilters(!filters)}
          aria-expanded={filters}
        >
          <SlidersHorizontal size={14} />
          Filters{(priority || person) && <span className="filter-dot" />}
        </Button>
      </div>
      {filters && (
        <div className="filter-bar">
          <label>
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="">All priorities</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </label>
          {!mine && (
            <label>
              Assignee
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">All members</option>
                {project?.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setPriority("");
              setPerson("");
              setSearch("");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}
      {view === "list" || mine ? (
        <div className="table-wrap">
          <table className="task-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Due date</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id}>
                  <td>
                    <button
                      className="table-task-title"
                      onClick={() => setSelected(t.id)}
                    >
                      <small>
                        {t.project.key}-{t.number}
                      </small>
                      {t.title}
                    </button>
                  </td>
                  <td>
                    <Status status={t.status} />
                  </td>
                  <td>
                    <Priority priority={t.priority} />
                  </td>
                  <td>
                    <span className="person-cell">
                      <Avatar name={t.assignee.name} small />
                      {t.assignee.name}
                    </span>
                  </td>
                  <td>{prettyDate(t.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="empty-state compact">
              <CheckCheck />
              <strong>No tasks to show</strong>
              <p>
                Try changing your filters or check back when work is assigned.
              </p>
            </div>
          )}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="board">
            {statuses.map((status) => {
              const column = visible
                .filter((t) => t.status === status)
                .sort((a, b) => a.position - b.position);
              return (
                <Column
                  key={status}
                  status={status}
                  count={column.length}
                  onAdd={
                    status === "TODO" && manager && !project?.archived
                      ? () => setCreate(true)
                      : undefined
                  }
                >
                  <SortableContext items={column.map((t) => t.id)}>
                    {column.map((t) => (
                      <Card
                        key={t.id}
                        task={t}
                        disabled={
                          move.isPending ||
                          !!project?.archived ||
                          !["TODO", "IN_PROGRESS"].includes(t.status) ||
                          (!manager && t.assigneeId !== auth.user.id)
                        }
                        onOpen={() => setSelected(t.id)}
                      />
                    ))}
                  </SortableContext>
                </Column>
              );
            })}
          </div>
        </DndContext>
      )}
      {selected && <TaskDialog id={selected} close={() => setSelected(null)} />}
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title="Create a task"
        description="Make the next step clear. Assign an owner and a separate reviewer."
      >
        {project && (
          <TaskForm project={project} onSaved={() => setCreate(false)} />
        )}
      </Dialog>
      {settings && project && (
        <ProjectSettings project={project} close={() => setSettings(false)} />
      )}
    </main>
  );
}

function TaskForm({
  project,
  task,
  onSaved,
}: {
  project: ProjectDTO;
  task?: TaskDetail;
  onSaved: () => void;
}) {
  const { auth } = useWorkspace(),
    client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const manager =
    auth.user.isAdmin ||
    project.members.some((m) => m.userId === auth.user.id && m.isManager);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const data = {
      ...Object.fromEntries(f),
      assigneeId: manager ? f.get("assigneeId") : task?.assigneeId,
      reviewerId: manager ? f.get("reviewerId") : task?.reviewerId,
      dueDate: f.get("dueDate")
        ? new Date(`${f.get("dueDate")}T23:59:59`).toISOString()
        : null,
      ...(task ? { version: task.version } : {}),
    };
    try {
      await api(
        task ? `/tasks/${task.id}/edit` : `/projects/${project.id}/tasks`,
        { method: "POST", body: data },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["tasks"] }),
        client.invalidateQueries({ queryKey: ["task"] }),
        client.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        Title
        <input
          name="title"
          placeholder="What needs to be done?"
          defaultValue={task?.title}
          required
          minLength={3}
          maxLength={160}
        />
      </label>
      <label>
        Description
        <textarea
          name="description"
          placeholder="Add context and acceptance criteria…"
          defaultValue={task?.description}
          rows={4}
          maxLength={10000}
        />
      </label>
      <div className="form-grid">
        <label>
          Type
          <select name="type" defaultValue={task?.type || "TASK"}>
            <option value="TASK">Task</option>
            <option value="BUG">Bug</option>
          </select>
        </label>
        <label>
          Priority
          <select name="priority" defaultValue={task?.priority || "MEDIUM"}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </label>
        <label>
          Assignee
          <select
            name="assigneeId"
            required
            disabled={!manager}
            defaultValue={task?.assigneeId || ""}
          >
            <option value="">Select assignee</option>
            {project.members
              .filter((m) => m.user.active)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Reviewer
          <select
            name="reviewerId"
            required
            disabled={!manager}
            defaultValue={task?.reviewerId || ""}
          >
            <option value="">Select reviewer</option>
            {project.members
              .filter((m) => m.user.active)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.user.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label>
        Due date
        <input
          name="dueDate"
          type="date"
          defaultValue={
            task?.dueDate
              ? new Date(task.dueDate).toLocaleDateString("en-CA")
              : ""
          }
        />
      </label>
      <ErrorBox error={error} />
      <Button disabled={busy}>
        {busy ? "Saving…" : task ? "Save changes" : "Create task"}
      </Button>
    </form>
  );
}

export function TaskDialog({ id, close }: { id: string; close: () => void }) {
  const { auth, projects, notify } = useWorkspace(),
    client = useQueryClient();
  const [editing, setEditing] = useState(false),
    [tab, setTab] = useState("discussion"),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["task", id],
    queryFn: () => api<TaskDetail>(`/tasks/${id}`),
  });
  const t = query.data,
    project = projects.find((p) => p.id === t?.projectId);
  const manager =
    !!project &&
    (auth.user.isAdmin ||
      project.members.some((m) => m.userId === auth.user.id && m.isManager));
  const owner = t?.assigneeId === auth.user.id,
    reviewer = t?.reviewerId === auth.user.id;
  const editable =
    !!t &&
    ["TODO", "IN_PROGRESS"].includes(t.status) &&
    (manager || owner) &&
    !project?.archived;
  const mutation = useMutation({
    mutationFn: ({ action, body }: { action: string; body: unknown }) =>
      api(`/tasks/${id}/${action}`, { method: "POST", body }),
    onSuccess: async () => {
      setError("");
      await Promise.all(
        ["task", "tasks", "activities", "projects"].map((k) =>
          client.invalidateQueries({ queryKey: [k] }),
        ),
      );
    },
    onError: (e) => {
      setError(e.message);
      void client.invalidateQueries({ queryKey: ["task", id] });
    },
  });
  async function act(action: string, body: Record<string, unknown>) {
    try {
      await mutation.mutateAsync({
        action,
        body: { version: t?.version, ...body },
      });
      return true;
    } catch {
      return false;
    }
  }
  async function plain(action: string, body: unknown) {
    try {
      await mutation.mutateAsync({ action, body });
      return true;
    } catch {
      return false;
    }
  }
  return (
    <Dialog
      open
      onOpenChange={close}
      wide
      title={t ? `${t.project.key}-${t.number}` : "Task details"}
      description="Work details, discussion, and review history."
    >
      {query.isPending ? (
        <div className="empty-state">Loading task…</div>
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : t && project ? (
        <>
          {editing ? (
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                ← Back to task
              </Button>
              <TaskForm
                key={t.id}
                project={project}
                task={t}
                onSaved={() => setEditing(false)}
              />
            </>
          ) : (
            <div className="task-detail">
              <div className="detail-main">
                <div className="detail-title-row">
                  <h2>{t.title}</h2>
                  {editable && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </Button>
                  )}
                </div>
                <div className="detail-status">
                  <Status status={t.status} />
                  <Priority priority={t.priority} />
                  <span className="badge">
                    {t.type === "BUG" ? "Bug" : "Task"}
                  </span>
                </div>
                <h3>Description</h3>
                <p className="description-text">
                  {t.description || "No description added yet."}
                </p>
                <div className="section-title">
                  <h3>Checklist</h3>
                  <span className="muted">
                    {t.checklist.filter((c) => c.done).length}/
                    {t.checklist.length}
                  </span>
                </div>
                <div className="checklist">
                  {t.checklist.map((c) => (
                    <div key={c.id}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={c.done}
                          disabled={!editable || mutation.isPending}
                          onChange={() =>
                            act("checklist", { id: c.id, done: !c.done })
                          }
                        />
                        <span className={c.done ? "checked" : ""}>
                          {c.text}
                        </span>
                      </label>
                      {editable && (
                        <button
                          className="icon-button"
                          disabled={mutation.isPending}
                          aria-label={`Remove ${c.text}`}
                          onClick={() =>
                            act("checklist", { id: c.id, remove: true })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {editable && (
                  <form
                    className="inline-form checklist-add"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const text = new FormData(form).get("text");
                      if (await act("checklist", { text })) form.reset();
                    }}
                  >
                    <input
                      name="text"
                      aria-label="New checklist item"
                      placeholder="Add a checklist item…"
                      required
                      maxLength={250}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={mutation.isPending}
                    >
                      Add
                    </Button>
                  </form>
                )}
                <div className="detail-tabs">
                  <button
                    className={tab === "discussion" ? "active" : ""}
                    onClick={() => setTab("discussion")}
                  >
                    Discussion{" "}
                    <span className="count">{t.comments.length}</span>
                  </button>
                  <button
                    className={tab === "submissions" ? "active" : ""}
                    onClick={() => setTab("submissions")}
                  >
                    Submissions{" "}
                    <span className="count">{t.submissions.length}</span>
                  </button>
                  <button
                    className={tab === "activity" ? "active" : ""}
                    onClick={() => setTab("activity")}
                  >
                    Activity
                  </button>
                </div>
                {tab === "discussion" ? (
                  <>
                    <div className="comments">
                      {t.comments.length ? (
                        t.comments.map((c) => (
                          <article key={c.id}>
                            <Avatar name={c.user.name} small />
                            <div>
                              <header>
                                <strong>{c.user.name}</strong>
                                <time>{timeAgo(c.createdAt)}</time>
                              </header>
                              <p>{c.text}</p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="muted">
                          Keep the conversation close to the work. Add the first
                          comment.
                        </p>
                      )}
                    </div>
                    {!project.archived && (
                      <form
                        className="form-stack"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          if (
                            await plain("comments", {
                              text: new FormData(form).get("text"),
                            })
                          )
                            form.reset();
                        }}
                      >
                        <textarea
                          name="text"
                          aria-label="Comment"
                          placeholder="Share an update or ask a question…"
                          required
                          maxLength={4000}
                          rows={3}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mutation.isPending}
                        >
                          <MessageSquare size={14} />
                          Post comment
                        </Button>
                      </form>
                    )}
                  </>
                ) : tab === "submissions" ? (
                  <div className="submissions">
                    {t.submissions.length ? (
                      t.submissions.map((s) => (
                        <article key={s.id}>
                          <header>
                            <strong>Revision {s.revision}</strong>
                            <span className="badge">
                              {s.review
                                ? s.review.decision === "APPROVED"
                                  ? "Approved"
                                  : s.review.decision === "WITHDRAWN"
                                    ? "Withdrawn"
                                    : "Changes requested"
                                : "Awaiting review"}
                            </span>
                          </header>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View submitted work <ExternalLink size={13} />
                          </a>
                          <p>{s.note}</p>
                          <small>
                            {s.user.name} · {prettyDate(s.createdAt)}
                          </small>
                          {s.review && (
                            <div className="review-note">
                              <strong>{s.review.user.name}</strong>
                              <p>
                                {s.review.note ||
                                  "Approved without additional comments."}
                              </p>
                            </div>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="muted">
                        Submitted work and review decisions will appear here.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="task-activity">
                    {t.activities.map((a) => (
                      <div key={a.id}>
                        <span className="activity-bullet" />
                        <p>
                          <strong>{a.user.name}</strong> {a.text}
                          <time>{timeAgo(a.createdAt)}</time>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <aside className="detail-aside">
                <h3>Details</h3>
                <dl>
                  <dt>Assignee</dt>
                  <dd>
                    <Avatar name={t.assignee.name} small />
                    {t.assignee.name}
                  </dd>
                  <dt>Reviewer</dt>
                  <dd>
                    <Avatar name={t.reviewer.name} small />
                    {t.reviewer.name}
                  </dd>
                  <dt>Due date</dt>
                  <dd>
                    <Calendar size={15} />
                    {prettyDate(t.dueDate)}
                  </dd>
                  <dt>Project</dt>
                  <dd>{project.name}</dd>
                </dl>
                {!project.archived && (
                  <div className="task-actions">
                    <h3>Next step</h3>
                    {editable && (
                      <label>
                        Move task
                        <select
                          aria-label="Move task"
                          value={t.status}
                          disabled={mutation.isPending}
                          onChange={(e) =>
                            act("move", {
                              status: e.target.value,
                              position: t.position,
                            })
                          }
                        >
                          <option value="TODO">To do</option>
                          <option value="IN_PROGRESS">In progress</option>
                        </select>
                      </label>
                    )}
                    {owner && t.status === "IN_PROGRESS" && (
                      <form
                        className="form-stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act("submit", {
                            url: f.get("url"),
                            note: f.get("note"),
                          }).then((ok) => {
                            if (ok) {
                              setTab("submissions");
                              notify("Work submitted for review.");
                            }
                          });
                        }}
                      >
                        <h4>Ready for review?</h4>
                        <label>
                          Work link
                          <input
                            name="url"
                            type="url"
                            placeholder="https://…"
                            required
                          />
                        </label>
                        <label>
                          Submission notes
                          <textarea
                            name="note"
                            placeholder="What should the reviewer check?"
                            required
                            rows={3}
                          />
                        </label>
                        <Button disabled={mutation.isPending}>
                          <Send size={14} />
                          Request review
                        </Button>
                      </form>
                    )}
                    {owner && t.status === "REVIEW" && (
                      <>
                        <p className="muted">
                          Waiting for {t.reviewer.name}. Withdraw your
                          submission to make changes.
                        </p>
                        <Button
                          variant="outline"
                          disabled={mutation.isPending}
                          onClick={() => act("withdraw", {})}
                        >
                          Withdraw submission
                        </Button>
                      </>
                    )}
                    {reviewer && t.status === "REVIEW" && (
                      <form
                        className="form-stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const submitter = (e.nativeEvent as SubmitEvent)
                            .submitter as HTMLButtonElement;
                          void act("review", {
                            decision: submitter.value,
                            note: f.get("note"),
                          }).then((ok) => {
                            if (ok) setTab("submissions");
                          });
                        }}
                      >
                        <p className="muted">
                          Check the latest submission before deciding.
                        </p>
                        {t.submissions[0] && (
                          <a
                            className="work-link"
                            href={t.submissions[0].url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open revision {t.submissions[0].revision}
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <label>
                          Review notes
                          <textarea
                            name="note"
                            placeholder="Feedback for your teammate…"
                            rows={4}
                          />
                        </label>
                        <Button
                          name="decision"
                          value="APPROVED"
                          disabled={mutation.isPending}
                        >
                          <Check size={14} />
                          Approve work
                        </Button>
                        <Button
                          variant="outline"
                          name="decision"
                          value="CHANGES_REQUESTED"
                          disabled={mutation.isPending}
                        >
                          Request changes
                        </Button>
                      </form>
                    )}
                    {manager && t.status === "DONE" && (
                      <form
                        className="form-stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act("reopen", {
                            note: new FormData(e.currentTarget).get("note"),
                          });
                        }}
                      >
                        <label>
                          Reason for reopening
                          <textarea name="note" required rows={3} />
                        </label>
                        <Button variant="outline" disabled={mutation.isPending}>
                          Reopen task
                        </Button>
                      </form>
                    )}
                    {t.status === "DONE" && !manager && (
                      <div className="success-box">
                        <CheckCheck size={18} />
                        Reviewed and complete.
                      </div>
                    )}
                    {!editable &&
                      t.status !== "DONE" &&
                      !(owner && t.status === "REVIEW") &&
                      !(reviewer && t.status === "REVIEW") && (
                        <p className="muted">
                          {t.status === "REVIEW"
                            ? `${t.reviewer.name} is reviewing this work.`
                            : `${t.assignee.name} is responsible for this task.`}
                        </p>
                      )}
                  </div>
                )}
                <ErrorBox error={error} />
                {mutation.isPending && (
                  <p role="status" className="muted">
                    Saving changes…
                  </p>
                )}
              </aside>
            </div>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
