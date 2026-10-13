export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireCondition(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
export function requireEditable(status: string) {
  requireCondition(
    status === "TODO" || status === "IN_PROGRESS",
    409,
    "Withdraw the review or reopen this task before editing.",
  );
}
export function requireReviewer(
  actorId: string,
  assigneeId: string,
  reviewerId: string,
) {
  requireCondition(
    actorId === reviewerId && actorId !== assigneeId,
    403,
    "Only the assigned reviewer can decide this review.",
  );
}
