/**
 * Small, local persistence for the current display level.
 *
 * The state file lives in Pi's agent directory, never in the project. If the
 * file cannot be read or written the extension keeps working in memory.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_MODE, isQuietMode, type QuietMode } from "./core.ts";

export interface StatePaths {
	primary: string;
	legacy: string;
}

export interface LoadedMode {
	mode: QuietMode;
	source: "primary" | "legacy" | "default";
}

export function agentDirectory(
	env: Record<string, string | undefined> = process.env,
	home = homedir(),
): string {
	return env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
}

export function statePaths(
	env: Record<string, string | undefined> = process.env,
	home = homedir(),
): StatePaths {
	const directory = agentDirectory(env, home);
	return {
		primary: join(directory, "quiet-tools.json"),
		legacy: join(directory, "hide-tool-calls.json"),
	};
}

export function readModeFile(file: string): QuietMode | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		const level = (parsed as { level?: unknown } | null)?.level;
		return isQuietMode(level) ? level : undefined;
	} catch {
		return undefined;
	}
}

export function writeModeFile(file: string, mode: QuietMode): boolean {
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ level: mode }, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
}

/** Prefer the current file, then the pre-rename file, then the default. */
export function loadMode(paths: StatePaths = statePaths()): LoadedMode {
	const primary = readModeFile(paths.primary);
	if (primary) return { mode: primary, source: "primary" };

	const legacy = readModeFile(paths.legacy);
	if (legacy) return { mode: legacy, source: "legacy" };

	return { mode: DEFAULT_MODE, source: "default" };
}
