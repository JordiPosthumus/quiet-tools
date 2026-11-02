/**
 * Quiet Tools — four display levels for Pi tool rows.
 *
 *   name       one dim line per call: what happened, without the output
 *   none       no call row; errors still get one compact red line
 *   collapsed  the tool's own default rendering
 *   full       the tool's own rendering, forced open
 *
 * The current level is read at paint time, so switching levels repaints
 * existing rows instead of only affecting new ones.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	DEFAULT_MODE,
	describeToolCall,
	errorText,
	isQuietMode,
	nextMode,
	parseExemptTools,
	textOf,
	type QuietMode,
} from "./core.ts";
import { loadMode, statePaths, writeModeFile } from "./state.ts";

const MODE_KEY = "__piQuietToolsMode";
const INDENT = " ";

// Subagent progress cards are the dashboard for background work; leave them
// native by default. Set QUIET_TOOLS_EXEMPT="" to quiet them too.
const EXEMPT_TOOLS = parseExemptTools(process.env.QUIET_TOOLS_EXEMPT);

interface ThemeLike {
	fg(color: string, text: string): string;
}

interface RendererContext {
	args?: unknown;
	toolCallId?: string;
	isError?: boolean;
	[key: string]: unknown;
}

interface RenderOptions {
	expanded: boolean;
	isPartial: boolean;
}

interface QuietComponent {
	render(width: number): string[];
	invalidate?(): void;
}

interface BaseRenderers {
	renderCall?: (args: unknown, theme: ThemeLike, context: RendererContext) => QuietComponent;
	renderResult?: (
		result: unknown,
		options: RenderOptions,
		theme: ThemeLike,
		context: RendererContext,
	) => QuietComponent;
}

interface QuietPart extends QuietComponent {
	render(width: number): string[];
	invalidate(): void;
}

interface DelegateState {
	key: string;
	context: RendererContext;
	options?: RenderOptions;
	result?: unknown;
}

function indent(lines: string[]): string[] {
	return lines.map((line) => INDENT + line);
}

// The TUI crashes if a rendered line exceeds the terminal width. With
// renderShell:"self" clipping is the renderer's job, so every line goes here.
function clip(lines: string[], width: number): string[] {
	const limit = Math.max(1, width);
	return lines.map((line) => truncateToWidth(line, limit));
}

function errorLine(
	toolName: string,
	result: unknown,
	isError: boolean,
	theme: ThemeLike,
): string[] {
	if (!isError) return [];
	return [theme.fg("error", `${INDENT}✗ ${errorText(toolName, result)}`)];
}

/**
 * A stateful per-slot component. The host caches the component returned by a
 * renderer and calls render() on every frame, so the current level is read at
 * paint time. That is what makes live level switching work.
 */
function createQuietPart(
	toolName: string,
	slot: "call" | "result",
	base: BaseRenderers | undefined,
) {
	let theme: ThemeLike | undefined;
	let args: unknown;
	let context: RendererContext | undefined;
	let options: RenderOptions | undefined;
	let result: unknown;
	let delegated: QuietComponent | undefined;
	let builtFrom: DelegateState | undefined;

	function buildDelegated(forceExpanded: boolean): void {
		if (!theme || !context) return;

		const level = getMode();
		const expanded = forceExpanded || Boolean(options?.expanded);
		const key = `${level}:${expanded ? 1 : 0}`;
		if (
			builtFrom?.key === key &&
			builtFrom.context === context &&
			builtFrom.options === options &&
			builtFrom.result === result
		) {
			return;
		}

		const effectiveContext: RendererContext = forceExpanded
			? { ...context, expanded: true }
			: context;

		if (slot === "call") {
			if (base?.renderCall) {
				delegated = base.renderCall(args ?? context.args, theme, {
					...effectiveContext,
					lastComponent: delegated,
				});
			} else {
				const preview = args ?? context.args;
				const text = preview ? JSON.stringify(preview).slice(0, 100) : "";
				delegated = {
					render: () => [`${theme!.fg("dim", toolName)} ${theme!.fg("toolOutput", text)}`.trimEnd()],
				};
			}
		} else if (base?.renderResult) {
			delegated = base.renderResult(
				result,
				{ expanded, isPartial: Boolean(options?.isPartial) },
				theme,
				{ ...effectiveContext, lastComponent: delegated },
			);
		} else {
			const raw = textOf(result);
			const lines = raw
				? raw.split("\n").slice(-20)
				: context.isError
					? [errorText(toolName, result)]
					: [];
			const color = context.isError ? "error" : "toolOutput";
			delegated = {
				render: () => lines.map((line) => theme!.fg(color, line)),
			};
		}

		builtFrom = { key, context, options, result };
	}

	function delegate(width: number, forceExpanded: boolean): string[] {
		if (!theme || !context) return [];
		try {
			buildDelegated(forceExpanded);
			const innerWidth = Math.max(1, width - INDENT.length);
			const lines = delegated?.render(innerWidth) ?? [];
			return clip(indent(lines), width);
		} catch {
			return clip(errorLine(toolName, result, Boolean(context.isError), theme), width);
		}
	}

	const part: QuietPart = {
		render(width: number): string[] {
			if (!theme) return [];
			const level = getMode();

			if (slot === "call") {
				if (level === "name") {
					return clip([theme.fg("dim", `${INDENT}${describeToolCall(toolName, args ?? context?.args)}`)], width);
				}
				if (level === "none") return [];
				return delegate(width, level === "full");
			}

			// Result slot: failures stay visible at the quiet levels.
			if (level === "name" || level === "none") {
				return clip(errorLine(toolName, result, Boolean(context?.isError), theme), width);
			}
			return delegate(width, level === "full");
		},

		invalidate(): void {
			delegated = undefined;
			builtFrom = undefined;
		},
	};

	return (renderArgs: {
		theme: ThemeLike;
		context: RendererContext;
		options?: RenderOptions;
		result?: unknown;
	}): QuietPart => {
		theme = renderArgs.theme;
		args = renderArgs.args;
		context = renderArgs.context;
		if (renderArgs.options) options = renderArgs.options;
		if (slot === "result") result = renderArgs.result;
		return part;
	};
}

function loadPersistedLevel(): void {
	const paths = statePaths();
	const loaded = loadMode(paths);
	(globalThis as Record<string, unknown>)[MODE_KEY] = loaded.mode;
	// Migrate the pre-rename file once, without making startup depend on it.
	if (loaded.source === "legacy") writeModeFile(paths.primary, loaded.mode);
}

function getMode(): QuietMode {
	const value = (globalThis as Record<string, unknown>)[MODE_KEY];
	return isQuietMode(value) ? value : DEFAULT_MODE;
}

function setMode(next: QuietMode): void {
	(globalThis as Record<string, unknown>)[MODE_KEY] = next;
	writeModeFile(statePaths().primary, next);
}

function cycleMode(): QuietMode {
	const next = nextMode(getMode());
	setMode(next);
	return next;
}

export default function quietTools(pi: ExtensionAPI) {
	loadPersistedLevel();

	pi.registerToolRenderer((toolName, next) => {
		const base = next?.();

		// Exempt tools pass through untouched (native shell and all).
		if (EXEMPT_TOOLS.has(toolName)) return base;

		const makeCall = createQuietPart(toolName, "call", base);
		const makeResult = createQuietPart(toolName, "result", base);

		return {
			renderShell: "self" as const,
			renderCall(callArgs: unknown, theme: ThemeLike, context: RendererContext) {
				return makeCall({ theme, context, args: callArgs });
			},
			renderResult(
				callResult: unknown,
				renderOptions: RenderOptions,
				theme: ThemeLike,
				context: RendererContext,
			) {
				return makeResult({ theme, context, options: renderOptions, result: callResult });
			},
		};
	});

	function announce(ctx: { mode?: string; ui?: { notify(message: string): void } } | undefined): void {
		if (ctx?.mode === "tui" && ctx.ui) ctx.ui.notify(`Tool display: ${getMode()}`);
	}

	pi.registerShortcut("ctrl+shift+o", {
		description: "Cycle tool display level (name / none / collapsed / full)",
		handler: (ctx) => {
			cycleMode();
			announce(ctx);
		},
	});

	pi.registerCommand("quiet-tools", {
		description: "Tool display level: name | none | collapsed | full (no argument cycles)",
		handler: async (args, ctx) => {
			const requested = String(args ?? "").trim().toLowerCase();
			if (isQuietMode(requested)) setMode(requested);
			else cycleMode();
			announce(ctx);
		},
	});
}
