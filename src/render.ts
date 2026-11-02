/**
 * The renderer half of Quiet Tools.
 *
 * This module deliberately knows nothing about Pi's module system. The entry
 * point supplies the current mode and a width-clipping function, which keeps
 * the stateful rendering logic testable with a small fake host.
 */

import {
	describeToolCall,
	errorText,
	textOf,
	type QuietMode,
} from "./core.ts";

export interface ThemeLike {
	fg(color: string, text: string): string;
}

export interface RendererContext {
	args?: unknown;
	toolCallId?: string;
	isError?: boolean;
	outputPad?: number;
	[key: string]: unknown;
}

export interface RenderOptions {
	expanded: boolean;
	isPartial: boolean;
}

export interface QuietComponent {
	render(width: number): string[];
	invalidate?(): void;
}

export interface BaseRenderers {
	renderCall?: (args: unknown, theme: ThemeLike, context: RendererContext) => QuietComponent;
	renderResult?: (
		result: unknown,
		options: RenderOptions,
		theme: ThemeLike,
		context: RendererContext,
	) => QuietComponent;
}

export interface QuietPart extends QuietComponent {
	render(width: number): string[];
	invalidate(): void;
}

export interface RenderDeps {
	getMode(): QuietMode;
	clip(lines: string[], width: number): string[];
}

export interface RenderArgs {
	theme: ThemeLike;
	context: RendererContext;
	args?: unknown;
	options?: RenderOptions;
	result?: unknown;
}

export type RenderSlot = (args: RenderArgs) => QuietPart;

interface DelegateState {
	key: string;
	context: RendererContext;
	options?: RenderOptions;
	result?: unknown;
}

/** The transcript's configured horizontal padding, with Pi's default of 1. */
export function indentFor(context?: RendererContext): string {
	const value = context?.outputPad;
	const width =
		typeof value === "number" && Number.isFinite(value)
			? Math.max(0, Math.floor(value))
			: 1;
	return " ".repeat(width);
}

function errorLine(
	toolName: string,
	result: unknown,
	isError: boolean,
	theme: ThemeLike,
	pad: string,
): string[] {
	if (!isError) return [];
	return [theme.fg("error", `${pad}✗ ${errorText(toolName, result)}`)];
}

/**
 * A stateful per-slot component. The host caches the component returned by a
 * renderer and calls render() on every frame, so the current level is read at
 * paint time. That is what makes live level switching work.
 */
export function createQuietPart(
	toolName: string,
	slot: "call" | "result",
	base: BaseRenderers | undefined,
	deps: RenderDeps,
): RenderSlot {
	let theme: ThemeLike | undefined;
	let args: unknown;
	let context: RendererContext | undefined;
	let options: RenderOptions | undefined;
	let result: unknown;
	let delegated: QuietComponent | undefined;
	let builtFrom: DelegateState | undefined;

	function buildDelegated(forceExpanded: boolean): void {
		if (!theme || !context) return;

		const level = deps.getMode();
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
		const pad = indentFor(context);
		try {
			buildDelegated(forceExpanded);
			const innerWidth = Math.max(1, width - pad.length);
			const lines = delegated?.render(innerWidth) ?? [];
			return deps.clip(lines.map((line) => pad + line), width);
		} catch {
			return deps.clip(
				errorLine(toolName, result, Boolean(context.isError), theme, pad),
				width,
			);
		}
	}

	const part: QuietPart = {
		render(width: number): string[] {
			if (!theme) return [];
			const level = deps.getMode();
			const pad = indentFor(context);

			if (slot === "call") {
				if (level === "name") {
					return deps.clip(
						[theme.fg("dim", `${pad}${describeToolCall(toolName, args ?? context?.args)}`)],
						width,
					);
				}
				if (level === "none") return [];
				return delegate(width, level === "full");
			}

			// Result slot: failures stay visible at the quiet levels.
			if (level === "name" || level === "none") {
				return deps.clip(
					errorLine(toolName, result, Boolean(context?.isError), theme, pad),
					width,
				);
			}
			return delegate(width, level === "full");
		},

		invalidate(): void {
			delegated = undefined;
			builtFrom = undefined;
		},
	};

	return (renderArgs: RenderArgs): QuietPart => {
		theme = renderArgs.theme;
		args = renderArgs.args;
		context = renderArgs.context;
		if (renderArgs.options) options = renderArgs.options;
		if (slot === "result") result = renderArgs.result;
		return part;
	};
}
