import { describe, it, expect } from "vitest";
import { requireEditable, requireReviewer } from "../server/policy";
import {
  moveSchema,
  submissionSchema,
  reviewSchema,
} from "../shared/contracts";
describe("workflow invariants", () => {
  it("returns validation errors rather than exceptions for malformed URLs", () => {
    for (const url of ["not a URL", "", "/relative/path"]) {
      expect(
        submissionSchema.safeParse({ version: 1, url, note: "Test" }).success,
      ).toBe(false);
    }
  });
  it("locks work in review and done", () => {
    expect(() => requireEditable("REVIEW")).toThrow();
    expect(() => requireEditable("DONE")).toThrow();
    expect(() => requireEditable("IN_PROGRESS")).not.toThrow();
  });
  it("rejects self approval and a different reviewer", () => {
    expect(() => requireReviewer("a", "a", "a")).toThrow();
    expect(() => requireReviewer("c", "a", "b")).toThrow();
    expect(() => requireReviewer("b", "a", "b")).not.toThrow();
  });
  it("cannot move directly to Done or Review", () => {
    for (const status of ["REVIEW", "DONE"])
      expect(
        moveSchema.safeParse({ version: 1, status, position: 10 }).success,
      ).toBe(false);
  });
  it("requires HTTP links and explanatory changes requests", () => {
    expect(
      submissionSchema.safeParse({
        version: 1,
        url: "javascript:alert(1)",
        note: "test",
      }).success,
    ).toBe(false);
    expect(
      reviewSchema.safeParse({
        version: 1,
        decision: "CHANGES_REQUESTED",
        note: "",
      }).success,
    ).toBe(false);
  });
});
