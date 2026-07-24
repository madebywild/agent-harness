import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applyResolvedPreset } from "../src/engine/presets.ts";
import { HarnessEngine } from "../src/engine.ts";
import type { ResolvedPreset } from "../src/types.ts";
import { mkTmpRepo } from "./helpers.ts";

async function fileExists(absPath: string): Promise<boolean> {
  return fs
    .stat(absPath)
    .then(() => true)
    .catch(() => false);
}

interface MutableManifest {
  entities: Array<Record<string, unknown> & { type: string; id: string }>;
}

async function patchManifest(cwd: string, mutate: (manifest: MutableManifest) => void): Promise<void> {
  const manifestPath = path.join(cwd, ".harness/manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as MutableManifest;
  mutate(manifest);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

test("capability-aware routing: targeted skill nests for claude but roots for copilot", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");
  await engine.addSkill("api-testing", { target: "packages/web" });

  const result = await engine.apply();

  assert.ok(await fileExists(path.join(cwd, "packages/web/.claude/skills/api-testing/SKILL.md")));
  assert.ok(await fileExists(path.join(cwd, ".github/skills/api-testing/SKILL.md")));
  // Claude must NOT keep it at root, copilot must NOT nest it.
  assert.ok(!(await fileExists(path.join(cwd, ".claude/skills/api-testing/SKILL.md"))));
  assert.ok(!(await fileExists(path.join(cwd, "packages/web/.github/skills/api-testing/SKILL.md"))));

  assert.ok(
    result.diagnostics.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "copilot"),
    "expected an info diagnostic that copilot was routed to root",
  );
});

test("prompt-sections compose into a root and a per-package CLAUDE.md by target", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addPromptSection("system");
  await engine.addPromptSection("web", { target: "packages/web" });

  await engine.apply();

  // Claude nests prompts, so sections group by target: the untargeted one composes at the root,
  // the targeted one into the package directory.
  assert.ok(await fileExists(path.join(cwd, "CLAUDE.md")));
  assert.ok(await fileExists(path.join(cwd, "packages/web/CLAUDE.md")));
});

test("targeted section composes into the single root file for a non-nesting provider", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("copilot");
  await engine.addPromptSection("system");
  await engine.addPromptSection("web", { target: "packages/web" });

  const result = await engine.apply();

  // Copilot does not nest the prompt, so every section composes into the one root instructions file.
  assert.ok(await fileExists(path.join(cwd, ".github/copilot-instructions.md")));
  assert.ok(!(await fileExists(path.join(cwd, "packages/web/.github/copilot-instructions.md"))));
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "copilot" && d.entityId === "web",
    ),
  );
});

test("targeting the only section still gives a non-nesting provider its root instructions", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");
  await engine.addPromptSection("web", { target: "packages/web" }); // the ONLY section, targeted

  const result = await engine.apply();

  // Claude nests it into the package; Copilot composes it into the root instructions file.
  assert.ok(await fileExists(path.join(cwd, "packages/web/CLAUDE.md")));
  assert.ok(await fileExists(path.join(cwd, ".github/copilot-instructions.md")));
  assert.ok(result.diagnostics.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "copilot"));
});

test("two MCP configs with different targets produce independent .mcp.json files", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addMcp("alpha", { target: "packages/a" });
  await engine.addMcp("beta", { target: "packages/b" });

  await engine.apply();

  assert.ok(await fileExists(path.join(cwd, "packages/a/.mcp.json")));
  assert.ok(await fileExists(path.join(cwd, "packages/b/.mcp.json")));
  const alpha = JSON.parse(await fs.readFile(path.join(cwd, "packages/a/.mcp.json"), "utf8"));
  assert.ok(alpha.mcpServers.alpha, "alpha server should be in packages/a");
  assert.ok(!alpha.mcpServers.beta, "beta server should not leak into packages/a");
});

test("targeted hook writes a per-package settings.json", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addHook("guard", { target: "packages/web" });

  await engine.apply();

  assert.ok(await fileExists(path.join(cwd, "packages/web/.claude/settings.json")));
  assert.ok(!(await fileExists(path.join(cwd, ".claude/settings.json"))));
});

test("target composes with a per-provider targetPath override (join, not replace)", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addSkill("foo", { target: "packages/web" });
  await fs.writeFile(
    path.join(cwd, ".harness/src/skills/foo/OVERRIDES.claude.yaml"),
    "version: 1\ntargetPath: custom/foo\n",
    "utf8",
  );

  await engine.apply();

  assert.ok(await fileExists(path.join(cwd, "packages/web/custom/foo/SKILL.md")));
});

test("target on a settings entity is a blocking error", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addSettings("claude");
  await patchManifest(cwd, (manifest) => {
    for (const entity of manifest.entities) {
      if (entity.type === "settings") {
        entity.target = "packages/web";
      }
    }
  });

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((d) => d.code === "SETTINGS_TARGET_UNSUPPORTED"));
  assert.equal(result.writtenArtifacts.length, 0);
});

function monorepoPreset(source: "local" | "registry"): ResolvedPreset {
  return {
    source,
    ...(source === "registry" ? { registry: "corp" } : {}),
    definition: {
      id: "mono",
      name: "Mono",
      description: "co-located skill",
      operations: [{ type: "add_skill", id: "foo", target: "packages/web" }],
    },
    content: {
      skills: { foo: [{ path: "SKILL.md", content: "---\nname: foo\ndescription: co-located\n---\n\n# foo\n" }] },
    },
  };
}

test("local preset honors an operation target", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await applyResolvedPreset(cwd, monorepoPreset("local"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8"));
  const skill = manifest.entities.find(
    (entity: { type: string; id: string }) => entity.type === "skill" && entity.id === "foo",
  );
  assert.equal(skill.target, "packages/web");
});

test("registry preset strips the operation target (scaffolds at root)", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await applyResolvedPreset(cwd, monorepoPreset("registry"));

  const manifest = JSON.parse(await fs.readFile(path.join(cwd, ".harness/manifest.json"), "utf8"));
  const skill = manifest.entities.find(
    (entity: { type: string; id: string }) => entity.type === "skill" && entity.id === "foo",
  );
  assert.equal(skill.target, undefined);
});

test("two untargeted prompt-sections compose into one root CLAUDE.md (no conflict)", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addPromptSection("system");
  await engine.addPromptSection("web"); // no target -> also root, composes with system

  const result = await engine.apply();
  assert.ok(!result.diagnostics.some((d) => d.severity === "error"));
  assert.ok(await fileExists(path.join(cwd, "CLAUDE.md")));
  const composed = await fs.readFile(path.join(cwd, "CLAUDE.md"), "utf8");
  // Both section bodies are present in the single composed file.
  assert.ok(composed.includes("system"));
  assert.ok(composed.includes("web"));
});

test("routing diagnostic is not emitted for providers that produce no such artifact", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("codex");
  await engine.enableProvider("copilot");
  await engine.addCommand("fix-issue", { target: "packages/web" });

  const result = await engine.apply();
  // codex has no command artifact -> no misleading "routed to root" note
  assert.ok(!result.diagnostics.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "codex"));
  // copilot does emit a command -> the note is legitimate
  assert.ok(result.diagnostics.some((d) => d.code === "TARGET_ROUTED_TO_ROOT" && d.provider === "copilot"));
});

test("retargeting a skill deletes the stale output and writes the new one", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addSkill("foo", { target: "packages/web" });
  await engine.apply();
  assert.ok(await fileExists(path.join(cwd, "packages/web/.claude/skills/foo/SKILL.md")));

  await patchManifest(cwd, (manifest) => {
    for (const entity of manifest.entities) {
      if (entity.type === "skill" && entity.id === "foo") {
        entity.target = "packages/api";
      }
    }
  });

  await engine.apply();
  assert.ok(await fileExists(path.join(cwd, "packages/api/.claude/skills/foo/SKILL.md")));
  assert.ok(!(await fileExists(path.join(cwd, "packages/web/.claude/skills/foo/SKILL.md"))));
});
