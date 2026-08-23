/**
 * Behavioral regression for error-policy J2 on registry-client getConfiguredEndpoints.
 * Calls real getConfiguredEndpoints covering success, failure (wrapped ElizaError with cause),
 * invalid input, and concurrency. Proves no swallow to [] and that cause is preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ElizaError } from "@elizaos/core";

describe("registry-client J2 error handling", () => {
  let originalLoad: any;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("getConfiguredEndpoints success returns list and does not throw", async () => {
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => ({ plugins: { registryEndpoints: [{ label: "test", url: "https://example.com", enabled: true }] } }),
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    const res = mod.getConfiguredEndpoints();
    expect(res).toEqual([{ label: "test", url: "https://example.com", enabled: true }]);
  });

  it("getConfiguredEndpoints success with empty config returns empty but not via catch swallow (direct value)", async () => {
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => ({ plugins: {} }),
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    expect(mod.getConfiguredEndpoints()).toEqual([]);
  });

  it("getConfiguredEndpoints failure does not swallow to [] - throws ElizaError with cause and code", async () => {
    const cause = new Error("config file unreadable");
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => { throw cause; },
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    let thrown: unknown;
    try { mod.getConfiguredEndpoints(); } catch (e) { thrown = e; }
    expect((thrown as any)?.name).toBe("ElizaError");
    expect((thrown as any)?.code).toBe("REGISTRY_ENDPOINTS_CONFIG_FAILED");
    const err = thrown as ElizaError;
    expect((err as any).cause).toBe(cause);
    expect(err.message).toContain("Failed to load registry endpoints");
    // must not be [] swallow
    expect(Array.isArray(thrown)).toBe(false);
  });

  it("getConfiguredEndpoints handles non-Error throw by wrapping", async () => {
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => { throw "string boom"; },
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    let thrown: unknown;
    try { mod.getConfiguredEndpoints(); } catch (e) { thrown = e; }
    expect((thrown as any)?.name).toBe("ElizaError");
    expect((thrown as any)?.code).toBe("REGISTRY_ENDPOINTS_CONFIG_FAILED");
    expect(((thrown as any)?.cause)).toBeInstanceOf(Error);
    expect(String((thrown as ElizaError).cause)).toContain("string boom");
  });

  it("concurrent getConfiguredEndpoints failures each wrap independently without swallow", async () => {
    const cause = new Error("concurrent load fail");
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => { throw cause; },
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => Promise.resolve().then(() => mod.getConfiguredEndpoints()))
    );
    expect(results.every(r => r.status === "rejected")).toBe(true);
    for (const r of results) {
      const err = (r as PromiseRejectedResult).reason as any;
      expect(err?.name).toBe("ElizaError");
      expect(err?.code).toBe("REGISTRY_ENDPOINTS_CONFIG_FAILED");
      expect(err?.cause).toBe(cause);
    }
  });

  it("invalid registryEndpoints type does not throw - returns raw value via success path (not J2 swallow)", async () => {
    // This tests that success path is not confused with failure swallow: when config returns undefined endpoints, we return []
    // via the ?? [] fallback, which is legitimate empty result, not a catch-swallow. Ensure that path does not throw.
    vi.doMock("../config/config.ts", () => ({
      loadElizaConfig: () => ({ plugins: { registryEndpoints: undefined } }),
      saveElizaConfig: vi.fn(),
    }));
    const mod = await import("./registry-client.ts");
    expect(mod.getConfiguredEndpoints()).toEqual([]);
  });
});
