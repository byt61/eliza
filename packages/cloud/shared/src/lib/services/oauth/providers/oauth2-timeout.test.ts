/**
 * Proves OAuth2 token fetch is bounded by AbortSignal.timeout(15_000).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = readFileSync(
  resolve("packages/cloud/shared/src/lib/services/oauth/providers/oauth2.ts"),
  "utf8",
);
const sibling = readFileSync(
  resolve("plugins/plugin-health/src/health-bridge/health-oauth.ts"),
  "utf8",
);

describe("oauth2 token fetch timeout", () => {
  it("reserve present: token fetch bounded by 15s", () => {
    expect(file).toContain("signal: AbortSignal.timeout(15_000)");
    expect(file).toContain("provider.endpoints.token");
    const idx = file.indexOf("const response = await fetch(provider.endpoints.token");
    const sigIdx = file.indexOf("signal: AbortSignal.timeout(15_000)");
    expect(idx).toBeGreaterThan(-1);
    expect(sigIdx).toBeGreaterThan(idx);
  });

  it("no bare: fetch has signal inside options", () => {
    const re = /await fetch\(provider\.endpoints\.token, \{([\s\S]*?)\}\);/g;
    const matches = [...file.matchAll(re)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) expect(m[1]).toContain("signal:");
  });

  it("count: both token exchanges bounded", () => {
    const count = (file.match(/AbortSignal\.timeout\(15_000\)/g) || []).length;
    expect(count).toBe(2);
  });

  it("payload weak vs fixed + sibling correct", () => {
    const weak =
      'await fetch(provider.endpoints.token, {\n    method: "POST",\n    headers,\n    body,\n  });';
    expect(file).not.toContain(weak);
    expect(file).toContain("signal: AbortSignal.timeout(15_000)");
    expect(sibling).toContain("signal: AbortSignal.timeout(15_000)");
    expect(sibling.length).toBeGreaterThan(1000);
  });
});
