import { z } from "zod";
export const statuses = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export const statusLabels = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  REVIEW: "In review",
  DONE: "Done",
};
export const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const password = z.string().min(12).max(128);
export const loginSchema = z
  .object({ email, password: z.string().min(1).max(128) })
  .strict();
export const acceptSchema = z
  .object({
    token: z.string().min(32).max(128),
    name: z.string().trim().min(2).max(80),
    password,
  })
  .strict();
export const registerSchema = z
  .object({
    companyName: z.string().trim().min(2).max(100),
    name: z.string().trim().min(2).max(80),
    email,
    password,
  })
  .strict();
export const projectSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    key: z.string().regex(/^[A-Z]{2,6}$/),
    description: z.string().max(2000).default(""),
    managerId: z.string().uuid(),
  })
  .strict();
export const taskFields = {
  title: z.string().trim().min(3).max(160),
  description: z.string().max(10000).default(""),
  type: z.enum(["TASK", "BUG"]).default("TASK"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  assigneeId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  dueDate: z.string().datetime().nullable().default(null),
};
export const taskSchema = z
  .object(taskFields)
  .strict()
  .refine(
    (t) => t.assigneeId !== t.reviewerId,
    "Assignee and reviewer must be different people.",
  );
export const versionSchema = z.object({ version: z.number().int().positive() });
export const editSchema = z
  .object({ ...taskFields, version: z.number().int().positive() })
  .strict()
  .refine(
    (t) => t.assigneeId !== t.reviewerId,
    "Assignee and reviewer must be different people.",
  );
export const moveSchema = versionSchema
  .extend({
    status: z.enum(["TODO", "IN_PROGRESS"]),
    position: z.number().finite().min(0).max(1e12),
  })
  .strict();
export const submissionSchema = versionSchema
  .extend({
    url: z
      .string()
      .url()
      .max(2000)
      .refine((s) => {
        try {
          return ["http:", "https:"].includes(new URL(s).protocol);
        } catch {
          return false;
        }
      }, "Use an HTTP or HTTPS link."),
    note: z.string().trim().min(1).max(4000),
  })
  .strict();
export const reviewSchema = versionSchema
  .extend({
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
    note: z.string().trim().max(4000),
  })
  .strict()
  .refine(
    (x) => x.decision === "APPROVED" || x.note.length > 0,
    "Explain the requested changes.",
  );
export const reasonSchema = versionSchema
  .extend({ note: z.string().trim().min(1).max(4000) })
  .strict();
export interface Person {
  id: string;
  name: string;
  email: string;
  active: boolean;
  isAdmin: boolean;
}
export interface Membership {
  userId: string;
  isManager: boolean;
  user: Person;
}
export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
  description: string;
  archived: boolean;
  members: Membership[];
  _count: { tasks: number };
}
export interface TaskDTO {
  id: string;
  number: number;
  projectId: string;
  title: string;
  description: string;
  type: "TASK" | "BUG";
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: (typeof statuses)[number];
  position: number;
  version: number;
  dueDate: string | null;
  assigneeId: string;
  reviewerId: string;
  assignee: Person;
  reviewer: Person;
  project: { key: string; name: string };
  checklist: { id: string; text: string; done: boolean }[];
  _count: { comments: number };
  updatedAt: string;
}
export interface TaskDetail extends TaskDTO {
  comments: { id: string; text: string; user: Person; createdAt: string }[];
  submissions: {
    id: string;
    revision: number;
    url: string;
    note: string;
    createdAt: string;
    user: Person;
    review: null | {
      decision: string;
      note: string;
      user: Person;
      createdAt: string;
    };
  }[];
  activities: { id: string; text: string; user: Person; createdAt: string }[];
}
