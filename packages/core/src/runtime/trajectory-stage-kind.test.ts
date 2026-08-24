/**
 * Tests for trajectory-stage-kind — verifies the canonical semantic stage-kind
 * vocabulary is complete and stable for trajectory producers and transports.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	RECORDED_STAGE_KINDS,
	type RecordedStageKind,
} from "./trajectory-stage-kind.ts";

describe("trajectory-stage-kind", () => {
	it("exports RECORDED_STAGE_KINDS as an array", () => {
		expect(Array.isArray(RECORDED_STAGE_KINDS)).toBe(true);
		expect(RECORDED_STAGE_KINDS).toHaveLength(8);
	});

	it("contains expected stage kinds in canonical order", () => {
		expect(RECORDED_STAGE_KINDS).toEqual([
			"messageHandler",
			"planner",
			"tool",
			"toolSearch",
			"evaluation",
			"subPlanner",
			"compaction",
			"factsAndRelationships",
		]);
	});

	it("derives RecordedStageKind union from exported literals", () => {
		expectTypeOf<RecordedStageKind>().toEqualTypeOf<
			(typeof RECORDED_STAGE_KINDS)[number]
		>();
		expectTypeOf<RecordedStageKind>().toEqualTypeOf<
			| "messageHandler"
			| "planner"
			| "tool"
			| "toolSearch"
			| "evaluation"
			| "subPlanner"
			| "compaction"
			| "factsAndRelationships"
		>();
	});

	it("accepts valid stage kinds and rejects invalid vocabulary", () => {
		const validKinds: readonly RecordedStageKind[] = [
			"messageHandler",
			"planner",
			"tool",
			"toolSearch",
			"evaluation",
			"subPlanner",
			"compaction",
			"factsAndRelationships",
		];
		const stageSet = new Set<string>(RECORDED_STAGE_KINDS);

		for (const kind of validKinds) {
			expect(stageSet.has(kind)).toBe(true);
		}

		expect(stageSet.has("unknown")).toBe(false);
		expect(stageSet.has("invalidKind")).toBe(false);
		expect(stageSet.has("")).toBe(false);
	});

	it("contains no duplicates", () => {
		const set = new Set(RECORDED_STAGE_KINDS);
		expect(set.size).toBe(RECORDED_STAGE_KINDS.length);
	});

	it("all entries are non-empty strings", () => {
		for (const kind of RECORDED_STAGE_KINDS) {
			expect(typeof kind).toBe("string");
			expect(kind.length).toBeGreaterThan(0);
		}
	});
});
