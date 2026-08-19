/**
 * Behavioral coverage for wakeServer K8s PATCH timeout.
 *
 * Production bounds the PATCH with `signal: AbortSignal.timeout(15_000)` so a
 * stalled `kubernetes.default.svc` does not hang forever. Current call sites
 * are intentionally fire-and-forget (`wakeServer(...)` without await), so a
 * hung PATCH does NOT block the retry loop — it leaks a background request
 * and its resources until the gateway process exits.
 *
 * This test proves the bound via an injected fetch seam rather than
 * file-grep strings.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  __resetK8sCacheForTest,
  __setK8sCaCertForTest,
  __setK8sTokenForTest,
  wakeServer,
} from "./server-router";

const SERVER_NAME = "test-deploy";
const SERVER_URL = "http://test-deploy.test-ns.svc:3000";

function hangingFetch(): typeof fetch {
  return ((_: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (!signal) return;
      if (signal.aborted) {
        reject(new DOMException("signal timed out", "TimeoutError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("signal timed out", "TimeoutError")),
        { once: true },
      );
    })) as unknown as typeof fetch;
}

function okFetch(): typeof fetch {
  return (async () => ({ ok: true, status: 200, text: async () => "" }) as Response) as unknown as typeof fetch;
}

function non2xxFetch(): typeof fetch {
  return (async () =>
    ({ ok: false, status: 500, text: async () => "internal error" }) as Response) as unknown as typeof fetch;
}

describe("gateway-webhook wakeServer timeout (behavioral)", () => {
  let timeoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    __setK8sTokenForTest("fake-k8s-token");
    __setK8sCaCertForTest(null);
    const orig = AbortSignal.timeout.bind(AbortSignal);
    timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      if (ms === 15_000) return orig(10);
      return orig(ms);
    });
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
    __resetK8sCacheForTest();
  });

  it("aborts a never-settling PATCH at the deadline via AbortSignal.timeout(15_000)", async () => {
    const start = Date.now();
    await expect(wakeServer(SERVER_NAME, SERVER_URL, hangingFetch())).resolves.toBeUndefined();
    const elapsed = Date.now() - start;
    expect(timeoutSpy).toHaveBeenCalled();
    const calledWith15s = timeoutSpy.mock.calls.some((c) => c[0] === 15_000);
    expect(calledWith15s).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it("resolves on success (ok:true) without throwing", async () => {
    await expect(wakeServer(SERVER_NAME, SERVER_URL, okFetch())).resolves.toBeUndefined();
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it("handles non-2xx without throwing (logs and resolves)", async () => {
    await expect(wakeServer(SERVER_NAME, SERVER_URL, non2xxFetch())).resolves.toBeUndefined();
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it("fire-and-forget does not produce unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", handler);
    const p = wakeServer(SERVER_NAME, SERVER_URL, hangingFetch());
    await p;
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", handler);
    expect(unhandled).toEqual([]);
  });

  it("skips K8s PATCH for direct (non-.svc) URLs without calling fetch", async () => {
    let called = false;
    const neverFetch = (() => {
      called = true;
      return Promise.resolve({ ok: true } as Response);
    }) as unknown as typeof fetch;
    await wakeServer(SERVER_NAME, "http://1.2.3.4:3000", neverFetch);
    expect(called).toBe(false);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});
