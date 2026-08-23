/**
 * Coverage for lexical integer parsing of gateway-discord env vars.
 */
import { describe, expect, it } from "vitest";
import { invalidIntegerEnvError, parseIntegerEnvValue } from "./integer-env.js";

describe("parseIntegerEnvValue", () => {
  it("returns undefined when unset", () => {
    expect(parseIntegerEnvValue("TEST_INT", undefined)).toBeUndefined();
  });

  it("parses valid integers", () => {
    expect(parseIntegerEnvValue("TEST_INT", "0")).toBe(0);
    expect(parseIntegerEnvValue("TEST_INT", "42")).toBe(42);
    expect(parseIntegerEnvValue("TEST_INT", "-5")).toBe(-5);
    expect(parseIntegerEnvValue("TEST_INT", "+10")).toBe(10);
    expect(parseIntegerEnvValue("TEST_INT", "  123  ")).toBe(123);
  });

  it("parses safe-integer boundaries", () => {
    expect(
      parseIntegerEnvValue("TEST_INT", String(Number.MAX_SAFE_INTEGER)),
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      parseIntegerEnvValue("TEST_INT", String(Number.MIN_SAFE_INTEGER)),
    ).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("throws for non-integer strings", () => {
    expect(() => parseIntegerEnvValue("TEST_INT", "3600junk")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "3.14")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "NaN")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", " ")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "12 34")).toThrow();
  });

  it("throws for out-of-safe-integer range", () => {
    expect(() =>
      parseIntegerEnvValue("TEST_INT", "9007199254740992"),
    ).toThrow();
    expect(() =>
      parseIntegerEnvValue("TEST_INT", "-9007199254740992"),
    ).toThrow();
    expect(() =>
      parseIntegerEnvValue("TEST_INT", "99999999999999999999"),
    ).toThrow();
  });

  it("throws for float-like and hex-like", () => {
    expect(() => parseIntegerEnvValue("TEST_INT", "0x10")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "1e3")).toThrow();
    expect(() => parseIntegerEnvValue("TEST_INT", "Infinity")).toThrow();
  });

  it("error contains code and context", () => {
    try {
      parseIntegerEnvValue("MY_VAR", "bad");
    } catch (err) {
      const e = err as Error & {
        code?: string;
        context?: Record<string, unknown>;
      };
      expect(e.code).toBe("INVALID_GATEWAY_INTEGER_ENV");
      expect(e.context?.envKey).toBe("MY_VAR");
      expect(e.context?.configured).toBe("bad");
      return;
    }
    throw new Error("should have thrown");
  });
});

describe("invalidIntegerEnvError", () => {
  it("builds ElizaError with code and context", () => {
    const err = invalidIntegerEnvError("PORT", "abc", "not an integer", {
      extra: 1,
    });
    expect(err.message).toContain("Invalid PORT");
    expect(err.code).toBe("INVALID_GATEWAY_INTEGER_ENV");
    expect(err.context?.envKey).toBe("PORT");
    expect(err.context?.configured).toBe("abc");
    expect(err.context?.extra).toBe(1);
    expect(err.severity).toBe("fatal");
  });
});
