/**
 * Covers normalizeCharacterInput's document/knowledge merge and asserts
 * character.ts owns no provider-plugin auto-enable rules (no `buildCharacterPlugins`
 * export, no hardcoded `@elizaos/plugin-` names). Pure in-process assertions, no
 * runtime or model.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as characterModule from "./character";
import { normalizeCharacterInput } from "./character";
import { characterSchema, documentItemSchema } from "./schemas/character";

describe("normalizeCharacterInput", () => {
	it("imports legacy character knowledge alongside documents", () => {
		const normalized = normalizeCharacterInput({
			name: "test",
			bio: [],
			documents: ["./documents/current.md"],
			knowledge: ["./knowledge/legacy.md"],
		});

		expect(
			normalized.documents.map((item) =>
				item.item.case === "path" ? item.item.value : null,
			),
		).toEqual(["./documents/current.md", "./knowledge/legacy.md"]);
	});

	it("maps directory shorthand onto the document path variant", () => {
		const normalized = normalizeCharacterInput({
			name: "test",
			bio: [],
			documents: [{ directory: "./docs", shared: true }],
		});

		const expected = {
			item: {
				case: "directory" as const,
				value: { path: "./docs", shared: true },
			},
		};
		expect(normalized.documents).toEqual([expected]);
		expect(documentItemSchema.parse(normalized.documents[0])).toEqual(expected);
		expect(characterSchema.parse(normalized).documents).toEqual([expected]);
	});

	it("does not own provider plugin auto-enable rules", () => {
		expect("buildCharacterPlugins" in characterModule).toBe(false);

		const source = readFileSync(
			resolve(import.meta.dirname, "character.ts"),
			"utf8",
		);
		expect(source).not.toContain("@elizaos/plugin-");
	});
});
