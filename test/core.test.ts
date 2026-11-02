import assert from "node:assert/strict";
import test from "node:test";
import {
	DEFAULT_MODE,
	basename,
	describeToolCall,
	errorText,
	firstLine,
	isQuietMode,
	nextMode,
	parseExemptTools,
	parseMode,
	textOf,
} from "../src/core.ts";

test("the mode cycle wraps and survives an unknown value", () => {
	assert.equal(nextMode("name"), "none");
	assert.equal(nextMode("none"), "collapsed");
	assert.equal(nextMode("collapsed"), "full");
	assert.equal(nextMode("full"), "name");
	assert.equal(nextMode("bogus"), "none");
	assert.equal(DEFAULT_MODE, "name");
});

test("mode parsing is trimmed and case-insensitive", () => {
	assert.equal(parseMode("  FULL "), "full");
	assert.equal(parseMode("quiet"), undefined);
	assert.equal(parseMode(undefined), undefined);
	assert.equal(isQuietMode("collapsed"), true);
	assert.equal(isQuietMode("expanded"), false);
});

test("exempt tools default to subagent but can be cleared", () => {
	assert.deepEqual([...parseExemptTools(undefined)], ["subagent"]);
	assert.deepEqual([...parseExemptTools("subagent, custom, ")], ["subagent", "custom"]);
	assert.deepEqual([...parseExemptTools("")], []);
});

test("paths are reduced to their final component", () => {
	assert.equal(basename("/tmp/project/src/index.ts"), "index.ts");
	assert.equal(basename("C:\\project\\src\\index.ts"), "index.ts");
	assert.equal(basename("/tmp/project/"), "project");
	assert.equal(basename(""), "");
});

test("first lines are trimmed and bounded", () => {
	assert.equal(firstLine("  npm test\nsecond", 20), "npm test");
	assert.equal(firstLine("abcdefghij", 4), "abcd...");
	assert.equal(firstLine(undefined, 4), "");
});

test("tool labels stay compact and use the useful argument", () => {
	assert.equal(describeToolCall("read", { path: "/tmp/a.ts" }), "Reading a.ts...");
	assert.equal(describeToolCall("edit", { file_path: "/tmp/b.ts" }), "Editing b.ts...");
	assert.equal(describeToolCall("bash", { command: "npm test\n--watch" }), "Running npm test");
	assert.equal(describeToolCall("ls", {}), "Listing");
	assert.equal(describeToolCall("mystery", { anything: true }), "mystery");
});

test("tool text is extracted without assuming a concrete result type", () => {
	assert.equal(
		textOf({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }),
		"one\ntwo",
	);
	assert.equal(textOf({ content: [] }), "");
	assert.equal(textOf(undefined), "");
});

test("errors keep a single readable line", () => {
	assert.equal(errorText("bash", { content: [{ type: "text", text: "boom\nstack" }] }), "bash: boom");
	assert.equal(errorText("read", { content: [] }), "read: tool error");
	assert.equal(errorText("bash", { content: [{ type: "text", text: "abcdef" }] }, 3), "bash: abc...");
});
