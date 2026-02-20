#!/usr/bin/env node
import { providerIdSchema } from "@agent-harness/manifest-schema";
import { Command } from "commander";
import { HarnessEngine } from "./engine.js";

const program = new Command();

program
  .name("harness")
  .description("Unified .harness source-of-truth manager for AI agent provider configs")
  .option("--cwd <path>", "working directory", process.cwd());

program
  .command("init")
  .description("Initialize .harness structure and state files")
  .option("--force", "overwrite an existing .harness workspace", false)
  .action(async (options: { force: boolean }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.init({ force: options.force });
    console.log("Initialized .harness workspace.");
  });

const providerCommand = program.command("provider").description("Enable or disable providers");

providerCommand
  .command("enable")
  .argument("<provider>", `provider id (${providerIdSchema.options.join(", ")})`)
  .action(async (provider: string) => {
    const parsed = providerIdSchema.parse(provider);
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.enableProvider(parsed);
    console.log(`Enabled provider '${parsed}'.`);
  });

providerCommand
  .command("disable")
  .argument("<provider>", `provider id (${providerIdSchema.options.join(", ")})`)
  .action(async (provider: string) => {
    const parsed = providerIdSchema.parse(provider);
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.disableProvider(parsed);
    console.log(`Disabled provider '${parsed}'.`);
  });

const addCommand = program.command("add").description("Add source entities under .harness/src");

addCommand
  .command("prompt")
  .description("Create the v1 system prompt entity")
  .action(async () => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addPrompt();
    console.log("Added prompt entity 'system'.");
  });

addCommand
  .command("skill")
  .description("Create a skill entity")
  .argument("<skill-id>", "skill id")
  .action(async (skillId: string) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addSkill(skillId);
    console.log(`Added skill '${skillId}'.`);
  });

addCommand
  .command("mcp")
  .description("Create an MCP config entity")
  .argument("<config-id>", "MCP config id")
  .action(async (configId: string) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addMcp(configId);
    console.log(`Added MCP config '${configId}'.`);
  });

program
  .command("remove")
  .description("Remove an existing entity")
  .argument("<entity-type>", "prompt|skill|mcp")
  .argument("<id>", "entity id; use 'system' for prompt")
  .option("--delete-source", "delete scaffolded source files", false)
  .action(async (entityType: string, id: string, options: { deleteSource: boolean }) => {
    if (!["prompt", "skill", "mcp"].includes(entityType)) {
      throw new Error("entity-type must be one of: prompt, skill, mcp");
    }
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.remove(entityType as "prompt" | "skill" | "mcp", id, options.deleteSource);
    console.log(`Removed ${entityType} '${id}'.`);
  });

program
  .command("validate")
  .description("Validate manifest, ownership, and generation constraints")
  .action(async () => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const result = await engine.validate();

    if (result.diagnostics.length === 0) {
      console.log("Validation passed.");
      return;
    }

    for (const diagnostic of result.diagnostics) {
      const path = diagnostic.path ? ` (${diagnostic.path})` : "";
      console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${path}`);
    }

    if (!result.valid) {
      process.exitCode = 1;
    }
  });

program
  .command("plan")
  .description("Show planned create/update/delete operations")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const result = await engine.plan();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const operation of result.operations) {
        const provider = operation.provider ? ` [${operation.provider}]` : "";
        console.log(`${operation.type.toUpperCase()}${provider} ${operation.path} - ${operation.reason}`);
      }

      if (result.diagnostics.length > 0) {
        console.log("\nDiagnostics:");
      }
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.path ? ` (${diagnostic.path})` : "";
        console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
      }
    }

    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      process.exitCode = 1;
    }
  });

program
  .command("apply")
  .description("Apply planned operations and write managed outputs")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const result = await engine.apply();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const operation of result.operations) {
        if (operation.type === "noop") {
          continue;
        }
        const provider = operation.provider ? ` [${operation.provider}]` : "";
        console.log(`${operation.type.toUpperCase()}${provider} ${operation.path} - ${operation.reason}`);
      }

      if (result.diagnostics.length > 0) {
        console.log("\nDiagnostics:");
      }
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.path ? ` (${diagnostic.path})` : "";
        console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
      }

      console.log(`\nWrote ${result.writtenArtifacts.length} artifact(s), removed ${result.prunedArtifacts.length}.`);
    }

    if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      process.exitCode = 1;
    }
  });

program
  .command("watch")
  .description("Watch source files and apply on changes")
  .option("--debounce <ms>", "debounce window in milliseconds", "250")
  .action(async (options: { debounce: string }) => {
    const debounceMs = Number(options.debounce);
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new Error("--debounce must be a non-negative number");
    }

    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.watch(debounceMs);
  });

program.action(async () => {
  const engine = new HarnessEngine(program.opts().cwd as string);
  const result = await engine.plan();

  if (result.operations.length === 0 && result.diagnostics.length === 0) {
    console.log("No changes detected.");
    return;
  }

  for (const operation of result.operations) {
    const provider = operation.provider ? ` [${operation.provider}]` : "";
    console.log(`${operation.type.toUpperCase()}${provider} ${operation.path} - ${operation.reason}`);
  }

  if (result.diagnostics.length > 0) {
    console.log("\nDiagnostics:");
  }
  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.path ? ` (${diagnostic.path})` : "";
    console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
  }

  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    process.exitCode = 1;
  }
});

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
