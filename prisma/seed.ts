import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
const db = new PrismaClient();
export async function seed() {
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error("Set DEMO_PASSWORD before seeding.");
  const company = await db.company.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Studio workspace",
    },
  });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const definitions = [
    ["admin", "Morgan Lee", true],
    ["manager", "Alex Chen", false],
    ["developer", "Jamie Park", false],
    ["reviewer", "Sam Rivera", false],
    ["outsider", "Taylor Brooks", false],
  ] as const;
  const users = [];
  for (const [key, name, isAdmin] of definitions)
    users.push(
      await db.user.upsert({
        where: { email: `${key}@devtrack.demo` },
        update: {},
        create: {
          companyId: company.id,
          email: `${key}@devtrack.demo`,
          name,
          isAdmin,
          passwordHash,
        },
      }),
    );
  const [admin, manager, developer, reviewer, outsider] = users;
  if (
    await db.project.findUnique({
      where: { companyId_key: { companyId: company.id, key: "WEB" } },
    })
  )
    return;
  const p = await db.project.create({
    data: {
      companyId: company.id,
      key: "WEB",
      name: "Website redesign",
      description:
        "A faster, clearer home for our product. Design, build, and ship the next website together.",
      members: {
        create: [
          { userId: manager.id, isManager: true },
          { userId: developer.id },
          { userId: reviewer.id },
        ],
      },
    },
  });
  await db.project.create({
    data: {
      companyId: company.id,
      key: "OPS",
      name: "Internal operations",
      description: "A private workspace for internal tools and operations.",
      members: { create: [{ userId: outsider.id, isManager: true }] },
    },
  });
  const names = [
    "Build the account settings page",
    "Fix navigation on small screens",
    "Create the component library",
    "Add form validation to sign up",
    "Improve keyboard navigation",
    "Implement the pricing section",
    "Review responsive breakpoints",
    "Set up project foundations",
  ];
  const descriptions = [
    "Give members a clear place to manage their profile. Include friendly validation and loading states.",
    "The mobile navigation should close after choosing a link and keep focus predictable.",
    "Create reusable buttons, inputs, and status badges with consistent spacing.",
    "Validate required fields and show errors next to the relevant input.",
    "Make the main navigation and dialogs fully usable without a mouse.",
    "Build a clear comparison of the available plans with responsive cards.",
    "Check the layout at mobile, tablet, and desktop sizes.",
    "Configure the application, code quality checks, and development workflow.",
  ];
  for (let i = 0; i < names.length; i++) {
    const status =
      i < 2 ? "TODO" : i < 5 ? "IN_PROGRESS" : i < 7 ? "REVIEW" : "DONE";
    const task = await db.task.create({
      data: {
        projectId: p.id,
        title: names[i],
        description: descriptions[i],
        status,
        priority: i === 1 || i === 3 ? "HIGH" : i === 7 ? "LOW" : "MEDIUM",
        type: i === 1 ? "BUG" : "TASK",
        assigneeId: developer.id,
        reviewerId: reviewer.id,
        position: (i + 1) * 1024,
        dueDate: new Date(Date.now() + (i === 1 ? -1 : i + 2) * 86400000),
        checklist: {
          create: [
            { text: "Check desktop and mobile layouts", done: i >= 5 },
            { text: "Verify keyboard interaction", done: i >= 5 },
          ],
        },
      },
    });
    await db.activity.create({
      data: {
        projectId: p.id,
        taskId: task.id,
        userId: manager.id,
        text: "created the task",
      },
    });
    if (status === "REVIEW" || status === "DONE") {
      const s = await db.submission.create({
        data: {
          taskId: task.id,
          userId: developer.id,
          revision: 1,
          url: "https://github.com/example/devtrack-demo",
          note: "Implementation is ready. Please check the layout and keyboard behavior.",
        },
      });
      if (status === "DONE")
        await db.review.create({
          data: {
            submissionId: s.id,
            userId: reviewer.id,
            decision: "APPROVED",
            note: "Verified. Ready to ship.",
          },
        });
    }
  }
  await db.activity.create({
    data: { projectId: p.id, userId: admin.id, text: "created the workspace" },
  });
}
seed()
  .then(() =>
    console.log("Demo data ready: five fictional accounts, two projects."),
  )
  .finally(() => db.$disconnect());
