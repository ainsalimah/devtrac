import { createContext, useContext } from "react";
import type { Auth } from "./api";
import type { Person, ProjectDTO } from "../shared/contracts";
export const WorkspaceContext = createContext<{
  auth: Auth;
  projects: ProjectDTO[];
  users: Person[];
  notify: (text: string) => void;
}>({} as never);
export const useWorkspace = () => useContext(WorkspaceContext);
export const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
export const prettyDate = (date: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "No due date";
export const timeAgo = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? "avatar-small" : ""}`} title={name}>
      {initials(name)}
    </span>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error-box">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
