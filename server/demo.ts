import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { db } from "./db";

const day = 86400000;

export async function createDemoWorkspace() {
  const suffix = randomUUID();
  const passwordHash = await argon2.hash(randomBytes(32).toString("hex"), {
    type: argon2.argon2id,
  });
  return db.$transaction(
    async (tx) => {
      const company = await tx.company.create({
        data: {
          name: "Northstar Studio demo",
          demoExpiresAt: new Date(Date.now() + day),
        },
      });
      const people = [
        { persona: "manager", name: "Alex Chen", title: "Project Manager" },
        { persona: "developer", name: "Jamie Park", title: "Web Developer" },
        { persona: "reviewer", name: "Sam Rivera", title: "QA Engineer" },
      ] as const;
      const [manager, developer, reviewer] = await Promise.all(
        people.map(({ persona, name, title }) =>
          tx.user.create({
            data: {
              companyId: company.id,
              email: `${suffix}-${persona}@demo.devtrack.invalid`,
              name,
              jobTitle: title,
              demoPersona: persona,
              passwordHash,
              isAdmin: persona === "manager",
            },
          }),
        ),
      );
      const project = await tx.project.create({
        data: {
          companyId: company.id,
          name: "Website launch",
          key: "WEB",
          description:
            "A sample team project. Try assigning, submitting, and reviewing work.",
          members: {
            create: [
              { userId: manager.id, isManager: true },
              { userId: developer.id },
              { userId: reviewer.id },
            ],
          },
        },
      });
      const samples = [
        { title: "Build the landing page", status: "TODO" as const, due: 3 },
        {
          title: "Fix mobile navigation",
          status: "IN_PROGRESS" as const,
          due: -1,
        },
        { title: "Review signup form", status: "REVIEW" as const, due: 2 },
        { title: "Set up project foundation", status: "DONE" as const, due: 1 },
      ];
      let reviewTaskId: string | undefined;
      for (const [index, sample] of samples.entries()) {
        const reviewStarted = new Date(Date.now() - 3 * day);
        const task = await tx.task.create({
          data: {
            projectId: project.id,
            title: sample.title,
            description: "Sample work for the Northstar Studio team.",
            status: sample.status,
            assigneeId: developer.id,
            reviewerId: reviewer.id,
            position: (index + 1) * 1024,
            dueDate: new Date(Date.now() + sample.due * day),
            ...(sample.status === "REVIEW"
              ? { createdAt: reviewStarted, updatedAt: reviewStarted }
              : {}),
          },
        });
        if (sample.status === "REVIEW") reviewTaskId = task.id;
        await tx.activity.create({
          data: {
            userId: manager.id,
            projectId: project.id,
            taskId: task.id,
            text: "created the task",
          },
        });
        if (sample.status === "REVIEW" || sample.status === "DONE") {
          const submission = await tx.submission.create({
            data: {
              taskId: task.id,
              userId: developer.id,
              revision: 1,
              url: "https://example.com/demo-work",
              note: "Sample implementation ready for review.",
              ...(sample.status === "REVIEW"
                ? { createdAt: reviewStarted }
                : {}),
            },
          });
          if (sample.status === "DONE")
            await tx.review.create({
              data: {
                submissionId: submission.id,
                userId: reviewer.id,
                decision: "APPROVED",
                note: "Looks good.",
              },
            });
        }
      }
      await tx.notification.create({
        data: {
          recipientId: reviewer.id,
          projectId: project.id,
          taskId: reviewTaskId,
          text: "Review signup form is waiting for your decision.",
        },
      });
      return { company, user: manager };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    },
  );
}

export async function cleanupExpiredDemos() {
  const expired = await db.company.findMany({
    where: { demoExpiresAt: { lt: new Date() } },
    select: { id: true },
    take: 20,
  });
  for (const { id: companyId } of expired) {
    await db.$transaction(
      async (tx) => {
        await tx.notification.deleteMany({ where: { project: { companyId } } });
        await tx.review.deleteMany({
          where: { submission: { task: { project: { companyId } } } },
        });
        await tx.submission.deleteMany({
          where: { task: { project: { companyId } } },
        });
        await tx.comment.deleteMany({
          where: { task: { project: { companyId } } },
        });
        await tx.checklistItem.deleteMany({
          where: { task: { project: { companyId } } },
        });
        await tx.activity.deleteMany({ where: { project: { companyId } } });
        await tx.task.deleteMany({ where: { project: { companyId } } });
        await tx.projectMember.deleteMany({
          where: { project: { companyId } },
        });
        await tx.project.deleteMany({ where: { companyId } });
        await tx.invitation.deleteMany({ where: { companyId } });
        await tx.session.deleteMany({ where: { user: { companyId } } });
        await tx.user.deleteMany({ where: { companyId } });
        await tx.company.deleteMany({
          where: { id: companyId, demoExpiresAt: { lt: new Date() } },
        });
      },
      { timeout: 20000 },
    );
  }
}
