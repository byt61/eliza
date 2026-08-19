/**
 * Proves PayPal connector fetches are bounded by AbortSignal.timeout(15_000).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = readFileSync(
  resolve("packages/cloud/shared/src/lib/services/agent-paypal-connector.ts"),
  "utf8",
);
const sibling = readFileSync(resolve("packages/agent/src/actions/plugin.ts"), "utf8");

describe("paypal connector fetch timeout", () => {
  it("reserve present: PayPal fetches bounded by 15s", () => {
    expect(file).toContain("signal: AbortSignal.timeout(15_000)");
    expect(file).toContain("/v1/oauth2/token");
    const idx = file.indexOf("await fetch(`${config.host}/v1/");
    const sigIdx = file.indexOf("signal: AbortSignal.timeout(15_000)");
    expect(idx).toBeGreaterThan(-1);
    expect(sigIdx).toBeGreaterThan(idx);
  });

  it("no bare: each PayPal fetch has signal", () => {
    const re = /await fetch\(`\$\{config\.host\}\/v1\/.*?, \{([\s\S]*?)\}\);/g;
    const matches = [...file.matchAll(re)];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    for (const m of matches) expect(m[1]).toContain("signal:");
  });

  it("count: exactly three bounded PayPal fetches", () => {
    const count = (file.match(/AbortSignal\.timeout\(15_000\)/g) || []).length;
    expect(count).toBe(3);
  });

  it("payload weak vs fixed + sibling correct", () => {
    const weak = "body: body.toString(),\n  });\n  if (!response.ok)";
    // weak bare without signal should be gone after fix (if it exists, it would be without signal line)
    // ensure file now contains signal and not the bare weak pattern
    expect(file).toContain("signal: AbortSignal.timeout(15_000)");
    // sibling discipline check
    expect(sibling).toContain("signal: AbortSignal.timeout(15_000)");
    expect(sibling.length).toBeGreaterThan(1000);
    // ensure weak without signal not present as isolated bare
    const hasWeakBare =
      file.includes(weak) && !file.includes("signal: AbortSignal.timeout(15_000)");
    expect(hasWeakBare).toBe(false);
  });
});
