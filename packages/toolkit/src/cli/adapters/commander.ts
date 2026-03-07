import { createRequire } from "node:module";
import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { Command } from "commander";
import { CLI_ENTITY_TYPES } from "../../types.js";
import type { CliResolvedContext, CommandId, CommandInput, CommandOutput } from "../contracts.js";
import { ensureInteractiveFeasible } from "../utils/runtime.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../../package.json") as { version?: string };

interface CommanderAdapterApi {
  execute: (input: CommandInput, context: CliResolvedContext) => Promise<CommandOutput>;
  renderOutput: (output: CommandOutput, durationMs: number, json: boolean, context: CliResolvedContext) => void;
  runInteractive: (context: CliResolvedContext) => Promise<{ exitCode: number }>;
}

interface CommanderRunResult {
  exitCode: number;
}

interface GlobalOptions {
  cwd: string;
  json?: boolean;
}

interface JsonOption {
  json?: boolean;
}

function withInvocationContext(base: CliResolvedContext, cwd: string): CliResolvedContext {
  return {
    ...base,
    cwd,
  };
}

function resolveInvocationJson(program: Command, options?: JsonOption): boolean {
  const globals = program.opts<GlobalOptions>();
  return Boolean(options?.json ?? globals.json);
}

function resolveInvocationCwd(program: Command, base: CliResolvedContext): string {
  const globals = program.opts<GlobalOptions>();
  return globals.cwd || base.cwd;
}

function addJsonOption(command: Command): Command {
  return command.option("--json", "emit machine-readable JSON");
}

async function executeWithRendering(
  input: CommandInput,
  context: CliResolvedContext,
  json: boolean,
  api: CommanderAdapterApi,
): Promise<number> {
  const startedAt = context.now();
  const output = await api.execute(input, context);
  const durationMs = context.now() - startedAt;
  api.renderOutput(output, durationMs, json, context);
  if (output.runtime) {
    await output.runtime.blockUntilExit;
  }
  return output.exitCode;
}

export async function runCommanderAdapter(
  argv: readonly string[],
  baseContext: CliResolvedContext,
  api: CommanderAdapterApi,
): Promise<CommanderRunResult> {
  const program = new Command();
  let exitCode = 0;

  const runCommand = async (input: CommandInput, options?: JsonOption): Promise<void> => {
    const cwd = resolveInvocationCwd(program, baseContext);
    const json = resolveInvocationJson(program, options);
    const commandContext = withInvocationContext(baseContext, cwd);
    const commandExitCode = await executeWithRendering(input, commandContext, json, api);
    if (commandExitCode !== 0) {
      exitCode = commandExitCode;
    }
  };

  program
    .name("harness")
    .description("Unified .harness source-of-truth manager for AI agent provider configs")
    .version(packageJson.version ?? "0.0.0")
    .option("--cwd <path>", "working directory", baseContext.cwd)
    .option("--interactive", "force interactive mode when available")
    .option("--no-interactive", "disable interactive mode")
    .option("--json", "emit machine-readable JSON");

  addJsonOption(
    program
      .command("init")
      .description("Initialize .harness structure and state files")
      .option("--force", "overwrite an existing .harness workspace", false)
      .action(async (options: { force: boolean; json?: boolean }) => {
        await runCommand(
          {
            command: "init",
            options: {
              force: options.force,
            },
          },
          options,
        );
      }),
  );

  const providerCommand = program.command("provider").description("Enable or disable providers");

  addJsonOption(
    providerCommand
      .command("enable")
      .argument("<provider>", `provider id (${providerIdSchema.options.join(", ")})`)
      .description("Enable a provider")
      .action(async (provider: string, options: JsonOption) => {
        await runCommand(
          {
            command: "provider.enable",
            args: {
              provider,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    providerCommand
      .command("disable")
      .argument("<provider>", `provider id (${providerIdSchema.options.join(", ")})`)
      .description("Disable a provider")
      .action(async (provider: string, options: JsonOption) => {
        await runCommand(
          {
            command: "provider.disable",
            args: {
              provider,
            },
          },
          options,
        );
      }),
  );

  const registryCommand = program.command("registry").description("Manage registries and pull imported entities");

  addJsonOption(
    registryCommand
      .command("list")
      .description("List configured registries")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "registry.list" }, options);
      }),
  );

  addJsonOption(
    registryCommand
      .command("validate")
      .description("Validate a git registry repository structure and metadata")
      .option("--path <dir>", "registry repository path")
      .option("--root <relative>", "registry root path inside repository", ".")
      .action(async (options: { path?: string; root?: string; json?: boolean }) => {
        await runCommand(
          {
            command: "registry.validate",
            options: {
              path: options.path,
              root: options.root,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    registryCommand
      .command("add")
      .description("Add a git registry")
      .argument("<name>", "registry id")
      .requiredOption("--git-url <url>", "git remote url")
      .option("--ref <ref>", "git branch/tag/ref to track", "main")
      .option("--root <path>", "root path inside the git repository")
      .option("--token-env <name>", "environment variable name containing registry token")
      .action(
        async (
          name: string,
          options: {
            gitUrl: string;
            ref?: string;
            root?: string;
            tokenEnv?: string;
            json?: boolean;
          },
        ) => {
          await runCommand(
            {
              command: "registry.add",
              args: {
                name,
              },
              options: {
                gitUrl: options.gitUrl,
                ref: options.ref,
                root: options.root,
                tokenEnv: options.tokenEnv,
              },
            },
            options,
          );
        },
      ),
  );

  addJsonOption(
    registryCommand
      .command("remove")
      .description("Remove a configured registry")
      .argument("<name>", "registry id")
      .action(async (name: string, options: JsonOption) => {
        await runCommand(
          {
            command: "registry.remove",
            args: {
              name,
            },
          },
          options,
        );
      }),
  );

  const registryDefaultCommand = registryCommand.command("default").description("Manage default registry");

  addJsonOption(
    registryDefaultCommand
      .command("show")
      .description("Show the current default registry")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "registry.default.show" }, options);
      }),
  );

  addJsonOption(
    registryDefaultCommand
      .command("set")
      .description("Set the default registry")
      .argument("<name>", "registry id")
      .action(async (name: string, options: JsonOption) => {
        await runCommand(
          {
            command: "registry.default.set",
            args: {
              name,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    registryCommand
      .command("pull")
      .description("Refresh imported entities from configured registries")
      .argument("[entity-type]", CLI_ENTITY_TYPES.join("|"))
      .argument("[id]", "entity id; use 'system' for prompt")
      .option("--registry <registry>", "limit pull to one registry")
      .option("--force", "overwrite locally modified imported sources", false)
      .action(
        async (
          entityType: string | undefined,
          id: string | undefined,
          options: { registry?: string; force?: boolean; json?: boolean },
        ) => {
          await runCommand(
            {
              command: "registry.pull",
              args: {
                entityType,
                id,
              },
              options: {
                registry: options.registry,
                force: options.force,
              },
            },
            options,
          );
        },
      ),
  );

  const addCommand = program.command("add").description("Add source entities under .harness/src");

  addJsonOption(
    addCommand
      .command("prompt")
      .description("Create the v1 system prompt entity")
      .option("--registry <registry>", "registry id (defaults to configured default/local)")
      .action(async (options: { registry?: string; json?: boolean }) => {
        await runCommand(
          {
            command: "add.prompt",
            options: {
              registry: options.registry,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    addCommand
      .command("skill")
      .description("Create a skill entity")
      .argument("<skill-id>", "skill id")
      .option("--registry <registry>", "registry id (defaults to configured default/local)")
      .action(async (skillId: string, options: { registry?: string; json?: boolean }) => {
        await runCommand(
          {
            command: "add.skill",
            args: {
              skillId,
            },
            options: {
              registry: options.registry,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    addCommand
      .command("mcp")
      .description("Create an MCP config entity")
      .argument("<config-id>", "MCP config id")
      .option("--registry <registry>", "registry id (defaults to configured default/local)")
      .action(async (configId: string, options: { registry?: string; json?: boolean }) => {
        await runCommand(
          {
            command: "add.mcp",
            args: {
              configId,
            },
            options: {
              registry: options.registry,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    addCommand
      .command("subagent")
      .description("Create a subagent entity")
      .argument("<subagent-id>", "subagent id")
      .option("--registry <registry>", "registry id (defaults to configured default/local)")
      .action(async (subagentId: string, options: { registry?: string; json?: boolean }) => {
        await runCommand(
          {
            command: "add.subagent",
            args: {
              subagentId,
            },
            options: {
              registry: options.registry,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    program
      .command("remove")
      .description("Remove an existing entity")
      .argument("<entity-type>", CLI_ENTITY_TYPES.join("|"))
      .argument("<id>", "entity id; use 'system' for prompt")
      .option("--no-delete-source", "keep scaffolded source files (advanced; may trigger ownership diagnostics)")
      .action(async (entityType: string, id: string, options: { deleteSource: boolean; json?: boolean }) => {
        await runCommand(
          {
            command: "remove",
            args: {
              entityType,
              id,
            },
            options: {
              deleteSource: options.deleteSource,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    program
      .command("validate")
      .description("Validate manifest, ownership, and generation constraints")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "validate" }, options);
      }),
  );

  addJsonOption(
    program
      .command("doctor")
      .description("Inspect workspace schema version health")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "doctor" }, options);
      }),
  );

  addJsonOption(
    program
      .command("migrate")
      .description("Migrate workspace schema to latest supported version")
      .option("--to <target>", "migration target (latest)", "latest")
      .option("--dry-run", "preview migration actions without writing files", false)
      .action(async (options: { to: string; dryRun: boolean; json?: boolean }) => {
        await runCommand(
          {
            command: "migrate",
            options: {
              to: options.to,
              dryRun: options.dryRun,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    program
      .command("plan")
      .description("Show planned create/update/delete operations")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "plan" }, options);
      }),
  );

  addJsonOption(
    program
      .command("apply")
      .description("Apply planned operations and write managed outputs")
      .action(async (options: JsonOption) => {
        await runCommand({ command: "apply" }, options);
      }),
  );

  addJsonOption(
    program
      .command("watch")
      .description("Watch source files and apply on changes")
      .option("--debounce <ms>", "debounce window in milliseconds", "250")
      .action(async (options: { debounce: string; json?: boolean }) => {
        const json = resolveInvocationJson(program, options);
        await runCommand(
          {
            command: "watch",
            options: {
              debounceMs: options.debounce,
              json,
            },
          },
          options,
        );
      }),
  );

  addJsonOption(
    program
      .command("ui")
      .description("Launch interactive prompt mode")
      .action(async () => {
        const cwd = resolveInvocationCwd(program, baseContext);
        const invocationContext = withInvocationContext(baseContext, cwd);
        ensureInteractiveFeasible({
          isTty: invocationContext.isTty,
          isCi: invocationContext.isCi,
        });

        const result = await api.runInteractive(invocationContext);
        if (result.exitCode !== 0) {
          exitCode = result.exitCode;
        }
      }),
  );

  program.action(async (options: JsonOption) => {
    await runCommand({ command: "default.plan" }, options);
  });

  // Commander parseAsync expects argv in [node, script, ...args] form.
  await program.parseAsync(["harness", "harness", ...argv]);
  return { exitCode };
}
