import "dotenv/config";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Person, ProjectDTO, TaskDTO } from "../../shared/contracts";
const password = process.env.DEMO_PASSWORD!;
const screenshotDir = "docs/screenshots";
async function login(page: Page, role: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(`${role}@devtrack.demo`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
}
async function session(context: BrowserContext) {
  const r = await context.request.get("/api/auth/me");
  return r.json();
}
async function mutate(context: BrowserContext, url: string, body: unknown) {
  const me = await session(context);
  return context.request.post("/api" + url, {
    data: body,
    headers: { "X-DevTrack-Request": "1", "X-CSRF-Token": me.csrfToken },
  });
}
async function projects(context: BrowserContext): Promise<ProjectDTO[]> {
  return (await context.request.get("/api/projects")).json();
}
async function newTask(context: BrowserContext, title: string) {
  const p = (await projects(context)).find((p) => p.key === "WEB")!;
  const users: Person[] = await (
    await context.request.get("/api/users")
  ).json();
  const r = await mutate(context, `/projects/${p.id}/tasks`, {
    title,
    assigneeId: users.find((u) => u.email === "developer@devtrack.demo")!.id,
    reviewerId: users.find((u) => u.email === "reviewer@devtrack.demo")!.id,
  });
  expect(r.ok()).toBeTruthy();
  return { task: (await r.json()) as TaskDTO, project: p };
}

test("manager board, task detail and responsive workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "manager");
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: `${screenshotDir}/overview.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: "W Website redesign" }).click();
  await expect(
    page.getByRole("button", {
      name: "Build the account settings page",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/board.png`, fullPage: true });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page
    .getByRole("button", {
      name: "Build the account settings page",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/task-detail.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "My tasks", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "My tasks", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${screenshotDir}/mobile.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("admin creates a project, manager assigns work, developer and reviewer finish two revisions", async ({
  browser,
}) => {
  const adminContext = await browser.newContext(),
    managerContext = await browser.newContext(),
    devContext = await browser.newContext(),
    reviewContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    manager = await managerContext.newPage(),
    dev = await devContext.newPage(),
    reviewer = await reviewContext.newPage();
  try {
    await login(admin, "admin");
    await admin.getByRole("link", { name: /^Projects/ }).click();
    await admin.getByRole("button", { name: "New project" }).click();
    await admin.getByLabel("Project name").fill("Release workspace");
    await admin.getByLabel("Project key").fill("REL");
    await admin
      .getByLabel("Description", { exact: true })
      .fill("Browser-tested delivery workflow");
    await admin
      .getByRole("combobox", { name: "Project manager", exact: true })
      .selectOption({ label: "Alex Chen" });
    await admin
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(admin.getByRole("dialog")).not.toBeVisible();
    await login(manager, "manager");
    await manager.getByRole("link", { name: "R Release workspace" }).click();
    await manager.getByRole("button", { name: "Project settings" }).click();
    await manager
      .getByLabel("Add project member")
      .selectOption({ label: "Jamie Park" });
    await manager.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      manager.locator(".member-settings").getByText("Jamie Park"),
    ).toBeVisible();
    await manager
      .getByLabel("Add project member")
      .selectOption({ label: "Sam Rivera" });
    await manager.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      manager.locator(".member-settings").getByText("Sam Rivera"),
    ).toBeVisible();
    await manager.keyboard.press("Escape");
    await manager.getByRole("button", { name: "New task" }).click();
    await manager
      .getByLabel("Title", { exact: true })
      .fill("Ship accessible account settings");
    await manager
      .getByLabel("Description", { exact: true })
      .fill("Verify form labels and review feedback.");
    await manager
      .getByRole("combobox", { name: "Assignee", exact: true })
      .selectOption({ label: "Jamie Park" });
    await manager
      .getByRole("combobox", { name: "Reviewer", exact: true })
      .selectOption({ label: "Sam Rivera" });
    await manager
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(manager.getByRole("dialog")).not.toBeVisible();
    await login(dev, "developer");
    await dev.getByRole("link", { name: "R Release workspace" }).click();
    await dev
      .getByRole("button", {
        name: "Ship accessible account settings",
        exact: true,
      })
      .click();
    await dev
      .getByLabel("Move task", { exact: true })
      .selectOption("IN_PROGRESS");
    await expect(
      dev.getByRole("heading", { name: "Ready for review?" }),
    ).toBeVisible();
    await dev
      .getByLabel("Work link", { exact: true })
      .fill("https://example.com/account-settings");
    await dev
      .getByLabel("Submission notes")
      .fill("Please check keyboard navigation.");
    await dev
      .getByRole("button", { name: "Request review", exact: true })
      .click();
    await expect(
      dev.getByRole("button", { name: "Withdraw submission" }),
    ).toBeVisible();
    await login(reviewer, "reviewer");
    await reviewer.getByRole("link", { name: "R Release workspace" }).click();
    await reviewer
      .getByRole("button", {
        name: "Ship accessible account settings",
        exact: true,
      })
      .click();
    await reviewer
      .getByLabel("Review notes")
      .fill("Add a clear focus indicator to the Save button.");
    await reviewer
      .getByRole("button", { name: "Request changes", exact: true })
      .click();
    await expect(
      dev.getByRole("heading", { name: "Ready for review?" }),
    ).toBeVisible();
    await dev
      .getByLabel("Work link", { exact: true })
      .fill("https://example.com/account-settings-v2");
    await dev
      .getByLabel("Submission notes")
      .fill("Added and tested the focus indicator.");
    await dev
      .getByRole("button", { name: "Request review", exact: true })
      .click();
    await expect(
      reviewer.getByRole("button", { name: "Approve work" }),
    ).toBeVisible();
    await reviewer
      .getByLabel("Review notes")
      .fill("Verified keyboard behavior.");
    await reviewer.getByRole("button", { name: "Approve work" }).click();
    await expect(dev.getByText("Reviewed and complete.")).toBeVisible();
    await dev.reload();
    await dev
      .getByRole("button", {
        name: "Ship accessible account settings",
        exact: true,
      })
      .click();
    await dev.getByRole("button", { name: /^Submissions/ }).click();
    await expect(dev.getByText("Revision 2", { exact: true })).toBeVisible();
    await expect(
      dev.getByText("Changes requested", { exact: true }),
    ).toBeVisible();
    await dev.screenshot({
      path: `${screenshotDir}/review-workflow.png`,
      fullPage: true,
    });
  } finally {
    await Promise.all([
      adminContext.close(),
      managerContext.close(),
      devContext.close(),
      reviewContext.close(),
    ]);
  }
});
test("reconnect fetches missed changes in a second browser", async ({
  browser,
}) => {
  const mc = await browser.newContext(),
    dc = await browser.newContext();
  const m = await mc.newPage(),
    d = await dc.newPage();
  try {
    await login(m, "manager");
    await login(d, "developer");
    const { project } = await newTask(mc, "Reconnect synchronization check");
    await d.goto(`/projects/${project.id}`);
    await expect(
      d.getByRole("button", {
        name: "Reconnect synchronization check",
        exact: true,
      }),
    ).toBeVisible();
    await dc.setOffline(true);
    const { task } = await newTask(mc, "Created while teammate was offline");
    await dc.setOffline(false);
    await expect(
      d.getByRole("button", { name: task.title, exact: true }),
    ).toBeVisible();
  } finally {
    await mc.close();
    await dc.close();
  }
});
test("failed drag save rolls the card back and shows the failure", async ({
  page,
  context,
}) => {
  await login(page, "manager");
  const { task, project } = await newTask(
    context,
    "Rollback on network failure",
  );
  await page.goto(`/projects/${project.id}`);
  const card = page.getByTestId(`card-${task.id}`);
  await expect(card).toBeVisible();
  await page.getByLabel("Search tasks").fill(task.title);
  await page.route(`**/api/tasks/${task.id}/move`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Simulated save failure." }),
    }),
  );
  const handle = card.getByRole("button", { name: `Drag ${task.title}` });
  const box = await handle.boundingBox();
  const target = page.locator(".board-column").nth(1);
  const targetBox = await target.boundingBox();
  if (!box || !targetBox) throw new Error("Drag targets unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 100, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(
    page.getByRole("status").filter({ hasText: "Simulated save failure." }),
  ).toBeVisible();
  await expect(
    page.locator(".board-column").nth(0).getByTestId(`card-${task.id}`),
  ).toBeVisible();
});
test("keyboard can navigate the task dialog and error/empty search states work", async ({
  page,
}) => {
  await login(page, "developer");
  await page.getByRole("link", { name: "W Website redesign" }).click();
  const search = page.getByLabel("Search tasks");
  await search.fill("no-such-task-78342");
  await expect(page.getByText("No tasks here yet")).toHaveCount(4);
  await search.fill("Build the account settings");
  await page
    .getByRole("button", {
      name: "Build the account settings page",
      exact: true,
    })
    .press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(
    await page
      .locator('[role="dialog"]')
      .evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("private project cannot be opened by an outsider through the address bar", async ({
  browser,
}) => {
  const mc = await browser.newContext(),
    oc = await browser.newContext();
  const m = await mc.newPage(),
    o = await oc.newPage();
  try {
    await login(m, "manager");
    const p = (await projects(mc)).find((p) => p.key === "WEB")!;
    await login(o, "outsider");
    await o.goto(`/projects/${p.id}`);
    await expect(o.getByRole("alert")).toHaveText("Project not found.");
  } finally {
    await mc.close();
    await oc.close();
  }
});

test("admin invitation creates a real account and cannot be reused", async ({
  browser,
}) => {
  const adminContext = await browser.newContext(),
    guestContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    guest = await guestContext.newPage();
  try {
    await login(admin, "admin");
    await admin.getByRole("link", { name: "Members", exact: true }).click();
    await admin.getByRole("button", { name: "Invite member" }).click();
    await admin
      .getByRole("dialog")
      .getByLabel("Email address")
      .fill("invited@devtrack.demo");
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const link = admin.getByLabel("Invitation link", { exact: true });
    await expect(link).toBeVisible();
    const url = await link.inputValue();
    await guest.goto(url);
    await guest.getByLabel("Your name").fill("Riley Guest");
    await guest.getByLabel("Password", { exact: true }).fill(password);
    await guest.getByRole("button", { name: "Create account" }).click();
    await expect(
      guest.getByText("Account created. You can sign in now."),
    ).toBeVisible();
    await guest.getByLabel("Email address").fill("invited@devtrack.demo");
    await guest.getByLabel("Password", { exact: true }).fill(password);
    await guest.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: "A clear view of what’s next." }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Sign out" }).click();
    await guest.goto(url);
    await guest.getByLabel("Your name").fill("Another Guest");
    await guest.getByLabel("Password", { exact: true }).fill(password);
    await guest.getByRole("button", { name: "Create account" }).click();
    await expect(guest.getByRole("alert")).toHaveText(
      "This invitation is invalid or has expired.",
    );
  } finally {
    await adminContext.close();
    await guestContext.close();
  }
});

test("new company owner creates a private workspace and invites a teammate", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const teammateContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const teammate = await teammateContext.newPage();
  try {
    await owner.goto("/register");
    await expect(
      owner.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
    await owner.getByLabel("Company name").fill("Northstar Labs");
    await owner.getByLabel("Your name").fill("Avery Owner");
    await owner.getByLabel("Email address").fill("owner@northstar.demo");
    await owner.getByLabel("Password", { exact: true }).fill(password);
    await owner.screenshot({
      path: `${screenshotDir}/company-registration.png`,
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Create workspace" }).click();
    await expect(
      owner.getByRole("heading", { name: "A clear view of what’s next." }),
    ).toBeVisible();
    await expect(owner.getByText("Northstar Labs").first()).toBeVisible();
    expect(await projects(ownerContext)).toEqual([]);
    expect(
      (await (await ownerContext.request.get("/api/users")).json()).map(
        (u: Person) => u.email,
      ),
    ).toEqual(["owner@northstar.demo"]);
    await owner.getByRole("link", { name: "Projects", exact: false }).click();
    await owner.getByRole("button", { name: "New project" }).click();
    await owner.getByLabel("Project name").fill("Customer portal");
    await owner.getByLabel("Project key").fill("WEB");
    await owner
      .getByLabel("Description")
      .fill("A shared place to build the portal.");
    await owner
      .getByLabel("Project manager")
      .selectOption({ label: "Avery Owner" });
    await owner.getByRole("button", { name: "Create project" }).click();
    await expect(
      owner.getByRole("link", { name: /Customer portal/ }).first(),
    ).toBeVisible();
    const ownProjects = await projects(ownerContext);
    expect(ownProjects).toHaveLength(1);
    expect(ownProjects[0].key).toBe("WEB");
    await owner.getByRole("link", { name: "Members" }).click();
    await owner.getByRole("button", { name: "Invite member" }).click();
    await owner
      .getByRole("dialog")
      .getByLabel("Email address")
      .fill("teammate@northstar.demo");
    await owner.getByRole("button", { name: "Create invitation" }).click();
    const url = await owner
      .getByLabel("Invitation link", { exact: true })
      .inputValue();
    await teammate.goto(url);
    await teammate.getByLabel("Your name").fill("Casey Member");
    await teammate.getByLabel("Password", { exact: true }).fill(password);
    await teammate.getByRole("button", { name: "Create account" }).click();
    await teammate.getByLabel("Email address").fill("teammate@northstar.demo");
    await teammate.getByLabel("Password", { exact: true }).fill(password);
    await teammate
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(
      teammate.getByRole("heading", { name: "A clear view of what’s next." }),
    ).toBeVisible();
    expect((await session(teammateContext)).workspace.id).toBe(
      (await session(ownerContext)).workspace.id,
    );
    expect(await projects(teammateContext)).toEqual([]);
  } finally {
    await ownerContext.close();
    await teammateContext.close();
  }
});
