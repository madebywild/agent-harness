import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseBehaviorConfig, parseBehaviorMap, VersionError } from "@madebywild/agent-harness-manifest";
import { loadBehavior, substituteBehaviorPlaceholders } from "../src/behavior.ts";
import { substituteEnvVars } from "../src/env.ts";
import { resolveHarnessPaths } from "../src/paths.ts";
import { mkTmpRepo } from "./helpers.ts";

const VALID_MAP = {
  version: 1,
  keys: {
    effort: {
      description: "How much validation to run per iteration",
      default: "thorough",
      values: {
        fast: "Skip broad tests until merge.",
        thorough: "Run the full suite after every change.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Schema parsing
// ---------------------------------------------------------------------------

test("behavior map: valid map parses", () => {
  const map = parseBehaviorMap(VALID_MAP);
  assert.equal(map.keys.effort?.default, "thorough");
});

test("behavior map: default not among values is rejected", () => {
  assert.throws(
    () =>
      parseBehaviorMap({
        version: 1,
        keys: { effort: { default: "turbo", values: { fast: "x" } } },
      }),
    /default 'turbo' is not among the defined values/,
  );
});

test("behavior map: empty values is rejected", () => {
  assert.throws(
    () => parseBehaviorMap({ version: 1, keys: { effort: { default: "fast", values: {} } } }),
    /values must define at least one entry/,
  );
});

test("behavior map: invalid key name is rejected", () => {
  assert.throws(() =>
    parseBehaviorMap({
      version: 1,
      keys: { "bad-key": { default: "a", values: { a: "x" } } },
    }),
  );
});

test("behavior map: missing version raises VersionError", () => {
  assert.throws(() => parseBehaviorMap({ keys: {} }), VersionError);
});

test("behavior map: newer version raises VersionError", () => {
  assert.throws(() => parseBehaviorMap({ version: 2, keys: {} }), VersionError);
});

test("behavior config: plain key/value map parses; bad key rejected", () => {
  assert.deepEqual(parseBehaviorConfig({ effort: "fast" }), { effort: "fast" });
  assert.throws(() => parseBehaviorConfig({ "bad-key": "fast" }));
  assert.throws(() => parseBehaviorConfig({ effort: 3 }));
});

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

test("behavior substitution: replaces known keys, reports unknown, leaves them in place", () => {
  const values = new Map([["effort", "Run the full suite."]]);
  const { result, unresolvedKeys } = substituteBehaviorPlaceholders(
    "Do this: {{behavior.effort}} And this: {{behavior.unknown}}",
    values,
  );
  assert.ok(result.includes("Run the full suite."));
  assert.ok(result.includes("{{behavior.unknown}}"));
  assert.deepEqual(unresolvedKeys, ["unknown"]);
});

test("behavior substitution: namespaces are disjoint in both directions", () => {
  const behaviorValues = new Map([["effort", "resolved"]]);
  const behaviorPass = substituteBehaviorPlaceholders("{{EFFORT}} {{effort}} {{behavior.effort}}", behaviorValues);
  assert.equal(behaviorPass.result, "{{EFFORT}} {{effort}} resolved");

  const envPass = substituteEnvVars("{{behavior.effort}}", new Map([["effort", "env-value"]]));
  assert.equal(envPass.result, "{{behavior.effort}}");
  assert.deepEqual(envPass.unresolvedKeys, []);
});

// ---------------------------------------------------------------------------
// loadBehavior resolution + diagnostics
// ---------------------------------------------------------------------------

async function writeWorkspaceFiles(input: { map?: string; config?: string }): Promise<string> {
  const cwd = await mkTmpRepo();
  await fs.mkdir(path.join(cwd, ".harness"), { recursive: true });
  if (input.map !== undefined) {
    await fs.writeFile(path.join(cwd, ".harness/behavior.map.yaml"), input.map);
  }
  if (input.config !== undefined) {
    await fs.writeFile(path.join(cwd, ".harness/behavior.yaml"), input.config);
  }
  return cwd;
}

const MAP_YAML = [
  "version: 1",
  "keys:",
  "  effort:",
  "    default: thorough",
  "    values:",
  "      fast: |",
  "        Skip broad tests until merge.",
  "      thorough: |",
  "        Run the full suite after every change.",
  "",
].join("\n");

test("loadBehavior: neither file present is a no-op", async () => {
  const cwd = await mkTmpRepo();
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.values.size, 0);
  assert.equal(behavior.diagnostics.length, 0);
});

test("loadBehavior: map without config resolves defaults", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics.length, 0);
  assert.ok(behavior.values.get("effort")?.includes("Run the full suite"));
  assert.equal(behavior.choices.get("effort")?.source, "default");
  assert.deepEqual(behavior.choices.get("effort")?.allowed, ["fast", "thorough"]);
});

test("loadBehavior: config choice wins over default", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML, config: "effort: fast\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics.length, 0);
  assert.ok(behavior.values.get("effort")?.includes("Skip broad tests"));
  assert.equal(behavior.choices.get("effort")?.source, "config");
});

test("loadBehavior: config without map errors with BEHAVIOR_MAP_MISSING", async () => {
  const cwd = await writeWorkspaceFiles({ config: "effort: fast\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics[0]?.code, "BEHAVIOR_MAP_MISSING");
  assert.equal(behavior.diagnostics[0]?.severity, "error");
  assert.equal(behavior.values.size, 0);
});

test("loadBehavior: invalid map YAML/schema errors with BEHAVIOR_MAP_INVALID", async () => {
  const cwd = await writeWorkspaceFiles({ map: "version: 1\nkeys: [not, a, map]\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics[0]?.code, "BEHAVIOR_MAP_INVALID");
  assert.equal(behavior.diagnostics[0]?.severity, "error");
});

test("loadBehavior: invalid config errors with BEHAVIOR_CONFIG_INVALID", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML, config: "- just\n- a list\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics[0]?.code, "BEHAVIOR_CONFIG_INVALID");
});

test("loadBehavior: unknown config key errors with BEHAVIOR_KEY_UNKNOWN", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML, config: "speed: fast\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics[0]?.code, "BEHAVIOR_KEY_UNKNOWN");
  assert.equal(behavior.diagnostics[0]?.severity, "error");
});

test("loadBehavior: invalid config value errors with BEHAVIOR_VALUE_INVALID and names allowed values", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML, config: "effort: turbo\n" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics[0]?.code, "BEHAVIOR_VALUE_INVALID");
  assert.ok(behavior.diagnostics[0]?.message.includes("fast, thorough"));
});

test("loadBehavior: empty config file behaves like defaults", async () => {
  const cwd = await writeWorkspaceFiles({ map: MAP_YAML, config: "" });
  const behavior = await loadBehavior(resolveHarnessPaths(cwd));
  assert.equal(behavior.diagnostics.length, 0);
  assert.equal(behavior.choices.get("effort")?.source, "default");
});
