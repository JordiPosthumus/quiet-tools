import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { agentDirectory, loadMode, readModeFile, statePaths, writeModeFile } from "../src/state.ts";

function tempHome(t: test.TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), "quiet-tools-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test("the state directory honors PI_CODING_AGENT_DIR", (t) => {
	const home = tempHome(t);
	assert.equal(agentDirectory({ PI_CODING_AGENT_DIR: "/tmp/custom-agent" }, home), "/tmp/custom-agent");
	assert.equal(agentDirectory({}, home), join(home, ".pi", "agent"));
});

test("the primary file wins over the legacy file", (t) => {
	const home = tempHome(t);
	const paths = statePaths({}, home);
	assert.equal(writeModeFile(paths.legacy, "full"), true);
	assert.equal(loadMode(paths).mode, "full");
	assert.equal(loadMode(paths).source, "legacy");

	assert.equal(writeModeFile(paths.primary, "collapsed"), true);
	assert.equal(loadMode(paths).mode, "collapsed");
	assert.equal(loadMode(paths).source, "primary");
});

test("missing and malformed files fall back to the default", (t) => {
	const home = tempHome(t);
	const paths = statePaths({}, home);
	assert.deepEqual(loadMode(paths), { mode: "name", source: "default" });

	mkdirSync(dirname(paths.primary), { recursive: true });
	writeFileSync(paths.primary, "{not json");
	assert.deepEqual(loadMode(paths), { mode: "name", source: "default" });

	writeFileSync(paths.primary, JSON.stringify({ level: "shouting" }));
	assert.deepEqual(loadMode(paths), { mode: "name", source: "default" });
});

test("writing creates the directory and stores a small JSON document", (t) => {
	const home = tempHome(t);
	const file = join(home, "nested", "quiet-tools.json");
	assert.equal(writeModeFile(file, "none"), true);
	assert.equal(readModeFile(file), "none");
	assert.equal(readFileSync(file, "utf8"), '{\n  "level": "none"\n}\n');
});
