/**
 * Quiet Tools — four display levels for Pi tool rows.
 *
 *   name       one dim line per call: what happened, without the output
 *   none       no call content; errors still get one compact red line
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
	isQuietMode,
	nextMode,
	parseCommand,
	parseExemptTools,
	type QuietMode,
} from "./core.ts";
import { createQuietPart } from "./render.ts";
import { loadMode, statePaths, writeModeFile } from "./state.ts";

const MODE_KEY = "__piQuietToolsMode";

// Subagent progress cards are the dashboard for background work; leave them
// native by default. Set QUIET_TOOLS_EXEMPT="" to quiet them too.
const EXEMPT_TOOLS = parseExemptTools(process.env.QUIET_TOOLS_EXEMPT);

// The TUI crashes if a rendered line exceeds the terminal width. With
// renderShell:"self" clipping is the renderer's job, so every line goes here.
function clip(lines: string[], width: number): string[] {
	const limit = Math.max(1, width);
	return lines.map((line) => truncateToWidth(line, limit));
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

function announce(
	ctx: { mode?: string; ui?: { notify(message: string): void } } | undefined,
	message = `Tool display: ${getMode()}`,
): void {
	if (ctx?.mode === "tui" && ctx.ui) ctx.ui.notify(message);
}

export default function quietTools(pi: ExtensionAPI) {
	loadPersistedLevel();

	pi.registerToolRenderer((toolName, next) => {
		const base = next?.();

		// Exempt tools pass through untouched (native shell and all).
		if (EXEMPT_TOOLS.has(toolName)) return base;

		const makeCall = createQuietPart(toolName, "call", base, { getMode, clip });
		const makeResult = createQuietPart(toolName, "result", base, { getMode, clip });

		return {
			renderShell: "self" as const,
			renderCall(callArgs, theme, context) {
				return makeCall({ theme, context, args: callArgs });
			},
			renderResult(callResult, renderOptions, theme, context) {
				return makeResult({
					theme,
					context,
					options: renderOptions,
					result: callResult,
				});
			},
		};
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Cycle tool display level (name / none / collapsed / full)",
		handler: (ctx) => {
			cycleMode();
			announce(ctx);
		},
	});

	pi.registerCommand("quiet-tools", {
		description:
			"Tool display level: name | none | collapsed | full | status (no argument cycles)",
		handler: async (args, ctx) => {
			const action = parseCommand(args);
			if (action.type === "cycle") {
				cycleMode();
				announce(ctx);
				return;
			}
			if (action.type === "set") {
				setMode(action.mode);
				announce(ctx);
				return;
			}
			if (action.type === "status") {
				announce(ctx);
				return;
			}
			announce(ctx, `Unknown level: ${action.value}. Use name, none, collapsed, full, or status.`);
		},
	});
}
