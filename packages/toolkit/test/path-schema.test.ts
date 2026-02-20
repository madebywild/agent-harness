import assert from "node:assert/strict";
import test from "node:test";
import { parseManifest, parseProviderOverride } from "../../manifest-schema/src/index.ts";

test("parseManifest rejects Windows drive-prefixed source paths", () => {
  assert.throws(
    () =>
      parseManifest({
        version: 1,
        providers: {
          enabled: [],
        },
        entities: [
          {
            id: "system",
            type: "prompt",
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
