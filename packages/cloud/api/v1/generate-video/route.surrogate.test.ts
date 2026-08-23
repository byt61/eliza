/**
 * Surrogate-safe truncation for generate-video provider error (500).
 * Asserts on the route's exported helper so the test fails if the route regresses.
 */
import { describe, expect, it } from "vitest";
import { formatVideoProviderError } from "./route.ts";

describe("generate-video surrogate-safe", () => {
  it("does not split astral at 500", () => {
    const text = "x".repeat(499) + "🦊" + "y".repeat(10);
    const out = formatVideoProviderError(text);
    expect(out).toBe("x".repeat(499));
    expect(out.length).toBe(499);
  });

  it("replaces lone surrogate", () => {
    const out = formatVideoProviderError("a\uD800b");
    expect(out).toBe("a\uFFFDb");
  });

  it("caps at 500", () => {
    const out = formatVideoProviderError("a".repeat(800));
    expect(out.length).toBe(500);
  });

  it("old slice would split surrogate but guard does not", () => {
    const text = "x".repeat(499) + "🦊";
    const old = text.slice(0, 500);
    expect(old.charCodeAt(499)).toBe(0xd83e);
    const fixed = formatVideoProviderError(text);
    expect(fixed.length).toBe(499);
    expect(fixed).not.toContain("\uD800");
  });
});
