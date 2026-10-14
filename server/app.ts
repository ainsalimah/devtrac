import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import argon2 from "argon2";
import { Server } from "socket.io";
import { Prisma, type User, type Task } from "@prisma/client";
import { z, ZodError } from "zod";
import { db, personSelect, taskInclude, projectInclude } from "./db";
import { cleanupExpiredDemos, createDemoWorkspace } from "./demo";
import {
  resendSettings,
  sendInvitationEmail,
  sendInvitationViaResend,
  smtpSettings,
} from "./mail";
import {
  AppError,
  requireCondition as must,
  requireEditable,
  requireReviewer,
} from "./policy";
import {
  acceptSchema,
  registerSchema,
  jobTitle,
  email,
  loginSchema,
  projectSchema,
  taskSchema,
  editSchema,
  moveSchema,
  submissionSchema,
  reviewSchema,
  reasonSchema,
  versionSchema,
} from "../shared/contracts";

type Tx = Prisma.TransactionClient;
type AuthRequest = Request & {
  actor: User;
  companyName: string;
  sessionId: string;
  csrfToken: string;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = () => randomBytes(32).toString("hex");
const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  jobTitle: u.jobTitle,
  isAdmin: u.isAdmin,
  active: u.active,
  demoPersona: u.demoPersona,
});
const cookieName = "devtrack_session";
const appOrigin = () =>
  process.env.APP_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN &&
    `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`) ||
  "http://127.0.0.1:5173";
const origins = () =>
  new Set([
    appOrigin(),
    ...(process.env.NODE_ENV === "production"
      ? []
      : [`http://127.0.0.1:${process.env.PORT || 4100}`]),
  ]);
const mutationMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const sessionCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
  maxAge: 7 * 86400000,
};
const transaction = <T>(fn: (tx: Tx) => Promise<T>) =>
  db.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 15000,
  });
async function access(tx: Tx, actor: User, projectId: string, manager = false) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: { members: true },
  });
  must(
    project && project.companyId === actor.companyId,
    404,
    "Project not found.",
  );
  const member = project.members.find((m) => m.userId === actor.id);
  must(actor.isAdmin || member, 404, "Project not found.");
  if (manager)
    must(
      actor.isAdmin || member?.isManager,
      403,
      "Only the project manager can do this.",
    );
  return project;
}
async function taskAccess(tx: Tx, actor: User, id: string) {
  const task = await tx.task.findUnique({ where: { id } });
  must(task, 404, "Task not found.");
  const project = await access(tx, actor, task.projectId);
  return {
    task,
    project,
    manager:
      actor.isAdmin ||
      project.members.some((m) => m.userId === actor.id && m.isManager),
  };
}
async function validatePeople(
  tx: Tx,
  projectId: string,
  assigneeId: string,
  reviewerId: string,
) {
  must(
    assigneeId !== reviewerId,
    400,
    "Assignee and reviewer must be different people.",
  );
  const n = await tx.projectMember.count({
    where: {
      projectId,
      userId: { in: [assigneeId, reviewerId] },
      user: { active: true },
    },
  });
  must(n === 2, 400, "Both people must be active members of this project.");
}
async function activity(
  tx: Tx,
  userId: string,
  projectId: string,
  text: string,
  taskId?: string,
) {
  return tx.activity.create({ data: { userId, projectId, text, taskId } });
}
async function notification(
  tx: Tx,
  recipientId: string,
  projectId: string,
  text: string,
  taskId?: string,
) {
  return tx.notification.create({
    data: { recipientId, projectId, taskId, text },
  });
}
async function changeTask(
  tx: Tx,
  task: Task,
  version: number,
  data: Prisma.TaskUpdateManyMutationInput,
) {
  const result = await tx.task.updateMany({
    where: { id: task.id, version },
    data: { ...data, version: { increment: 1 } },
  });
  must(
    result.count === 1,
    409,
    "This task changed. Reload the latest version and try again.",
  );
}
async function resolveSession(token?: string) {
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hash(token) },
    include: { user: { include: { company: true } } },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.active &&
    (!session.user.company.demoExpiresAt ||
      session.user.company.demoExpiresAt > new Date())
    ? session
    : null;
}

export function createApplication() {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, {
    allowRequest: (req, callback) =>
      callback(null, !req.headers.origin || origins().has(req.headers.origin)),
  });
  app.disable("x-powered-by");
  app.use(
    helmet({
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        directives: { "upgrade-insecure-requests": null },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, res, next) => {
    if (mutationMethods.has(req.method)) {
      if (req.headers.origin && !origins().has(req.headers.origin))
        return res.status(403).json({ error: "Untrusted request origin." });
      if (
        req.headers["x-devtrack-request"] !== "1" ||
        !req.is("application/json")
      )
        return res
          .status(403)
          .json({ error: "A same-origin JSON request is required." });
    }
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Try again in 15 minutes." },
  });
  async function revokeExistingSession(req: Request) {
    const token = req.cookies[cookieName];
    if (!token) return;
    const sessionId = hash(token);
    await db.session.deleteMany({ where: { id: sessionId } });
    for (const socket of io.sockets.sockets.values())
      if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
  async function signIn(
    res: Response,
    user: User,
    companyName: string,
    demo = false,
  ) {
    const token = randomToken();
    const csrfToken = randomToken();
    await db.session.create({
      data: {
        id: hash(token),
        userId: user.id,
        csrfToken,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    res.cookie(cookieName, token, sessionCookie).json({
      user: publicUser(user),
      workspace: { id: user.companyId, name: companyName, demo },
      csrfToken,
    });
  }
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await db.user.findUnique({
      where: { email: data.email },
      include: { company: true },
    });
    must(
      user &&
        user.active &&
        (await argon2.verify(user.passwordHash, data.password)),
      401,
      "Email or password is incorrect.",
    );
    await revokeExistingSession(req);
    await signIn(res, user, user.company.name, !!user.company.demoExpiresAt);
  });
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const data = registerSchema.parse(req.body);
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
    });
    const { company, user } = await transaction(async (tx) => {
      must(
        !(await tx.user.findUnique({ where: { email: data.email } })),
        409,
        "An account already exists for this email.",
      );
      const company = await tx.company.create({
        data: { name: data.companyName },
      });
      const user = await tx.user.create({
        data: {
          companyId: company.id,
          name: data.name,
          email: data.email,
          passwordHash,
          isAdmin: true,
        },
      });
      return { company, user };
    });
    await revokeExistingSession(req);
    res.status(201);
    await signIn(res, user, company.name);
  });
  app.post("/api/auth/demo", authLimiter, async (req, res) => {
    const { company, user } = await createDemoWorkspace();
    await revokeExistingSession(req);
    res.status(201);
    await signIn(res, user, company.name, true);
    void cleanupExpiredDemos().catch(() => undefined);
  });
  app.post("/api/auth/accept", authLimiter, async (req, res) => {
    const data = acceptSchema.parse(req.body);
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
    });
    await transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hash(data.token) },
      });
      must(
        invitation &&
          !invitation.usedAt &&
          !invitation.revokedAt &&
          invitation.expiresAt > new Date(),
        400,
        "This invitation is invalid or has expired.",
      );
      must(
        !(await tx.user.findUnique({ where: { email: invitation.email } })),
        409,
        "An account already exists for this email.",
      );
      await tx.user.create({
        data: {
          companyId: invitation.companyId,
          name: data.name,
          email: invitation.email,
          jobTitle: invitation.jobTitle,
          passwordHash,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });
    });
    res.status(201).json({ ok: true });
  });
  app.use("/api", async (req, res, next) => {
    const s = await resolveSession(req.cookies[cookieName]);
    must(s, 401, "Please sign in to continue.");
    const r = req as AuthRequest;
    r.actor = s.user;
    r.companyName = s.user.company.name;
    r.sessionId = s.id;
    r.csrfToken = s.csrfToken;
    if (mutationMethods.has(req.method)) {
      const given = req.headers["x-csrf-token"];
      must(
        typeof given === "string" &&
          Buffer.byteLength(given) === Buffer.byteLength(s.csrfToken) &&
          timingSafeEqual(Buffer.from(given), Buffer.from(s.csrfToken)),
        403,
        "Session verification failed. Refresh and try again.",
      );
    }
    next();
  });
  const route = (
    method: "get" | "post" | "patch" | "delete",
    url: string,
    fn: (req: AuthRequest, res: Response) => Promise<unknown>,
  ) => app[method](url, (req, res) => fn(req as AuthRequest, res));
  const changed = (projectId: string) => {
    io.to(`project:${projectId}`).emit("project:changed", { projectId });
  };
  const evict = (userId: string, projectId?: string) => {
    for (const s of io.sockets.sockets.values())
      if (s.data.userId === userId) {
        if (projectId) {
          s.leave(`project:${projectId}`);
          s.emit("access:changed", { projectId });
        } else s.disconnect(true);
      }
  };
  route("get", "/api/auth/me", async (req, res) =>
    res.json({
      user: publicUser(req.actor),
      workspace: {
        id: req.actor.companyId,
        name: req.companyName,
        demo: !!(
          await db.company.findUnique({
            where: { id: req.actor.companyId },
            select: { demoExpiresAt: true },
          })
        )?.demoExpiresAt,
      },
      csrfToken: req.csrfToken,
    }),
  );
  route("post", "/api/auth/demo/switch", async (req, res) => {
    const { persona } = z
      .object({ persona: z.enum(["manager", "developer", "reviewer"]) })
      .strict()
      .parse(req.body);
    const company = await db.company.findUnique({
      where: { id: req.actor.companyId },
    });
    must(
      req.actor.demoPersona &&
        company?.demoExpiresAt &&
        company.demoExpiresAt > new Date(),
      403,
      "Demo role switching is unavailable.",
    );
    const target = await db.user.findFirst({
      where: { companyId: company.id, demoPersona: persona, active: true },
    });
    must(target, 404, "Demo account not found.");
    await revokeExistingSession(req);
    await signIn(res, target, company.name, true);
  });
  route("get", "/api/notifications", async (req, res) => {
    res.json(
      await db.notification.findMany({
        where: {
          recipientId: req.actor.id,
          project: {
            companyId: req.actor.companyId,
            ...(req.actor.isAdmin
              ? {}
              : { members: { some: { userId: req.actor.id } } }),
          },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          text: true,
          projectId: true,
          taskId: true,
          readAt: true,
          createdAt: true,
        },
      }),
    );
  });
  route("post", "/api/notifications/:id/read", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const result = await db.notification.updateMany({
      where: {
        id,
        recipientId: req.actor.id,
        project: {
          companyId: req.actor.companyId,
          ...(req.actor.isAdmin
            ? {}
            : { members: { some: { userId: req.actor.id } } }),
        },
      },
      data: { readAt: new Date() },
    });
    must(result.count === 1, 404, "Notification not found.");
    res.json({ ok: true });
  });
  route("post", "/api/auth/logout", async (req, res) => {
    await db.session.delete({ where: { id: req.sessionId } });
    for (const s of io.sockets.sockets.values())
      if (s.data.sessionId === req.sessionId) s.disconnect(true);
    res.clearCookie(cookieName, { path: "/" }).json({ ok: true });
  });
  route("get", "/api/users", async (req, res) => {
    const where = {
      companyId: req.actor.companyId,
      ...(req.actor.isAdmin ? {} : { active: true }),
    };
    res.json(
      await db.user.findMany({
        where,
        select: personSelect,
        orderBy: { name: "asc" },
      }),
    );
  });
  route("patch", "/api/users/:id", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    const { active } = z
      .object({ active: z.boolean() })
      .strict()
      .parse(req.body);
    const id = String(req.params.id);
    must(id !== req.actor.id, 400, "You cannot deactivate your own account.");
    await transaction(async (tx) => {
      must(
        await tx.user.findFirst({
          where: { id, companyId: req.actor.companyId },
        }),
        404,
        "Account not found.",
      );
      if (!active) {
        must(
          !(await tx.task.count({
            where: {
              status: { not: "DONE" },
              OR: [{ assigneeId: id }, { reviewerId: id }],
            },
          })),
          409,
          "Reassign active tasks and reviews before deactivating this account.",
        );
        const managed = await tx.projectMember.findMany({
          where: { userId: id, isManager: true },
          include: {
            project: {
              include: {
                members: { where: { isManager: true, user: { active: true } } },
              },
            },
          },
        });
        must(
          managed.every((m) => m.project.members.some((p) => p.userId !== id)),
          409,
          "Assign another project manager first.",
        );
        await tx.session.deleteMany({ where: { userId: id } });
      }
      await tx.user.update({ where: { id }, data: { active } });
    });
    evict(id);
    io.to(`company:${req.actor.companyId}`).emit("access:changed", {});
    res.json({ ok: true });
  });
  route("patch", "/api/users/:id/job-title", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    const data = z.object({ jobTitle }).strict().parse(req.body);
    const updated = await db.user.updateMany({
      where: { id: String(req.params.id), companyId: req.actor.companyId },
      data,
    });
    must(updated.count === 1, 404, "Account not found.");
    io.to(`company:${req.actor.companyId}`).emit("access:changed", {});
    res.json({ ok: true });
  });
  route("get", "/api/invitations", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    res.json(
      await db.invitation.findMany({
        where: { companyId: req.actor.companyId },
        select: {
          id: true,
          email: true,
          jobTitle: true,
          expiresAt: true,
          usedAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
  route("post", "/api/invitations", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    must(
      !req.actor.demoPersona,
      403,
      "Invitations are unavailable in sample workspaces.",
    );
    const data = z
      .object({ email, jobTitle: jobTitle.default("") })
      .strict()
      .parse(req.body);
    const resend = resendSettings();
    const smtp = resend ? null : smtpSettings();
    const token = randomToken();
    const invitation = await transaction(async (tx) => {
      must(
        !(await tx.user.findUnique({ where: { email: data.email } })),
        409,
        "An account already exists for this email.",
      );
      return tx.invitation.create({
        data: {
          companyId: req.actor.companyId,
          email: data.email,
          jobTitle: data.jobTitle,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + 48 * 3600000),
        },
      });
    });
    const url = `${appOrigin()}/accept-invitation#${token}`;
    if (resend || smtp) {
      try {
        if (resend)
          await sendInvitationViaResend(
            resend,
            data.email,
            req.companyName,
            url,
          );
        else if (smtp)
          await sendInvitationEmail(smtp, data.email, req.companyName, url);
      } catch {
        await db.invitation.update({
          where: { id: invitation.id },
          data: { revokedAt: new Date() },
        });
        throw new AppError(
          502,
          "Could not send the invitation email. Check the email provider settings and try again.",
        );
      }
    }
    await db.invitation.updateMany({
      where: {
        companyId: req.actor.companyId,
        email: data.email,
        id: { not: invitation.id },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    res.status(201).json({
      id: invitation.id,
      delivery: resend || smtp ? "sent" : "manual",
      ...(resend || smtp ? {} : { url }),
    });
  });
  route("delete", "/api/invitations/:id", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    const updated = await db.invitation.updateMany({
      where: { id: String(req.params.id), companyId: req.actor.companyId },
      data: { revokedAt: new Date() },
    });
    must(updated.count === 1, 404, "Invitation not found.");
    res.json({ ok: true });
  });
  route("get", "/api/projects", async (req, res) =>
    res.json(
      await db.project.findMany({
        where: {
          companyId: req.actor.companyId,
          ...(req.actor.isAdmin
            ? {}
            : { members: { some: { userId: req.actor.id } } }),
        },
        include: projectInclude,
        orderBy: { createdAt: "asc" },
      }),
    ),
  );
  route("post", "/api/projects", async (req, res) => {
    must(req.actor.isAdmin, 403, "Admin access is required.");
    const { managerId, ...data } = projectSchema.parse(req.body);
    const p = await transaction(async (tx) => {
      must(
        await tx.user.findFirst({
          where: {
            id: managerId,
            companyId: req.actor.companyId,
            active: true,
          },
        }),
        400,
        "Select an active project manager.",
      );
      const p = await tx.project.create({
        data: {
          ...data,
          companyId: req.actor.companyId,
          members: { create: { userId: managerId, isManager: true } },
        },
      });
      await activity(tx, req.actor.id, p.id, "created the project");
      return p;
    });
    io.to(`company:${req.actor.companyId}`).emit("access:changed", {});
    res.status(201).json(p);
  });
  route("patch", "/api/projects/:id", async (req, res) => {
    const id = String(req.params.id);
    const data = z
      .object({
        name: z.string().trim().min(2).max(100),
        description: z.string().max(2000),
        archived: z.boolean(),
      })
      .strict()
      .parse(req.body);
    await transaction(async (tx) => {
      await access(tx, req.actor, id, true);
      await tx.project.update({ where: { id }, data });
      await activity(
        tx,
        req.actor.id,
        id,
        data.archived ? "archived the project" : "updated project settings",
      );
    });
    changed(id);
    res.json({ ok: true });
  });
  route("post", "/api/projects/:id/members", async (req, res) => {
    const id = String(req.params.id);
    const data = z
      .object({
        userId: z.string().uuid(),
        isManager: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    await transaction(async (tx) => {
      const p = await access(tx, req.actor, id, true);
      must(
        await tx.user.findFirst({
          where: {
            id: data.userId,
            companyId: req.actor.companyId,
            active: true,
          },
        }),
        400,
        "Select an active account.",
      );
      const old = p.members.find((m) => m.userId === data.userId);
      if (old?.isManager && !data.isManager)
        must(
          p.members.some((m) => m.isManager && m.userId !== data.userId),
          409,
          "Keep at least one project manager.",
        );
      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: id, userId: data.userId } },
        create: { projectId: id, ...data },
        update: { isManager: data.isManager },
      });
      await activity(tx, req.actor.id, id, "updated project membership");
    });
    io.to(`user:${data.userId}`).emit("access:changed", {});
    changed(id);
    res.json({ ok: true });
  });
  route("delete", "/api/projects/:id/members/:userId", async (req, res) => {
    const id = String(req.params.id),
      userId = String(req.params.userId);
    await transaction(async (tx) => {
      const p = await access(tx, req.actor, id, true);
      must(
        !(await tx.task.count({
          where: {
            projectId: id,
            status: { not: "DONE" },
            OR: [{ assigneeId: userId }, { reviewerId: userId }],
          },
        })),
        409,
        "Reassign active tasks and reviews before removing this member.",
      );
      const old = p.members.find((m) => m.userId === userId);
      if (old?.isManager)
        must(
          p.members.some((m) => m.isManager && m.userId !== userId),
          409,
          "Keep at least one project manager.",
        );
      await tx.projectMember.delete({
        where: { projectId_userId: { projectId: id, userId } },
      });
      await activity(tx, req.actor.id, id, "removed a project member");
    });
    evict(userId, id);
    changed(id);
    res.json({ ok: true });
  });
  route("get", "/api/tasks", async (req, res) => {
    const projectId =
      typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    if (projectId) await access(db, req.actor, projectId);
    res.json(
      await db.task.findMany({
        where: {
          ...(projectId ? { projectId } : {}),
          project: {
            companyId: req.actor.companyId,
            ...(req.actor.isAdmin
              ? {}
              : { members: { some: { userId: req.actor.id } } }),
          },
        },
        include: taskInclude,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    );
  });
  route("post", "/api/projects/:id/tasks", async (req, res) => {
    const projectId = String(req.params.id),
      data = taskSchema.parse(req.body);
    const task = await transaction(async (tx) => {
      const p = await access(tx, req.actor, projectId, true);
      must(!p.archived, 409, "Restore the project before changing tasks.");
      await validatePeople(tx, projectId, data.assigneeId, data.reviewerId);
      const last = await tx.task.aggregate({
        where: { projectId },
        _max: { position: true },
      });
      const task = await tx.task.create({
        data: {
          ...data,
          projectId,
          position: (last._max.position || 0) + 1024,
        },
      });
      await activity(tx, req.actor.id, projectId, "created the task", task.id);
      await notification(
        tx,
        task.assigneeId,
        projectId,
        `You were assigned ${p.key}-${task.number}: ${task.title}.`,
        task.id,
      );
      await notification(
        tx,
        task.reviewerId,
        projectId,
        `You were selected to review ${p.key}-${task.number}: ${task.title}.`,
        task.id,
      );
      return task;
    });
    changed(projectId);
    res.status(201).json(task);
  });
  route("get", "/api/tasks/:id", async (req, res) => {
    const { task } = await taskAccess(db, req.actor, String(req.params.id));
    res.json(
      await db.task.findUnique({
        where: { id: task.id },
        include: {
          ...taskInclude,
          comments: {
            include: { user: { select: personSelect } },
            orderBy: { createdAt: "asc" },
          },
          submissions: {
            include: {
              user: { select: personSelect },
              review: { include: { user: { select: personSelect } } },
            },
            orderBy: { revision: "desc" },
          },
          activities: {
            include: { user: { select: personSelect } },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
    );
  });
  const taskMutation = (
    url: string,
    fn: (
      tx: Tx,
      req: AuthRequest,
      task: Task,
      manager: boolean,
    ) => Promise<void>,
  ) =>
    route("post", `/api/tasks/:id/${url}`, async (req, res) => {
      const projectId = await transaction(async (tx) => {
        const { task, project, manager } = await taskAccess(
          tx,
          req.actor,
          String(req.params.id),
        );
        must(
          !project.archived,
          409,
          "Restore the project before changing tasks.",
        );
        await fn(tx, req, task, manager);
        return task.projectId;
      });
      changed(projectId);
      res.json({ ok: true });
    });
  taskMutation("edit", async (tx, req, task, manager) => {
    const { version, ...data } = editSchema.parse(req.body);
    requireEditable(task.status);
    must(
      manager || task.assigneeId === req.actor.id,
      403,
      "Only the assignee or project manager can edit this task.",
    );
    if (!manager)
      must(
        data.assigneeId === task.assigneeId &&
          data.reviewerId === task.reviewerId,
        403,
        "Only the project manager can change assignments.",
      );
    await validatePeople(tx, task.projectId, data.assigneeId, data.reviewerId);
    await changeTask(tx, task, version, data);
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      "updated the task",
      task.id,
    );
    if (data.assigneeId !== task.assigneeId)
      await notification(
        tx,
        data.assigneeId,
        task.projectId,
        `You were assigned task ${task.number}: ${data.title}.`,
        task.id,
      );
    if (data.reviewerId !== task.reviewerId)
      await notification(
        tx,
        data.reviewerId,
        task.projectId,
        `You were selected to review task ${task.number}: ${data.title}.`,
        task.id,
      );
  });
  taskMutation("move", async (tx, req, task, manager) => {
    const data = moveSchema.parse(req.body);
    requireEditable(task.status);
    must(
      manager || task.assigneeId === req.actor.id,
      403,
      "Only the assignee or project manager can move this task.",
    );
    await changeTask(tx, task, data.version, {
      status: data.status,
      position: data.position,
    });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      `moved the task to ${data.status === "TODO" ? "To do" : "In progress"}`,
      task.id,
    );
  });
  taskMutation("submit", async (tx, req, task) => {
    const data = submissionSchema.parse(req.body);
    must(
      task.assigneeId === req.actor.id,
      403,
      "Only the assignee can submit work.",
    );
    must(
      task.status === "IN_PROGRESS",
      409,
      "Start work before submitting it for review.",
    );
    await validatePeople(tx, task.projectId, task.assigneeId, task.reviewerId);
    const unfinished = await tx.checklistItem.count({
      where: { taskId: task.id, done: false },
    });
    must(
      unfinished === 0,
      400,
      "Complete the checklist before requesting review.",
    );
    await changeTask(tx, task, data.version, { status: "REVIEW" });
    const previous = await tx.submission.count({ where: { taskId: task.id } });
    await tx.submission.create({
      data: {
        taskId: task.id,
        userId: req.actor.id,
        revision: previous + 1,
        url: data.url,
        note: data.note,
      },
    });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      `submitted revision ${previous + 1} for review`,
      task.id,
    );
    await notification(
      tx,
      task.reviewerId,
      task.projectId,
      `Review requested for task ${task.number}: ${task.title}.`,
      task.id,
    );
  });
  taskMutation("review", async (tx, req, task) => {
    const data = reviewSchema.parse(req.body);
    requireReviewer(req.actor.id, task.assigneeId, task.reviewerId);
    must(task.status === "REVIEW", 409, "This task is not waiting for review.");
    const submission = await tx.submission.findFirst({
      where: { taskId: task.id },
      orderBy: { revision: "desc" },
    });
    must(submission, 409, "Submission not found.");
    await changeTask(tx, task, data.version, {
      status: data.decision === "APPROVED" ? "DONE" : "IN_PROGRESS",
    });
    await tx.review.create({
      data: {
        submissionId: submission.id,
        userId: req.actor.id,
        decision: data.decision,
        note: data.note,
      },
    });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      data.decision === "APPROVED" ? "approved the work" : "requested changes",
      task.id,
    );
    await notification(
      tx,
      task.assigneeId,
      task.projectId,
      data.decision === "APPROVED"
        ? `Task ${task.number} was approved.`
        : `Changes requested for task ${task.number}.`,
      task.id,
    );
  });
  taskMutation("withdraw", async (tx, req, task) => {
    const { version } = versionSchema.strict().parse(req.body);
    must(
      req.actor.id === task.assigneeId,
      403,
      "Only the assignee can withdraw a submission.",
    );
    must(task.status === "REVIEW", 409, "This task is not waiting for review.");
    const submission = await tx.submission.findFirst({
      where: { taskId: task.id },
      orderBy: { revision: "desc" },
    });
    must(submission, 409, "Submission not found.");
    await changeTask(tx, task, version, { status: "IN_PROGRESS" });
    await tx.review.create({
      data: {
        submissionId: submission.id,
        userId: req.actor.id,
        decision: "WITHDRAWN",
        note: "Withdrawn for editing.",
      },
    });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      "withdrew the submission",
      task.id,
    );
  });
  taskMutation("reopen", async (tx, req, task, manager) => {
    const data = reasonSchema.parse(req.body);
    must(manager, 403, "Only the project manager can reopen tasks.");
    must(task.status === "DONE", 409, "Only completed tasks can be reopened.");
    await validatePeople(tx, task.projectId, task.assigneeId, task.reviewerId);
    await changeTask(tx, task, data.version, { status: "IN_PROGRESS" });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      `reopened the task: ${data.note}`,
      task.id,
    );
    await notification(
      tx,
      task.assigneeId,
      task.projectId,
      `Task ${task.number} was reopened.`,
      task.id,
    );
  });
  taskMutation("comments", async (tx, req, task) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(4000) })
      .strict()
      .parse(req.body);
    await tx.comment.create({
      data: { taskId: task.id, userId: req.actor.id, text },
    });
    await activity(
      tx,
      req.actor.id,
      task.projectId,
      "added a comment",
      task.id,
    );
  });
  taskMutation("checklist", async (tx, req, task, manager) => {
    const data = versionSchema
      .extend({
        id: z.string().uuid().optional(),
        text: z.string().trim().min(1).max(250).optional(),
        done: z.boolean().optional(),
        remove: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    requireEditable(task.status);
    must(
      manager || req.actor.id === task.assigneeId,
      403,
      "Only the assignee or project manager can change the checklist.",
    );
    await changeTask(tx, task, data.version, {});
    if (data.id) {
      must(
        await tx.checklistItem.findFirst({
          where: { id: data.id, taskId: task.id },
        }),
        404,
        "Checklist item not found.",
      );
      if (data.remove)
        await tx.checklistItem.delete({ where: { id: data.id } });
      else
        await tx.checklistItem.update({
          where: { id: data.id },
          data: { text: data.text, done: data.done },
        });
    } else {
      must(data.text, 400, "Checklist text is required.");
      await tx.checklistItem.create({
        data: { taskId: task.id, text: data.text },
      });
    }
  });
  route("get", "/api/activities", async (req, res) =>
    res.json(
      await db.activity.findMany({
        where: {
          project: {
            companyId: req.actor.companyId,
            ...(req.actor.isAdmin
              ? {}
              : { members: { some: { userId: req.actor.id } } }),
          },
        },
        include: {
          user: { select: personSelect },
          project: { select: { name: true, key: true } },
          task: { select: { title: true, number: true } },
        },
        take: 30,
        orderBy: { createdAt: "desc" },
      }),
    ),
  );
  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(cookieName + "="))
        ?.slice(cookieName.length + 1);
      const session = await resolveSession(cookie);
      must(session, 401, "Sign in required.");
      must(
        socket.handshake.auth.csrfToken === session.csrfToken,
        403,
        "Invalid session.",
      );
      socket.data.userId = session.userId;
      socket.data.companyId = session.user.companyId;
      socket.data.sessionId = session.id;
      next();
    } catch {
      next(new Error("Authentication required."));
    }
  });
  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.join(`company:${socket.data.companyId}`);
    socket.on(
      "project:join",
      async (projectId: unknown, callback?: (data: unknown) => void) => {
        try {
          const id = z.string().uuid().parse(projectId);
          const session = await db.session.findUnique({
            where: { id: socket.data.sessionId },
            include: { user: true },
          });
          must(
            session && session.user.active && session.expiresAt > new Date(),
            401,
            "Sign in required.",
          );
          await access(db, session.user, id);
          await socket.join(`project:${id}`);
          if (typeof callback === "function") callback({ ok: true });
        } catch {
          if (typeof callback === "function") callback({ ok: false });
        }
      },
    );
  });
  const sweep = setInterval(async () => {
    try {
      for (const s of io.sockets.sockets.values()) {
        const session = await db.session.findUnique({
          where: { id: s.data.sessionId },
          include: { user: true },
        });
        if (!session || !session.user.active || session.expiresAt <= new Date())
          s.disconnect(true);
      }
    } catch {
      /* A transient database outage is recovered at the next sweep. */
    }
  }, 30000);
  sweep.unref();
  const demoSweep = setInterval(() => {
    void cleanupExpiredDemos().catch(() => undefined);
  }, 3600000);
  demoSweep.unref();
  http.on("close", () => {
    clearInterval(sweep);
    clearInterval(demoSweep);
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const clientDir = path.resolve("dist/client");
  app.use(express.static(clientDir));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(clientDir, "index.html")),
  );
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && "status" in err && err.status === 400)
      return res
        .status(400)
        .json({ error: "Send valid JSON in the request body." });
    if (err instanceof ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => i.message).join(" ") });
    if (err instanceof AppError)
      return res.status(err.status).json({ error: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2034")
        return res
          .status(409)
          .json({ error: "Someone updated this data. Refresh and try again." });
      if (err.code === "P2002")
        return res.status(409).json({ error: "This record already exists." });
      if (err.code === "P2025")
        return res.status(404).json({ error: "Record not found." });
    }
    console.error(
      "Request failed:",
      err instanceof Error ? err.name : "UnknownError",
    );
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return { app, http, io };
}
