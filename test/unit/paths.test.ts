import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizePath } from "../../packages/cli/src/paths.js";
import { sep } from "node:path";

describe("normalizePath", () => {
  it("resolves relative paths to absolute", () => {
    const result = normalizePath("./foo/bar");
    expect(result).toContain("foo/bar");
    // Should be absolute
    expect(result).toMatch(/^[A-Z]:\//i); // Windows: C:/... or posix: /...
  });

  it("normalizes backslashes to forward slashes", () => {
    const result = normalizePath("foo\\bar\\baz");
    expect(result).not.toContain("\\");
    expect(result).toContain("foo/bar/baz");
  });

  it("expands ~ to home directory", () => {
    const result = normalizePath("~/.pi");
    expect(result).toContain(".pi");
    expect(result.startsWith("~")).toBe(false);
  });

  it("handles Git Bash /c/ style paths", () => {
    const result = normalizePath("/c/dev/project");
    // On Windows, this should become C:/dev/project
    // On Linux, /c/dev/project stays as-is (it's already absolute)
    if (process.platform === "win32") {
      expect(result).toMatch(/^C:\/dev\/project/i);
    } else {
      expect(result).toContain("/c/dev/project");
    }
  });

  it("handles already-absolute Windows paths", () => {
    if (process.platform === "win32") {
      const result = normalizePath("C:\\dev\\project");
      expect(result).toBe("C:/dev/project");
    }
  });

  it("handles already-absolute posix paths", () => {
    if (process.platform !== "win32") {
      const result = normalizePath("/home/user/project");
      expect(result).toBe("/home/user/project");
    }
  });

  it("handles paths with spaces", () => {
    const result = normalizePath("./my project/src");
    expect(result).toContain("my project/src");
  });
});
