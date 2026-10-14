import { describe, expect, it } from "vitest";
import { projectProgress } from "../src/progress";

describe("project progress", () => {
  it("counts overdue active work and reviews waiting longer than two days", () => {
    const now = new Date("2026-10-14T12:00:00Z").getTime();
    const task = (
      status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE",
      dueDate: string | null,
      updatedAt: string,
    ) => ({ status, dueDate, updatedAt });
    const result = projectProgress(
      [
        task("TODO", "2026-10-13T12:00:00Z", "2026-10-14T11:00:00Z"),
        task("REVIEW", "2026-10-15T12:00:00Z", "2026-10-11T12:00:00Z"),
        task("DONE", "2026-10-10T12:00:00Z", "2026-10-14T11:00:00Z"),
      ],
      now,
    );
    expect(result).toMatchObject({
      total: 3,
      TODO: 1,
      REVIEW: 1,
      DONE: 1,
      overdue: 1,
      waitingReview: 1,
      percent: 33,
    });
  });
});
