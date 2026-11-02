import assert from "node:assert/strict";
import test from "node:test";
import {
	createQuietPart,
	indentFor,
	type BaseRenderers,
	type RenderDeps,
	type RendererContext,
	type ThemeLike,
} from "../src/render.ts";

const theme: ThemeLike = {
	fg: (color, text) => `[${color}]${text}`,
};

const clip: RenderDeps["clip"] = (lines, width) =>
	lines.map((line) => line.slice(0, Math.max(1, width)));

function deps(mode: "name" | "none" | "collapsed" | "full"): RenderDeps {
	return { getMode: () => mode, clip };
}

function context(overrides: RendererContext = {}): RendererContext {
	return { args: {}, outputPad: 1, ...overrides };
}

function baseWithCounts(counts: { call: number; result: number; expanded?: boolean }): BaseRenderers {
	return {
		renderCall(args, _theme, ctx) {
			counts.call += 1;
			return {
				render: () => [`native-call:${ctx.expanded ? "open" : "closed"}:${(args as { name?: string }).name ?? ""}`],
			};
		},
		renderResult(result, options, _theme, ctx) {
			counts.result += 1;
			counts.expanded = options.expanded;
			return {
				render: () => [`native-result:${ctx.expanded ? "open" : "closed"}:${(result as { text?: string }).text ?? ""}`],
			};
		},
	};
}

test("indentFor follows Pi's outputPad, with a default of one", () => {
	assert.equal(indentFor(undefined), " ");
	assert.equal(indentFor({ outputPad: 0 }), "");
	assert.equal(indentFor({ outputPad: 3 }), "   ");
	assert.equal(indentFor({ outputPad: 2.9 }), "  ");
});

test("name mode prints one compact call line and honors padding", () => {
	const make = createQuietPart("read", "call", undefined, deps("name"));
	const part = make({
		theme,
		context: context({ outputPad: 0 }),
		args: { path: "/tmp/project/src/index.ts" },
	});
	assert.deepEqual(part.render(80), ["[dim]Reading index.ts..."]);
});

test("none mode hides successful calls and results", () => {
	const makeCall = createQuietPart("bash", "call", undefined, deps("none"));
	const makeResult = createQuietPart("bash", "result", undefined, deps("none"));
	assert.deepEqual(
		makeCall({ theme, context: context(), args: { command: "true" } }).render(80),
		[],
	);
	assert.deepEqual(
		makeResult({ theme, context: context({ isError: false }), result: { content: [] } }).render(80),
		[],
	);
});

test("errors stay visible at quiet levels", () => {
	const make = createQuietPart("bash", "result", undefined, deps("name"));
	const part = make({
		theme,
		context: context({ isError: true, outputPad: 2 }),
		result: { content: [{ type: "text", text: "boom\nstack" }] },
	});
	assert.deepEqual(part.render(80), ["[error]  ✗ bash: boom"]);
});

test("collapsed delegates to the tool's native renderer", () => {
	const counts = { call: 0, result: 0 };
	const make = createQuietPart("mystery", "call", baseWithCounts(counts), deps("collapsed"));
	const part = make({
		theme,
		context: context(),
		args: { name: "alpha" },
	});
	assert.deepEqual(part.render(80), [" native-call:closed:alpha"]);
	assert.equal(counts.call, 1);
});

test("full forces the native renderer open", () => {
	const counts = { call: 0, result: 0 };
	const make = createQuietPart("mystery", "call", baseWithCounts(counts), deps("full"));
	const part = make({
		theme,
		context: context(),
		args: { name: "alpha" },
	});
	assert.deepEqual(part.render(80), [" native-call:open:alpha"]);
});

test("result expansion is passed to the native renderer", () => {
	const counts = { call: 0, result: 0 };
	const make = createQuietPart("mystery", "result", baseWithCounts(counts), deps("collapsed"));
	const part = make({
		theme,
		context: context(),
		options: { expanded: false, isPartial: false },
		result: { text: "done" },
	});
	assert.deepEqual(part.render(80), [" native-result:closed:done"]);
	assert.equal(counts.expanded, false);
});

test("invalidate drops the delegated cache", () => {
	const counts = { call: 0, result: 0 };
	const make = createQuietPart("mystery", "call", baseWithCounts(counts), deps("collapsed"));
	const part = make({ theme, context: context(), args: { name: "alpha" } });

	part.render(80);
	part.render(80);
	assert.equal(counts.call, 1);

	part.invalidate();
	part.render(80);
	assert.equal(counts.call, 2);
});

test("every emitted line is clipped to the requested width", () => {
	const make = createQuietPart("bash", "call", undefined, deps("name"));
	const part = make({
		theme,
		context: context({ outputPad: 0 }),
		args: { command: "a very long command that should not overflow the terminal" },
	});
	for (const line of part.render(12)) assert.ok(line.length <= 12, line);
});

test("the fallback result renderer keeps the last lines and errors readable", () => {
	const make = createQuietPart("mystery", "result", undefined, deps("collapsed"));
	const part = make({
		theme,
		context: context({ outputPad: 0 }),
		result: { content: [{ type: "text", text: "one\ntwo\nthree" }] },
	});
	assert.deepEqual(part.render(80), ["[toolOutput]one", "[toolOutput]two", "[toolOutput]three"]);
});
