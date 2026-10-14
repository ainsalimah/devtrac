import type { TaskDTO } from "../shared/contracts";

export function projectProgress(
  tasks: Pick<TaskDTO, "status" | "dueDate" | "updatedAt">[],
  now = Date.now(),
) {
  const counts = { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 };
  let overdue = 0;
  let waitingReview = 0;
  for (const task of tasks) {
    counts[task.status]++;
    if (
      task.status !== "DONE" &&
      task.dueDate &&
      new Date(task.dueDate).getTime() < now
    )
      overdue++;
    if (
      task.status === "REVIEW" &&
      new Date(task.updatedAt).getTime() < now - 48 * 3600000
    )
      waitingReview++;
  }
  return {
    ...counts,
    total: tasks.length,
    overdue,
    waitingReview,
    percent: tasks.length ? Math.round((counts.DONE / tasks.length) * 100) : 0,
  };
}
