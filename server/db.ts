import "dotenv/config";
import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();
export const personSelect = {
  id: true,
  name: true,
  email: true,
  jobTitle: true,
  isAdmin: true,
  active: true,
} as const;
export const taskInclude = {
  assignee: { select: personSelect },
  reviewer: { select: personSelect },
  project: { select: { key: true, name: true } },
  checklist: true,
  _count: { select: { comments: true } },
} as const;
export const projectInclude = {
  members: { include: { user: { select: personSelect } } },
  _count: { select: { tasks: true } },
} as const;
