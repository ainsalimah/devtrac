import type { Person } from "../shared/contracts";
export interface Auth {
  user: Person;
  csrfToken: string;
}
let csrf = "";
export const setCsrf = (token: string) => {
  csrf = token;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch("/api" + url, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-DevTrack-Request": "1",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error || "Request failed.");
  return data;
}
