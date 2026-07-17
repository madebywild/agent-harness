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

test("multiple prompts generate a root and a per-package CLAUDE.md", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addPrompt();
  await engine.addPrompt({ id: "web", target: "packages/web" });

  await engine.apply();

  assert.ok(await fileExists(path.join(cwd, "CLAUDE.md")));
  assert.ok(await fileExists(path.join(cwd, "packages/web/CLAUDE.md")));
});

test("targeted prompt is skipped for copilot but root prompt still feeds it", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("copilot");
  await engine.addPrompt();
  await engine.addPrompt({ id: "web", target: "packages/web" });

  const result = await engine.apply();

  assert.ok(await fileExists(path.join(cwd, ".github/copilot-instructions.md")));
  assert.ok(!(await fileExists(path.join(cwd, "packages/web/.github/copilot-instructions.md"))));
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === "TARGET_PROMPT_SKIPPED" && d.provider === "copilot" && d.entityId === "web",
    ),
  );
});

test("targeting the only prompt still gives a non-nesting provider its root instructions", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.enableProvider("copilot");
  await engine.addPrompt({ id: "web", target: "packages/web" }); // the ONLY prompt, targeted

  const result = await engine.apply();

  // Claude nests it; Copilot (no untargeted prompt to claim root) still gets the root file.
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

test("two prompts sharing a target report a clear PROMPT_TARGET_CONFLICT", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  await engine.enableProvider("claude");
  await engine.addPrompt();
  await engine.addPrompt({ id: "web" }); // no target -> also root, collides with system

  const result = await engine.apply();
  assert.ok(result.diagnostics.some((d) => d.code === "PROMPT_TARGET_CONFLICT"));
  assert.equal(result.writtenArtifacts.length, 0);
});

test("a preset with more than one add_prompt operation is rejected", async () => {
  const cwd = await mkTmpRepo();
  const engine = new HarnessEngine(cwd);

  await engine.init();
  const preset: ResolvedPreset = {
    source: "local",
    definition: {
      id: "twoprompts",
      name: "Two",
      description: "two prompts",
      operations: [{ type: "add_prompt" }, { type: "add_prompt", id: "web", target: "packages/web" }],
    },
    content: { prompt: "# shared\n" },
  };

  await assert.rejects(() => applyResolvedPreset(cwd, preset), /PRESET_UNSUPPORTED/u);
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
