/**
 * Pure helpers for Quiet Tools.
 *
 * Everything here is deterministic and side-effect free so it can be tested
 * without Pi, a terminal, or a model. The extension entry point owns the
 * renderer plumbing; this file owns the vocabulary.
 */

export const MODES = ["name", "none", "collapsed", "full"] as const;
export type QuietMode = (typeof MODES)[number];

export const DEFAULT_MODE: QuietMode = "name";
export const DEFAULT_EXEMPT_TOOLS = ["subagent"] as const;

export function isQuietMode(value: unknown): value is QuietMode {
	return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** Accept a mode from a command or environment value, case-insensitively. */
export function parseMode(value: unknown): QuietMode | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return isQuietMode(normalized) ? normalized : undefined;
}

/** Cycle name -> none -> collapsed -> full -> name. */
export function nextMode(current: unknown): QuietMode {
	const mode = isQuietMode(current) ? current : DEFAULT_MODE;
	return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export type CommandAction =
	| { type: "cycle" }
	| { type: "status" }
	| { type: "set"; mode: QuietMode }
	| { type: "unknown"; value: string };

/** Resolve a `/quiet-tools` argument without touching state. */
export function parseCommand(value: unknown): CommandAction {
	const requested = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!requested) return { type: "cycle" };
	if (requested === "status") return { type: "status" };
	const mode = parseMode(requested);
	return mode ? { type: "set", mode } : { type: "unknown", value: requested };
}

/**
 * Parse a comma-separated exempt-tool list. An absent value keeps the
 * built-in exemption (`subagent`); an explicitly empty value disables it.
 */
export function parseExemptTools(value: string | undefined): Set<string> {
	const source = value === undefined ? DEFAULT_EXEMPT_TOOLS.join(",") : value;
	return new Set(
		source
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean),
	);
}

/** Last path component, tolerant of both POSIX and Windows separators. */
export function basename(path: unknown): string {
	const value = String(path ?? "").replace(/[\\/]+$/, "");
	if (!value) return "";
	const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
	return index === -1 ? value : value.slice(index + 1);
}

/** First non-empty line, truncated for a one-line label. */
export function firstLine(value: unknown, max: number): string {
	const line = String(value ?? "").split("\n")[0].trim();
	const limit = Math.max(1, Math.floor(max));
	return line.length > limit ? `${line.slice(0, limit)}...` : line;
}

function stringArg(args: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value) return value;
	}
	return "";
}

function verbLabel(verb: string, name: string): string {
	return name ? `${verb} ${name}...` : `${verb}...`;
}

type ArgFormatter = (args: Record<string, unknown>) => string;

const ARG_LABELS: Record<string, ArgFormatter> = {
	read: (args) => verbLabel("Reading", basename(stringArg(args, "file_path", "path"))),
	edit: (args) => verbLabel("Editing", basename(stringArg(args, "file_path", "path"))),
	write: (args) => verbLabel("Writing", basename(stringArg(args, "file_path", "path"))),
	bash: (args) => `Running ${firstLine(stringArg(args, "command"), 48)}`,
	powershell: (args) => `Running ${firstLine(stringArg(args, "command"), 48)}`,
	grep: (args) => `Searching ${firstLine(stringArg(args, "pattern"), 32)}`,
	find: (args) => `Finding ${firstLine(stringArg(args, "pattern"), 32)}`,
	ls: (args) => {
		const name = basename(stringArg(args, "path") || ".");
		return name && name !== "." ? `Listing ${name}` : "Listing";
	},
};

/** The compact line shown in `name` mode. Unknown tools use their bare name. */
export function describeToolCall(toolName: string, args: unknown): string {
	const formatter = ARG_LABELS[toolName];
	if (!formatter) return toolName;
	const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	return formatter(record);
}

/** Plain text from a Pi tool result, without depending on its concrete type. */
export function textOf(result: unknown): string {
	const content = (result as { content?: unknown } | null | undefined)?.content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return (
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

/** One compact error line that stays visible at every quiet level. */
export function errorText(toolName: string, result: unknown, max = 160): string {
	const first = textOf(result).split("\n")[0] || "tool error";
	const limit = Math.max(1, Math.floor(max));
	const message = first.length > limit ? `${first.slice(0, limit)}...` : first;
	return `${toolName}: ${message}`;
}
