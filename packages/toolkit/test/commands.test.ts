import assert from "node:assert/strict";
import test from "node:test";
import { parseCanonicalCommandDocument } from "../src/commands.ts";

test("parseCanonicalCommandDocument parses valid frontmatter and body", () => {
  const raw = `---
description: "Fix the issue described in the arguments"
---

Please fix the issue: $ARGUMENTS
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/fix-issue.md", "fix-issue");

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.canonical);
  assert.equal(result.canonical.id, "fix-issue");
  assert.equal(result.canonical.description, "Fix the issue described in the arguments");
  assert.equal(result.canonical.argumentHint, undefined);
  assert.equal(result.canonical.body, "Please fix the issue: $ARGUMENTS");
});

test("parseCanonicalCommandDocument captures argument-hint", () => {
  const raw = `---
description: "Run a code review"
argument-hint: "[file-path]"
---

Review the code at $ARGUMENTS.
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/review.md", "review");

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.canonical);
  assert.equal(result.canonical.argumentHint, "[file-path]");
});

test("parseCanonicalCommandDocument returns COMMAND_DESCRIPTION_MISSING when description absent", () => {
  const raw = `---
argument-hint: "[file]"
---

Do something.
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/bad.md", "bad");

  assert.ok(result.diagnostics.some((d) => d.code === "COMMAND_DESCRIPTION_MISSING"));
  assert.equal(result.canonical, undefined);
});

test("parseCanonicalCommandDocument returns COMMAND_DESCRIPTION_MISSING for body-only (no frontmatter)", () => {
  const raw = "Do something without a description.\n";

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/no-fm.md", "no-fm");

  assert.ok(result.diagnostics.some((d) => d.code === "COMMAND_DESCRIPTION_MISSING"));
  assert.equal(result.canonical, undefined);
});

test("parseCanonicalCommandDocument returns COMMAND_DESCRIPTION_MISSING for empty description", () => {
  const raw = `---
description: "   "
---

Body text.
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/empty.md", "empty");

  assert.ok(result.diagnostics.some((d) => d.code === "COMMAND_DESCRIPTION_MISSING"));
  assert.equal(result.canonical, undefined);
});

test("parseCanonicalCommandDocument trims whitespace from description and argumentHint", () => {
  const raw = `---
description: "  Spaced description  "
argument-hint: "  [arg]  "
---

Body.
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/trim.md", "trim");

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.canonical);
  assert.equal(result.canonical.description, "Spaced description");
  assert.equal(result.canonical.argumentHint, "[arg]");
});

test("parseCanonicalCommandDocument sets argumentHint to undefined when empty string after trim", () => {
  const raw = `---
description: "Do something"
argument-hint: "   "
---

Body.
`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/nohint.md", "nohint");

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.canonical);
  assert.equal(result.canonical.argumentHint, undefined);
});

test("parseCanonicalCommandDocument handles body trimming", () => {
  const raw = `---
description: "Do something"
---


  Leading whitespace body

`;

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/ws.md", "ws");

  assert.equal(result.diagnostics.length, 0);
  assert.ok(result.canonical);
  assert.equal(result.canonical.body, "Leading whitespace body");
});

test("parseCanonicalCommandDocument sets entityId on diagnostics", () => {
  const raw = "No frontmatter, no description.";

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/x.md", "my-cmd");

  assert.ok(result.diagnostics.some((d) => d.entityId === "my-cmd"));
});

test("parseCanonicalCommandDocument sets path on diagnostics", () => {
  const raw = "No description.";
  const sourcePath = ".harness/src/commands/x.md";

  const result = parseCanonicalCommandDocument(raw, sourcePath, "x");

  assert.ok(result.diagnostics.some((d) => d.path === sourcePath));
});

test("parseCanonicalCommandDocument captures name, model, agent, and tools array", () => {
  const raw = [
    "---",
    'description: "Demo"',
    'name: "Demo command"',
    'model: "gpt-5"',
    'agent: "code-review"',
    'tools: ["editFiles", "search"]',
    "---",
    "",
    "Body.",
  ].join("\n");

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/demo.md", "demo");

  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics));
  assert.equal(result.canonical?.name, "Demo command");
  assert.equal(result.canonical?.model, "gpt-5");
  assert.equal(result.canonical?.agent, "code-review");
  assert.deepEqual(result.canonical?.tools, ["editFiles", "search"]);
});

test("parseCanonicalCommandDocument coerces single-string tools into array", () => {
  const raw = ["---", 'description: "Demo"', 'tools: "editFiles"', "---", "", "Body."].join("\n");

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/single-tool.md", "single-tool");

  assert.deepEqual(result.canonical?.tools, ["editFiles"]);
});

test("parseCanonicalCommandDocument rejects non-string tools entries", () => {
  const raw = ["---", 'description: "Demo"', "tools: [1, 2]", "---", "", "Body."].join("\n");

  const result = parseCanonicalCommandDocument(raw, ".harness/src/commands/bad.md", "bad");

  assert.ok(result.diagnostics.some((d) => d.code === "COMMAND_TOOLS_INVALID"));
  assert.equal(result.canonical, undefined);
});
