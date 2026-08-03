/**
 * Locks the canonical recorder and direct agent-surface runner to one explicit
 * recording destination while preserving fixture-local direct-run output.
 */

import { describe, expect, it } from "vitest";
import {
  DIRECT_AGENT_SURFACE_OUTPUT_DIR,
  resolveAgentSurfaceOutputDir,
} from "../../packages/ui/src/agent-surface/__e2e__/output-path.mjs";
import { recordingOutputDirForSuite } from "./run-all.mjs";
import { suiteByName } from "./suites.mjs";

const suite = suiteByName("ui-agent-surface");
if (!suite)
  throw new Error("ui-agent-surface recording suite is not registered");

describe("agent-surface recording destination", () => {
  it("keeps fixture-local output as the direct-run default", () => {
    expect(resolveAgentSurfaceOutputDir({})).toBe(
      DIRECT_AGENT_SURFACE_OUTPUT_DIR,
    );
    expect(resolveAgentSurfaceOutputDir({ E2E_RECORD: "1" })).toBe(
      DIRECT_AGENT_SURFACE_OUTPUT_DIR,
    );
  });

  it("agrees with the canonical recorder's explicit destination", () => {
    const recordingOutputDir = recordingOutputDirForSuite(suite);
    expect(
      resolveAgentSurfaceOutputDir({
        E2E_RECORD: "1",
        E2E_RECORDING_DIR: recordingOutputDir,
      }),
    ).toBe(recordingOutputDir);
  });
});
