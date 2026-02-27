#!/usr/bin/env node
import { createRequire } from "node:module";
import { providerIdSchema } from "@agent-harness/manifest-schema";
import { Command } from "commander";
import { HarnessEngine } from "./engine.js";
import { CLI_ENTITY_TYPES, isCliEntityType } from "./types.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: string };

const program = new Command();

program
  .name("harness")
  .description("Unified .harness source-of-truth manager for AI agent provider configs")
  .version(packageJson.version ?? "0.0.0")
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

const registryCommand = program.command("registry").description("Manage registries and pull imported entities");

registryCommand
  .command("list")
  .description("List configured registries")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const registries = await engine.listRegistries();
    if (options.json) {
      console.log(JSON.stringify(registries, null, 2));
      return;
    }

    for (const entry of registries) {
      const marker = entry.isDefault ? " (default)" : "";
      if (entry.definition.type === "local") {
        console.log(`${entry.id}${marker} - local`);
      } else {
        const root = entry.definition.rootPath ? ` root=${entry.definition.rootPath}` : "";
        const token = entry.definition.tokenEnvVar ? ` tokenEnv=${entry.definition.tokenEnvVar}` : "";
        console.log(
          `${entry.id}${marker} - git url=${entry.definition.url} ref=${entry.definition.ref}${root}${token}`,
        );
      }
    }
  });

registryCommand
  .command("add")
  .description("Add a git registry")
  .argument("<name>", "registry id")
  .requiredOption("--git-url <url>", "git remote url")
  .option("--ref <ref>", "git branch/tag/ref to track", "main")
  .option("--root <path>", "root path inside the git repository")
  .option("--token-env <name>", "environment variable name containing registry token")
  .action(async (name: string, options: { gitUrl: string; ref?: string; root?: string; tokenEnv?: string }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addRegistry(name, {
      gitUrl: options.gitUrl,
      ref: options.ref,
      rootPath: options.root,
      tokenEnvVar: options.tokenEnv,
    });
    console.log(`Added registry '${name}'.`);
  });

registryCommand
  .command("remove")
  .description("Remove a configured registry")
  .argument("<name>", "registry id")
  .action(async (name: string) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.removeRegistry(name);
    console.log(`Removed registry '${name}'.`);
  });

const registryDefaultCommand = registryCommand.command("default").description("Manage default registry");

registryDefaultCommand
  .command("show")
  .description("Show the current default registry")
  .action(async () => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const registry = await engine.getDefaultRegistry();
    console.log(registry);
  });

registryDefaultCommand
  .command("set")
  .description("Set the default registry")
  .argument("<name>", "registry id")
  .action(async (name: string) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.setDefaultRegistry(name);
    console.log(`Default registry set to '${name}'.`);
  });

registryCommand
  .command("pull")
  .description("Refresh imported entities from configured registries")
  .argument("[entity-type]", CLI_ENTITY_TYPES.join("|"))
  .argument("[id]", "entity id; use 'system' for prompt")
  .option("--registry <registry>", "limit pull to one registry")
  .option("--force", "overwrite locally modified imported sources", false)
  .action(
    async (entityType: string | undefined, id: string | undefined, options: { registry?: string; force?: boolean }) => {
      if (entityType && !isCliEntityType(entityType)) {
        throw new Error(`entity-type must be one of: ${CLI_ENTITY_TYPES.join(", ")}`);
      }
      const parsedEntityType = entityType && isCliEntityType(entityType) ? entityType : undefined;

      const engine = new HarnessEngine(program.opts().cwd as string);
      const result = await engine.pullRegistry({
        entityType: parsedEntityType,
        id,
        registry: options.registry,
        force: options.force,
      });

      if (result.updatedEntities.length === 0) {
        console.log("No imported entities matched pull criteria.");
        return;
      }

      for (const updated of result.updatedEntities) {
        console.log(`Pulled ${updated.type} '${updated.id}'.`);
      }
    },
  );

const addCommand = program.command("add").description("Add source entities under .harness/src");

addCommand
  .command("prompt")
  .description("Create the v1 system prompt entity")
  .option("--registry <registry>", "registry id (defaults to configured default/local)")
  .action(async (options: { registry?: string }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addPrompt({ registry: options.registry });
    console.log("Added prompt entity 'system'.");
  });

addCommand
  .command("skill")
  .description("Create a skill entity")
  .argument("<skill-id>", "skill id")
  .option("--registry <registry>", "registry id (defaults to configured default/local)")
  .action(async (skillId: string, options: { registry?: string }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addSkill(skillId, { registry: options.registry });
    console.log(`Added skill '${skillId}'.`);
  });

addCommand
  .command("mcp")
  .description("Create an MCP config entity")
  .argument("<config-id>", "MCP config id")
  .option("--registry <registry>", "registry id (defaults to configured default/local)")
  .action(async (configId: string, options: { registry?: string }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    await engine.addMcp(configId, { registry: options.registry });
    console.log(`Added MCP config '${configId}'.`);
  });

program
  .command("remove")
  .description("Remove an existing entity")
  .argument("<entity-type>", CLI_ENTITY_TYPES.join("|"))
  .argument("<id>", "entity id; use 'system' for prompt")
  .option("--no-delete-source", "keep scaffolded source files (advanced; may trigger ownership diagnostics)")
  .action(async (entityType: string, id: string, options: { deleteSource: boolean }) => {
    if (!isCliEntityType(entityType)) {
      throw new Error(`entity-type must be one of: ${CLI_ENTITY_TYPES.join(", ")}`);
    }
    const engine = new HarnessEngine(program.opts().cwd as string);
    const removed = await engine.remove(entityType, id, options.deleteSource);
    console.log(`Removed ${entityType} '${removed.id}'.`);
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
  .command("doctor")
  .description("Inspect workspace schema version health")
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { json?: boolean }) => {
    const engine = new HarnessEngine(program.opts().cwd as string);
    const result = await engine.doctor({ json: options.json });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const file of result.files) {
        const provider = file.provider ? ` [${file.provider}]` : "";
        const versionLabel = typeof file.version === "number" ? ` v${file.version}` : "";
        console.log(
          `${file.status.toUpperCase()}${provider} ${file.path ?? "<unknown>"}${versionLabel} - ${file.message}`,
        );
      }

      if (result.diagnostics.length > 0) {
        console.log("\nDiagnostics:");
      }
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.path ? ` (${diagnostic.path})` : "";
        console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
      }
    }

    if (!result.healthy) {
      process.exitCode = 1;
    }
  });

program
  .command("migrate")
  .description("Migrate workspace schema to latest supported version")
  .option("--to <target>", "migration target (latest)", "latest")
  .option("--dry-run", "preview migration actions without writing files", false)
  .option("--json", "emit machine-readable JSON")
  .action(async (options: { to: string; dryRun: boolean; json?: boolean }) => {
    if (options.to !== "latest") {
      throw new Error("--to currently supports only 'latest'");
    }

    const engine = new HarnessEngine(program.opts().cwd as string);
    const result = await engine.migrate({
      to: "latest",
      dryRun: options.dryRun,
      json: options.json,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const action of result.actions) {
        console.log(`${action.action.toUpperCase()} ${action.path} - ${action.details}`);
      }

      if (result.backupRoot) {
        console.log(`Backup: ${result.backupRoot}`);
      }

      if (result.diagnostics.length > 0) {
        console.log("\nDiagnostics:");
      }
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.path ? ` (${diagnostic.path})` : "";
        console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`);
      }
    }

    if (!result.success) {
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
