/**
 * E2E User Journey: preset `extends` with categorized skills + prompt-sections (Gitea testcontainer)
 *
 * Mirrors the registry's example-preset / example-preset-extended contract:
 *   registry with category-organized skills + prompt-sections (with tags) and a child preset that
 *   extends a parent → init → add registry → apply the child preset → verify inherited skills and
 *   prompt-sections (parent-first, deduped, non-inheritable ops excluded), composition order in the
 *   generated prompt, and single add-by-bare-id of a categorized skill / prompt-section.
 */

import assert from "node:assert/strict";
import { after, before, describe, type TestContext, test } from "node:test";
import { mkTmpRepo } from "../../helpers.ts";
import { readWorkspaceJson, readWorkspaceText, runHarnessCli } from "../cli-helpers.ts";
import { GiteaRegistryFixture, type RegistryRepoFixture } from "../gitea-registry-fixture.ts";

interface ManifestJson {
  entities: Array<{ type: string; id: string; registry: string }>;
}

function skipIfContainerRuntimeUnavailable(t: TestContext, reason: string | undefined): boolean {
  if (!reason) return false;
  t.skip(reason);
  return true;
}

function section(name: string, description: string, tags: string | null, heading: string): string {
  const tagsLine = tags ? `\ntags: ${tags}` : "";
  return `---\nname: ${name}\ndescription: ${description}${tagsLine}\n---\n\n## ${heading}\n\n${heading} body.\n`;
}

function skill(name: string, tags: string | null, body: string): string {
  const tagsLine = tags ? `\ntags: ${tags}` : "";
  return `---\nname: ${name}\ndescription: ${name} skill${tagsLine}\n---\n\n# ${name}\n\n${body}\n`;
}

const REGISTRY_FILES: Record<string, string> = {
  "harness-registry.json": JSON.stringify({ version: 1, title: "Wild", description: "Wild shared registry" }, null, 2),

  // Root skills, organized into category folders (ids unique across categories).
  "skills/engineering/skill-a/SKILL.md": skill("skill-a", "[eng]", "Parent-referenced skill."),
  "skills/engineering/commit/SKILL.md": skill("commit", "[git, workflow]", "Write a conventional commit."),
  "skills/pm/grill/SKILL.md": skill("grill", null, "Interview relentlessly."),

  // Root prompt-sections, categorized, with optional tags.
  "prompt-sections/misc/root-section/SECTION.md": section("root-section", "Root section", "[base]", "Root Section"),
  "prompt-sections/engineering/code-conventions/SECTION.md": section(
    "code-conventions",
    "TS conventions",
    "[typescript]",
    "Code Conventions",
  ),

  // Parent preset: references root skills/sections + embeds a section and an mcp (non-inheritable).
  "presets/base/preset.json": JSON.stringify(
    {
      id: "base",
      name: "Base",
      description: "Base preset with referenced + embedded inheritable entities and a non-inherited mcp.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "add_prompt_section", id: "root-section", source: { registry: "wild" } },
        { type: "add_prompt_section", id: "base-embedded" },
        { type: "add_skill", id: "skill-a", source: { registry: "wild" } },
        { type: "add_skill", id: "grill", source: { registry: "wild" } },
        { type: "add_mcp", id: "base-mcp" },
      ],
    },
    null,
    2,
  ),
  "presets/base/prompt-sections/base-embedded/SECTION.md": section(
    "base-embedded",
    "Embedded base section",
    null,
    "Base Embedded",
  ),
  "presets/base/mcp/base-mcp.json": JSON.stringify({ servers: { base: { command: "base-mcp" } } }, null, 2),

  // Child preset: extends base; adds its own embedded section, a referenced skill, and settings.
  "presets/child/preset.json": JSON.stringify(
    {
      id: "child",
      name: "Child",
      extends: "base",
      description: "Extends base; inherits skills + prompt-sections but not the mcp.",
      operations: [
        { type: "enable_provider", provider: "claude" },
        { type: "enable_provider", provider: "codex" },
        { type: "add_prompt_section", id: "child-embedded" },
        { type: "add_skill", id: "commit", source: { registry: "wild" } },
        { type: "add_settings", provider: "claude" },
      ],
    },
    null,
    2,
  ),
  "presets/child/prompt-sections/child-embedded/SECTION.md": section(
    "child-embedded",
    "Embedded child section",
    null,
    "Child Embedded",
  ),
  "presets/child/settings/claude.json": JSON.stringify({ permissions: { allow: ["Read"] } }, null, 2),
};

const fixture = new GiteaRegistryFixture();
let unavailableReason: string | undefined;

before(async () => {
  try {
    await fixture.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Container runtime unavailable")) {
      unavailableReason = message;
      return;
    }
    throw error;
  }
});

after(async () => {
  await fixture.stop();
});

describe("preset extends workflow journey", { timeout: 300_000, concurrency: false }, () => {
  let workspace: string;
  let repo: RegistryRepoFixture;

  test("phase 1 — create registry with categorized skills, prompt-sections, and extends presets", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;
    repo = await fixture.createRegistryRepo({ files: REGISTRY_FILES, private: false, namePrefix: "wild" });
  });

  test("phase 2 — init and add the registry (validate accepts tags + category layout)", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;
    workspace = await mkTmpRepo();
    await runHarnessCli(workspace, ["init"]);
    await runHarnessCli(workspace, [
      "registry",
      "add",
      "wild",
      "--git-url",
      repo.readOnlyUrl,
      "--ref",
      repo.defaultRef,
    ]);
  });

  test("phase 3 — apply child preset resolves the extends chain", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["preset", "apply", "child", "--registry", "wild"]);

    const manifest = await readWorkspaceJson<ManifestJson>(workspace, ".harness/manifest.json");

    // Skills: inherited skill-a + grill (from base) plus child's own commit; nothing else.
    const skills = manifest.entities
      .filter((entry) => entry.type === "skill")
      .map((entry) => entry.id)
      .sort();
    assert.deepEqual(skills, ["commit", "grill", "skill-a"]);

    // Prompt-sections compose parent-first then child: root-section, base-embedded, child-embedded.
    // Manifest entity array order is the composition order (no explicit `order` field).
    const sections = manifest.entities.filter((entry) => entry.type === "prompt_section").map((entry) => entry.id);
    assert.deepEqual(sections, ["root-section", "base-embedded", "child-embedded"]);

    // Non-inheritable parent op (base-mcp) is NOT inherited; child's own settings are applied.
    assert.equal(
      manifest.entities.some((entry) => entry.id === "base-mcp"),
      false,
      "base preset's mcp must not be inherited",
    );
    assert.ok(manifest.entities.some((entry) => entry.type === "settings" && entry.id === "claude"));
  });

  test("phase 4 — apply generates a prompt composed in inheritance order", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    await runHarnessCli(workspace, ["apply"]);

    const claude = await readWorkspaceText(workspace, "CLAUDE.md");
    const rootIdx = claude.indexOf("## Root Section");
    const baseIdx = claude.indexOf("## Base Embedded");
    const childIdx = claude.indexOf("## Child Embedded");
    assert.ok(rootIdx >= 0 && baseIdx >= 0 && childIdx >= 0, "all sections composed into CLAUDE.md");
    assert.ok(rootIdx < baseIdx && baseIdx < childIdx, "sections composed in inheritance order");

    assert.ok(await readWorkspaceText(workspace, ".claude/skills/skill-a/SKILL.md"));
    assert.ok(await readWorkspaceText(workspace, ".claude/skills/commit/SKILL.md"));
  });

  test("phase 5 — add a categorized skill and prompt-section by bare id", async (t) => {
    if (skipIfContainerRuntimeUnavailable(t, unavailableReason)) return;

    const freshWorkspace = await mkTmpRepo();
    await runHarnessCli(freshWorkspace, ["init"]);
    await runHarnessCli(freshWorkspace, [
      "registry",
      "add",
      "wild",
      "--git-url",
      repo.readOnlyUrl,
      "--ref",
      repo.defaultRef,
    ]);

    // `commit` lives under skills/engineering/, `code-conventions` under prompt-sections/engineering/;
    // both are fetched by bare id.
    await runHarnessCli(freshWorkspace, ["add", "skill", "commit", "--registry", "wild"]);
    await runHarnessCli(freshWorkspace, ["add", "prompt-section", "code-conventions", "--registry", "wild"]);

    assert.ok(await readWorkspaceText(freshWorkspace, ".harness/src/skills/commit/SKILL.md"));
    const conventions = await readWorkspaceText(
      freshWorkspace,
      ".harness/src/prompt-sections/code-conventions/SECTION.md",
    );
    assert.match(conventions, /Code Conventions/u);
  });
});
