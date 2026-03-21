import assert from "node:assert/strict";
import test from "node:test";
import { parseManifest, parseProviderOverride, VersionError } from "../../manifest-schema/src/index.ts";

test("parseManifest rejects Windows drive-prefixed source paths", () => {
  assert.throws(
    () =>
      parseManifest({
        version: 1,
        providers: {
          enabled: [],
        },
        registries: {
          default: "local",
          entries: {
            local: { type: "local" },
          },
        },
        entities: [
          {
            id: "system",
            type: "prompt",
            registry: "local",
            sourcePath: "C:/repo/.harness/src/prompts/system.md",
          },
        ],
      }),
    /Windows drive-prefixed/u,
  );
});

test("parseProviderOverride rejects Windows drive-prefixed targetPath", () => {
  assert.throws(
    () =>
      parseProviderOverride({
        version: 1,
        targetPath: "C:/repo/AGENTS.md",
      }),
    /Windows drive-prefixed/u,
  );
});

test("parseManifest throws VersionError for newer schema versions", () => {
  assert.throws(
    () =>
      parseManifest({
        version: 2,
        providers: {
          enabled: [],
        },
        registries: {
          default: "local",
          entries: {
            local: { type: "local" },
          },
        },
        entities: [],
      }),
    (error) => error instanceof VersionError && error.reason === "unsupported_version",
  );
});

test("parseManifest accepts subagent entities", () => {
  assert.doesNotThrow(() =>
    parseManifest({
      version: 1,
      providers: {
        enabled: [],
      },
      registries: {
        default: "local",
        entries: {
          local: { type: "local" },
        },
      },
      entities: [
        {
          id: "researcher",
          type: "subagent",
          registry: "local",
          sourcePath: ".harness/src/subagents/researcher.md",
        },
      ],
    }),
  );
});

test("parseManifest accepts hook entities", () => {
  assert.doesNotThrow(() =>
    parseManifest({
      version: 1,
      providers: {
        enabled: [],
      },
      registries: {
        default: "local",
        entries: {
          local: { type: "local" },
        },
      },
      entities: [
        {
          id: "guard",
          type: "hook",
          registry: "local",
          sourcePath: ".harness/src/hooks/guard.json",
        },
      ],
    }),
  );
});

test("parseManifest accepts settings entities", () => {
  assert.doesNotThrow(() =>
    parseManifest({
      version: 1,
      providers: {
        enabled: [],
      },
      registries: {
        default: "local",
        entries: {
          local: { type: "local" },
        },
      },
      entities: [
        {
          id: "codex",
          type: "settings",
          registry: "local",
          sourcePath: ".harness/src/settings/codex.toml",
        },
      ],
    }),
  );
});

test("parseProviderOverride throws VersionError for missing version", () => {
  assert.throws(
    () => parseProviderOverride({ enabled: true }),
    (error) => error instanceof VersionError && error.reason === "missing_version",
  );
});
