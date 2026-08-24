/**
 * Unit tests for Stainless SDK and Claude Code identity header generation,
 * validating expected headers, OS and architecture mappings, and session ID.
 */
import { describe, expect, it } from "vitest";
import { INSTANCE_SESSION_ID } from "../src/proxy/process-body.js";
import { getStainlessHeaders } from "../src/proxy/stainless-headers.ts";

describe("stainless-headers", () => {
  it("generates complete set of expected Stainless SDK headers", () => {
    const headers = getStainlessHeaders();

    const expectedOs =
      process.platform === "darwin"
        ? "macOS"
        : process.platform === "win32"
          ? "Windows"
          : process.platform === "linux"
            ? "Linux"
            : process.platform;
    const expectedArch =
      process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;

    expect(headers["user-agent"]).toContain("claude-cli/");
    expect(headers["x-app"]).toBe("cli");
    expect(headers["x-stainless-lang"]).toBe("js");
    expect(headers["x-stainless-package-version"]).toBe("0.81.0");
    expect(headers["x-stainless-runtime"]).toBe("node");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["x-claude-code-session-id"]).toBe(INSTANCE_SESSION_ID);
    expect(headers["x-stainless-os"]).toBe(expectedOs);
    expect(headers["x-stainless-arch"]).toBe(expectedArch);
  });
});
