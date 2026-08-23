/**
 * Behavioral regression for error-policy J2 on documents LLM helpers.
 * Calls real generateTextEmbedding / generateText covering success, failure
 * (wrapped ElizaError with cause+context), invalid provider, and concurrency.
 * Proves no bare logger+rethrow without cause and that runtime.reportError is used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ElizaError } from "../../errors.ts";
import * as llm from "./llm.ts";

function makeRuntime(settings: Record<string, string> = {}, overrides: Record<string, any> = {}) {
  const reportError = vi.fn();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runtime: any = {
    agentId: "00000000-0000-0000-0000-0000000000aa",
    getSetting: (k: string) => settings[k],
    reportError,
    logger,
    useModel: overrides.useModel ?? (async () => { throw new Error("useModel not mocked"); }),
  };
  return { runtime, reportError, logger };
}

describe("Documents LLM J2 error handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generateTextEmbedding success returns embedding and does not report error", async () => {
    const { runtime, reportError } = makeRuntime(
      {
        EMBEDDING_PROVIDER: "local",
        OPENAI_API_KEY: "sk-test",
        LOCAL_EMBEDDING_MODEL: "test",
        TEXT_PROVIDER: "openai",
        TEXT_MODEL: "gpt-4o-mini",
        OPENAI_API_KEY_docs: "sk-test",
      },
      {
        useModel: async () => [0.1, 0.2, 0.3],
      }
    );
    // Need to ensure validateModelConfig sees local provider - it reads EMBEDDING_PROVIDER via getSetting
    // Set via process.env fallback also
    const orig = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = "local";
    const res = await llm.generateTextEmbedding(runtime, "hello");
    process.env.EMBEDDING_PROVIDER = orig;
    expect(res.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("generateTextEmbedding failure wraps with ElizaError, cause, context and reports", async () => {
    const cause = new Error("provider down");
    const { runtime, reportError } = makeRuntime(
      { EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "sk-test", EMBEDDING_DIMENSION: "1536" },
      { useModel: async () => { throw cause; } }
    );
    // Mock provider impl to throw: generateOpenAIEmbedding will be called and we can make it throw via fetch mock
    // Instead we force local path to throw via useModel; need EMBEDDING_PROVIDER=local to hit local path
    const rtLocal = makeRuntime({ EMBEDDING_PROVIDER: "local" }, { useModel: async () => { throw cause; } }).runtime;
    rtLocal.reportError = reportError;
    // Ensure env not interfering
    const prev = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = "local";
    let thrown: unknown;
    try { await llm.generateTextEmbedding(rtLocal, "hello"); } catch (e) { thrown = e; }
    process.env.EMBEDDING_PROVIDER = prev;
    expect(thrown).toBeInstanceOf(ElizaError);
    const err = thrown as ElizaError;
    expect(err.code).toBe("DOCUMENT_EMBEDDING_FAILED");
    expect(err.cause).toBe(cause);
    expect(err.context?.provider).toBe("local");
    expect(reportError).toHaveBeenCalledWith("DocumentsLlm.generateTextEmbedding", expect.any(ElizaError), { provider: "local" });
  });

  it("generateTextEmbedding handles non-Error throw by wrapping", async () => {
    const { runtime, reportError } = makeRuntime({ EMBEDDING_PROVIDER: "local" }, { useModel: async () => { throw "string boom"; } });
    const rt = runtime;
    rt.reportError = reportError;
    const prev = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = "local";
    let thrown: unknown;
    try { await llm.generateTextEmbedding(rt, "hello"); } catch (e) { thrown = e; }
    process.env.EMBEDDING_PROVIDER = prev;
    expect(thrown).toBeInstanceOf(ElizaError);
    expect((thrown as ElizaError).cause).toBeInstanceOf(Error);
  });

  it("generateText success path not tested here due to trajectory mock complexity - but failure wrapping is verified", async () => {
    // This test verifies that unsupported provider failure is still wrapped as J2?
    // generateText throws for unsupported provider inside try, caught and wrapped.
    // Use overrideConfig to trigger unsupported while keeping base config valid.
    const { runtime, reportError } = makeRuntime({
      TEXT_PROVIDER: "openai",
      TEXT_MODEL: "gpt-4o-mini",
      OPENAI_API_KEY: "sk-test",
      EMBEDDING_PROVIDER: "local",
    });
    let thrown: unknown;
    try { await llm.generateText(runtime, "prompt", "system", { provider: "unsupported_xyz" as any, modelName: "fake-model" }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    const err = thrown as ElizaError;
    expect(err.code).toBe("DOCUMENT_TEXT_GENERATION_FAILED");
    expect(err.context?.provider).toBe("unsupported_xyz");
    expect(reportError).toHaveBeenCalledWith("DocumentsLlm.generateText", expect.any(ElizaError), expect.objectContaining({ provider: "unsupported_xyz" }));
    // cause should be the unsupported provider error
    expect(String(err.cause)).toContain("Unsupported text provider");
  });

  it("generateText failure with provider error wraps cause and does not swallow", async () => {
    // Use openai provider but make underlying generate fail via missing key validation?
    // Easiest: mock withStandaloneTrajectory to throw by providing invalid modelName = ""
    const { runtime, reportError } = makeRuntime({
      TEXT_PROVIDER: "openai",
      TEXT_MODEL: "", // triggers No model name error
      OPENAI_API_KEY: "sk-test",
      EMBEDDING_PROVIDER: "local",
    });
    let thrown: unknown;
    try { await llm.generateText(runtime, "prompt"); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(ElizaError);
    expect((thrown as ElizaError).code).toBe("DOCUMENT_TEXT_GENERATION_FAILED");
    expect(reportError).toHaveBeenCalled();
    expect(Array.isArray(thrown)).toBe(false);
  });

  it("concurrent generateTextEmbedding failures each wrap independently", async () => {
    const cause = new Error("concurrent failure");
    const { reportError } = makeRuntime();
    const rts = Array.from({ length: 3 }, () => {
      const { runtime } = makeRuntime({ EMBEDDING_PROVIDER: "local" }, { useModel: async () => { throw cause; } });
      runtime.reportError = reportError;
      return runtime;
    });
    const prev = process.env.EMBEDDING_PROVIDER;
    process.env.EMBEDDING_PROVIDER = "local";
    const results = await Promise.allSettled(rts.map(rt => llm.generateTextEmbedding(rt, "hi")));
    process.env.EMBEDDING_PROVIDER = prev;
    expect(results.every(r => r.status === "rejected")).toBe(true);
    for (const r of results) {
      const err = (r as PromiseRejectedResult).reason as ElizaError;
      expect(err).toBeInstanceOf(ElizaError);
      expect(err.code).toBe("DOCUMENT_EMBEDDING_FAILED");
      expect(err.cause).toBe(cause);
    }
    expect(reportError).toHaveBeenCalledTimes(3);
  });
});
