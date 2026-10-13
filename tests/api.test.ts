import "dotenv/config";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { io as connect, type Socket } from "socket.io-client";
import { SMTPServer } from "smtp-server";
import type { PrismaClient, User } from "@prisma/client";
import type { createApplication } from "../server/app";

let db: PrismaClient, app: ReturnType<typeof createApplication>, base: string;
type Actor = { user: User; cookie: string; csrf: string };
let admin: Actor,
  manager: Actor,
  developer: Actor,
  reviewer: Actor,
  outsider: Actor,
  projectId: string,
  taskId: string,
  projectCounter = 0;
const testPassword = "TestOnly!Password2026";
const sockets: Socket[] = [];
const smtpKeys = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_FROM",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;
const originalSmtp = Object.fromEntries(
  smtpKeys.map((key) => [key, process.env[key]]),
);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function api(
  actor: Actor,
  method: "get" | "post" | "patch" | "delete",
  url: string,
  body?: unknown,
) {
  let r = request(app.app)
    [method]("/api" + url)
    .set("Cookie", actor.cookie)
    .set("X-CSRF-Token", actor.csrf)
    .set("X-DevTrack-Request", "1")
    .set("Origin", "http://127.0.0.1:5173");
  if (method !== "get")
    r = r.set("Content-Type", "application/json").send(body || {});
  return r;
}
async function current() {
  return await db.task.findUniqueOrThrow({ where: { id: taskId } });
}
async function move() {
  const t = await current();
  return api(developer, "post", `/tasks/${taskId}/move`, {
    version: t.version,
    status: "IN_PROGRESS",
    position: 1024,
  });
}
async function submit() {
  const t = await current();
  return api(developer, "post", `/tasks/${taskId}/submit`, {
    version: t.version,
    url: "https://example.com/work",
    note: "Please verify keyboard navigation.",
  });
}
async function review(decision = "APPROVED", note = "Looks good.") {
  const t = await current();
  return api(reviewer, "post", `/tasks/${taskId}/review`, {
    version: t.version,
    decision,
    note,
  });
}
async function socket(actor: Actor) {
  const s = connect(base, {
    auth: { csrfToken: actor.csrf },
    extraHeaders: { Cookie: actor.cookie, Origin: "http://127.0.0.1:5173" },
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
async function join(s: Socket, id: string) {
  return new Promise<{ ok: boolean }>((resolve) =>
    s.emit("project:join", id, resolve),
  );
}
beforeAll(async () => {
  for (const key of smtpKeys) delete process.env[key];
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error(
      "TEST_DATABASE_URL must point to a dedicated *_test database.",
    );
  process.env.DATABASE_URL = url;
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
  const dbModule = await import("../server/db");
  db = dbModule.db;
  for (const table of [
    "Review",
    "Submission",
    "Comment",
    "ChecklistItem",
    "Activity",
    "Task",
    "ProjectMember",
    "Project",
    "Session",
    "Invitation",
    "User",
    "Company",
  ])
    await db.$executeRawUnsafe(`DELETE FROM "${table}"`);
  app = (await import("../server/app")).createApplication();
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${(app.http.address() as { port: number }).port}`;
  const company = await db.company.create({
    data: { name: "Integration company" },
  });
  const passwordHash = await argon2.hash(testPassword);
  const people: Actor[] = [];
  for (const name of [
    "admin",
    "manager",
    "developer",
    "reviewer",
    "outsider",
  ]) {
    const user = await db.user.create({
      data: {
        companyId: company.id,
        name,
        email: `${name}@test.dev`,
        passwordHash,
        isAdmin: name === "admin",
      },
    });
    const login = await request(app.app)
      .post("/api/auth/login")
      .set("X-DevTrack-Request", "1")
      .send({ email: user.email, password: testPassword });
    expect(login.status).toBe(200);
    people.push({
      user,
      cookie: login.headers["set-cookie"][0].split(";")[0],
      csrf: login.body.csrfToken,
    });
  }
  [admin, manager, developer, reviewer, outsider] = people;
});
beforeEach(async () => {
  const p = await api(admin, "post", "/projects", {
    name: "Integration project",
    key: "TEST" + String.fromCharCode(65 + projectCounter++),
    description: "Test project",
    managerId: manager.user.id,
  });
  expect(p.status).toBe(201);
  projectId = p.body.id;
  for (const actor of [developer, reviewer])
    expect(
      (
        await api(manager, "post", `/projects/${projectId}/members`, {
          userId: actor.user.id,
        })
      ).status,
    ).toBe(200);
  const t = await api(manager, "post", `/projects/${projectId}/tasks`, {
    title: "Build the customer portal",
    description: "Verify the complete review workflow",
    assigneeId: developer.user.id,
    reviewerId: reviewer.user.id,
    priority: "HIGH",
    type: "TASK",
    dueDate: null,
  });
  expect(t.status).toBe(201);
  taskId = t.body.id;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  if (app) await new Promise<void>((resolve) => app.io.close(() => resolve()));
  if (db) await db.$disconnect();
  for (const key of smtpKeys) {
    if (originalSmtp[key] === undefined) delete process.env[key];
    else process.env[key] = originalSmtp[key];
  }
});
describe("PostgreSQL API and collaboration", () => {
  it("registers a new company and isolates its admin, projects, invitations, tasks and sockets", async () => {
    const registration = await request(app.app)
      .post("/api/auth/register")
      .set("X-DevTrack-Request", "1")
      .set("Origin", "http://127.0.0.1:5173")
      .send({
        companyName: "Second Studio",
        name: "Company owner",
        email: "owner@second.test",
        password: testPassword,
      });
    expect(registration.status).toBe(201);
    expect(registration.body.workspace.name).toBe("Second Studio");
    const owner: Actor = {
      user: await db.user.findUniqueOrThrow({
        where: { email: "owner@second.test" },
      }),
      cookie: registration.headers["set-cookie"][0].split(";")[0],
      csrf: registration.body.csrfToken,
    };
    expect(owner.user.isAdmin).toBe(true);
    expect((await api(owner, "get", "/auth/me")).body.workspace.id).toBe(
      owner.user.companyId,
    );
    expect(
      (await api(owner, "get", "/users")).body.map((u: User) => u.id),
    ).toEqual([owner.user.id]);
    for (const path of ["/projects", "/tasks", "/activities", "/invitations"])
      expect((await api(owner, "get", path)).body).toEqual([]);
    expect((await api(owner, "get", `/tasks/${taskId}`)).status).toBe(404);
    expect(
      (await api(owner, "get", `/tasks?projectId=${projectId}`)).status,
    ).toBe(404);
    expect(
      (
        await api(owner, "patch", `/users/${developer.user.id}`, {
          active: false,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(owner, "post", "/projects", {
          name: "Foreign manager",
          key: "FRGN",
          managerId: manager.user.id,
        })
      ).status,
    ).toBe(400);
    const original = await db.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const created = await api(owner, "post", "/projects", {
      name: "Own project",
      key: original.key,
      managerId: owner.user.id,
    });
    expect(created.status).toBe(201);
    expect(created.body.companyId).toBe(owner.user.companyId);
    expect(
      (await api(admin, "get", `/tasks?projectId=${created.body.id}`)).status,
    ).toBe(404);
    expect(
      (
        await api(owner, "post", `/projects/${created.body.id}/members`, {
          userId: reviewer.user.id,
        })
      ).status,
    ).toBe(400);
    const outside = await socket(owner);
    expect(await join(outside, projectId)).toEqual({ ok: false });
    outside.disconnect();
    const otherInvite = await api(admin, "post", "/invitations", {
      email: "invited@first.test",
    });
    expect(
      (await api(owner, "delete", `/invitations/${otherInvite.body.id}`))
        .status,
    ).toBe(404);
    const ownInvite = await api(owner, "post", "/invitations", {
      email: "invited@second.test",
    });
    expect(ownInvite.status).toBe(201);
    const accepted = await request(app.app)
      .post("/api/auth/accept")
      .set("X-DevTrack-Request", "1")
      .send({
        token: new URL(ownInvite.body.url).hash.slice(1),
        name: "Second teammate",
        password: testPassword,
      });
    expect(accepted.status).toBe(201);
    expect(
      (
        await db.user.findUniqueOrThrow({
          where: { email: "invited@second.test" },
        })
      ).companyId,
    ).toBe(owner.user.companyId);
    const duplicate = await request(app.app)
      .post("/api/auth/register")
      .set("X-DevTrack-Request", "1")
      .send({
        companyName: "Duplicate company",
        name: "Company owner",
        email: "owner@second.test",
        password: testPassword,
      });
    expect(duplicate.status).toBe(409);
    expect(
      await db.company.count({ where: { name: "Duplicate company" } }),
    ).toBe(0);
    const liveSocket = await socket(owner);
    const disconnected = new Promise<void>((resolve) =>
      liveSocket.once("disconnect", () => resolve()),
    );
    const switched = await request(app.app)
      .post("/api/auth/register")
      .set("X-DevTrack-Request", "1")
      .set("Cookie", owner.cookie)
      .send({
        companyName: "Third Studio",
        name: "Another owner",
        email: "owner@third.test",
        password: testPassword,
      });
    expect(switched.status).toBe(201);
    await disconnected;
    expect((await api(owner, "get", "/auth/me")).status).toBe(401);
  });
  it("revokes a logged-out session and denies expired sessions", async () => {
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        id: sha(token),
        userId: reviewer.user.id,
        csrfToken: csrf,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const temporary = {
      user: reviewer.user,
      cookie: `devtrack_session=${token}`,
      csrf,
    };
    expect((await api(temporary, "post", "/auth/logout")).status).toBe(200);
    expect((await api(temporary, "get", "/auth/me")).status).toBe(401);
    await db.session.create({
      data: {
        id: sha(token),
        userId: reviewer.user.id,
        csrfToken: csrf,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect((await api(temporary, "get", "/auth/me")).status).toBe(401);
  });
  it("deactivates an unassigned account and invalidates its session", async () => {
    const user = await db.user.create({
      data: {
        companyId: admin.user.companyId,
        name: "Temporary teammate",
        email: "temporary@test.dev",
        passwordHash: reviewer.user.passwordHash,
      },
    });
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        id: sha(token),
        userId: user.id,
        csrfToken: csrf,
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const temporary = { user, cookie: `devtrack_session=${token}`, csrf };
    expect((await api(temporary, "get", "/auth/me")).status).toBe(200);
    expect(
      (await api(admin, "patch", `/users/${user.id}`, { active: false }))
        .status,
    ).toBe(200);
    expect((await api(temporary, "get", "/auth/me")).status).toBe(401);
  });
  it("completes the manager → developer → revision → reviewer workflow", async () => {
    expect((await move()).status).toBe(200);
    expect((await submit()).status).toBe(200);
    expect(
      (await review("CHANGES_REQUESTED", "Please improve focus styles."))
        .status,
    ).toBe(200);
    expect((await current()).status).toBe("IN_PROGRESS");
    expect((await submit()).status).toBe(200);
    expect((await review()).status).toBe(200);
    const detail = await api(manager, "get", `/tasks/${taskId}`);
    expect(detail.body.status).toBe("DONE");
    expect(detail.body.submissions).toHaveLength(2);
    expect(detail.body.submissions[1].review.decision).toBe(
      "CHANGES_REQUESTED",
    );
    expect(detail.body.activities.length).toBeGreaterThanOrEqual(6);
  });
  it("hides other projects and tasks from non-members", async () => {
    expect(
      (await api(outsider, "get", `/tasks?projectId=${projectId}`)).status,
    ).toBe(404);
    expect((await api(outsider, "get", `/tasks/${taskId}`)).status).toBe(404);
    expect(
      (
        await api(outsider, "post", `/tasks/${taskId}/comments`, {
          text: "Intrusion",
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(outsider, "get", "/projects")).body.some(
        (p: { id: string }) => p.id === projectId,
      ),
    ).toBe(false);
  });
  it("rejects skipping review, self-review and manager override", async () => {
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/move`, {
          version: 1,
          status: "DONE",
          position: 0,
        })
      ).status,
    ).toBe(400);
    await move();
    await submit();
    const t = await current();
    for (const actor of [developer, manager, admin])
      expect(
        (
          await api(actor, "post", `/tasks/${taskId}/review`, {
            version: t.version,
            decision: "APPROVED",
            note: "",
          })
        ).status,
      ).toBe(403);
    expect((await current()).status).toBe("REVIEW");
  });
  it("locks edits during review, allows withdrawal and preserves revision history", async () => {
    await move();
    await submit();
    let t = await current();
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/checklist`, {
          version: t.version,
          text: "Sneaky edit",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/withdraw`, {
          version: t.version,
        })
      ).status,
    ).toBe(200);
    expect((await current()).status).toBe("IN_PROGRESS");
    await submit();
    const detail = await api(developer, "get", `/tasks/${taskId}`);
    expect(detail.body.submissions[1].review.decision).toBe("WITHDRAWN");
  });
  it("rejects stale edits and saves exactly one concurrent write", async () => {
    const payload = { version: 1, status: "IN_PROGRESS", position: 1024 };
    const responses = await Promise.all([
      api(developer, "post", `/tasks/${taskId}/move`, payload),
      api(manager, "post", `/tasks/${taskId}/move`, payload),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await current()).version).toBe(2);
  });
  it("requires a complete checklist and validates item ownership", async () => {
    let t = await current();
    await api(developer, "post", `/tasks/${taskId}/checklist`, {
      version: t.version,
      text: "Test keyboard",
    });
    await move();
    expect((await submit()).status).toBe(400);
    const item = await db.checklistItem.findFirstOrThrow({ where: { taskId } });
    t = await current();
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/checklist`, {
          version: t.version,
          id: item.id,
          done: true,
        })
      ).status,
    ).toBe(200);
    expect((await submit()).status).toBe(200);
  });
  it("only managers reopen completed work and must explain why", async () => {
    await move();
    await submit();
    await review();
    const t = await current();
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/reopen`, {
          version: t.version,
          note: "More work",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(manager, "post", `/tasks/${taskId}/reopen`, {
          version: t.version,
          note: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(manager, "post", `/tasks/${taskId}/reopen`, {
          version: t.version,
          note: "New requirements",
        })
      ).status,
    ).toBe(200);
    await submit();
    await review();
    expect((await current()).status).toBe("DONE");
  });
  it("does not allow member removal or deactivation with active responsibilities", async () => {
    expect(
      (
        await api(
          manager,
          "delete",
          `/projects/${projectId}/members/${developer.user.id}`,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await api(admin, "patch", `/users/${developer.user.id}`, {
          active: false,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(
          manager,
          "delete",
          `/projects/${projectId}/members/${manager.user.id}`,
        )
      ).status,
    ).toBe(409);
  });
  it("requires server-side manager permissions and distinct project members", async () => {
    const payload = {
      title: "Invalid assignment",
      assigneeId: developer.user.id,
      reviewerId: developer.user.id,
    };
    expect(
      (await api(manager, "post", `/projects/${projectId}/tasks`, payload))
        .status,
    ).toBe(400);
    expect(
      (
        await api(developer, "post", `/projects/${projectId}/tasks`, {
          ...payload,
          reviewerId: reviewer.user.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(manager, "post", `/projects/${projectId}/tasks`, {
          ...payload,
          reviewerId: outsider.user.id,
        })
      ).status,
    ).toBe(400);
  });
  it("validates CSRF and request origins", async () => {
    expect(
      (
        await request(app.app)
          .post(`/api/tasks/${taskId}/comments`)
          .set("Cookie", developer.cookie)
          .set("X-DevTrack-Request", "1")
          .send({ text: "No CSRF" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.app)
          .post(`/api/tasks/${taskId}/comments`)
          .set("Cookie", developer.cookie)
          .set("X-CSRF-Token", developer.csrf)
          .set("X-DevTrack-Request", "1")
          .set("Origin", "https://untrusted.test")
          .send({ text: "Cross origin" })
      ).status,
    ).toBe(403);
  });
  it("accepts an invitation once and rejects expired or revoked tokens", async () => {
    const created = await api(admin, "post", "/invitations", {
      email: "newmember@test.dev",
    });
    expect(created.status).toBe(201);
    const token = new URL(created.body.url).hash.slice(1);
    const accept = (token: string) =>
      request(app.app)
        .post("/api/auth/accept")
        .set("X-DevTrack-Request", "1")
        .send({ token, name: "New teammate", password: testPassword });
    expect((await accept(token)).status).toBe(201);
    expect((await accept(token)).status).toBe(400);
    for (const variant of ["expired", "revoked"]) {
      const value = randomBytes(32).toString("hex");
      await db.invitation.create({
        data: {
          companyId: admin.user.companyId,
          email: `${variant}@test.dev`,
          tokenHash: sha(value),
          expiresAt: new Date(
            Date.now() + (variant === "expired" ? -1000 : 100000),
          ),
          revokedAt: variant === "revoked" ? new Date() : null,
        },
      });
      expect((await accept(value)).status).toBe(400);
    }
  });
  it("uses Render's public URL for invitation links when APP_ORIGIN is unset", async () => {
    const origin = process.env.APP_ORIGIN;
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    try {
      delete process.env.APP_ORIGIN;
      process.env.RENDER_EXTERNAL_URL = "https://devtrack-example.onrender.com";
      const response = await request(app.app)
        .post("/api/invitations")
        .set("Cookie", admin.cookie)
        .set("X-CSRF-Token", admin.csrf)
        .set("X-DevTrack-Request", "1")
        .set("Origin", "https://devtrack-example.onrender.com")
        .send({ email: "render-invite@test.dev" });
      expect(response.status).toBe(201);
      expect(response.body.url).toMatch(
        /^https:\/\/devtrack-example\.onrender\.com\/accept-invitation#/,
      );
    } finally {
      if (origin === undefined) delete process.env.APP_ORIGIN;
      else process.env.APP_ORIGIN = origin;
      if (renderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL;
      else process.env.RENDER_EXTERNAL_URL = renderUrl;
    }
  });
  it("emails an invitation through SMTP and preserves older links if delivery fails", async () => {
    const keys = [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_FROM",
      "SMTP_USER",
      "SMTP_PASSWORD",
    ] as const;
    const previous = Object.fromEntries(
      keys.map((key) => [key, process.env[key]]),
    );
    const messages: string[] = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["AUTH", "STARTTLS"],
      onData(stream, _session, callback) {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          messages.push(Buffer.concat(chunks).toString("utf8"));
          callback();
        });
      },
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.server.address();
      if (!address || typeof address === "string")
        throw new Error("SMTP listener missing");
      Object.assign(process.env, {
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(address.port),
        SMTP_SECURE: "false",
        SMTP_FROM: "invites@devtrack.test",
      });
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      const recipient = "smtp-member@test.dev";
      const sent = await api(admin, "post", "/invitations", {
        email: recipient,
      });
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ delivery: "sent" });
      expect(sent.body.url).toBeUndefined();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(recipient);
      expect(messages[0]).toContain("accept-invitation#");
      await new Promise<void>((resolve) => server.close(resolve));
      const failed = await api(admin, "post", "/invitations", {
        email: recipient,
      });
      expect(failed.status).toBe(502);
      const invitations = await db.invitation.findMany({
        where: { companyId: admin.user.companyId, email: recipient },
        orderBy: { createdAt: "asc" },
      });
      expect(invitations).toHaveLength(2);
      expect(invitations[0].revokedAt).toBeNull();
      expect(invitations[1].revokedAt).not.toBeNull();
    } finally {
      if (server.server.listening)
        await new Promise<void>((resolve) => server.close(resolve));
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  });
  it("keeps archived projects read-only", async () => {
    expect(
      (
        await api(manager, "patch", `/projects/${projectId}`, {
          name: "Archived",
          description: "",
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect((await move()).status).toBe(409);
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/comments`, {
          text: "Archived comment",
        })
      ).status,
    ).toBe(409);
  });
  it("broadcasts committed updates to members and rejects outsider socket access", async () => {
    const s = await socket(reviewer),
      out = await socket(outsider);
    expect(await join(s, projectId)).toEqual({ ok: true });
    expect(await join(out, projectId)).toEqual({ ok: false });
    const event = new Promise<{ projectId: string }>((resolve) =>
      s.once("project:changed", resolve),
    );
    await move();
    expect((await event).projectId).toBe(projectId);
    s.disconnect();
    out.disconnect();
  });
  it("evicts a removed member from the project socket room", async () => {
    await api(manager, "post", `/projects/${projectId}/members`, {
      userId: outsider.user.id,
    });
    const s = await socket(outsider);
    await join(s, projectId);
    const event = new Promise((resolve) => s.once("access:changed", resolve));
    expect(
      (
        await api(
          manager,
          "delete",
          `/projects/${projectId}/members/${outsider.user.id}`,
        )
      ).status,
    ).toBe(200);
    await event;
    const serverSocket = app.io.sockets.sockets.get(s.id!);
    expect(serverSocket?.rooms.has(`project:${projectId}`)).toBe(false);
    expect((await api(outsider, "get", `/tasks/${taskId}`)).status).toBe(404);
    s.disconnect();
  });
  it("stores comments as text and rejects unsafe work links", async () => {
    const text = "<img src=x onerror=alert(1)>";
    expect(
      (await api(developer, "post", `/tasks/${taskId}/comments`, { text }))
        .status,
    ).toBe(200);
    const d = await api(developer, "get", `/tasks/${taskId}`);
    expect(d.body.comments[0].text).toBe(text);
    await move();
    const t = await current();
    expect(
      (
        await api(developer, "post", `/tasks/${taskId}/submit`, {
          version: t.version,
          url: "javascript:alert(1)",
          note: "Unsafe link",
        })
      ).status,
    ).toBe(400);
  });
});
