import { providerIdSchema } from "@agent-harness/manifest-schema";
import { cancel, confirm, intro, isCancel, outro, select, text } from "@clack/prompts";
import ora from "ora";
import { CLI_ENTITY_TYPES } from "../../types.js";
import { getCommandDefinition } from "../command-registry.js";
import type { CliResolvedContext, CommandId, CommandInput, CommandOutput } from "../contracts.js";

export interface InteractiveExecutionApi {
  execute: (input: CommandInput) => Promise<CommandOutput>;
  renderOutput: (output: CommandOutput, durationMs: number, json: boolean) => void;
}

interface InteractiveRunResult {
  exitCode: number;
}

const INTERACTIVE_COMMAND_IDS: readonly CommandId[] = [
  "init",
  "provider.enable",
  "provider.disable",
  "registry.list",
  "registry.default.show",
  "registry.default.set",
  "registry.add",
  "registry.remove",
  "registry.pull",
  "add.prompt",
  "add.skill",
  "add.mcp",
  "add.subagent",
  "remove",
  "validate",
  "doctor",
  "migrate",
  "plan",
  "apply",
];

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSelectedValue<T>(value: T): T | null {
  if (isCancel(value)) {
    return null;
  }

  return value;
}

async function promptOptionalText(message: string): Promise<string | undefined | null> {
  const value = await text({
    message,
    placeholder: "optional",
  });

  const resolved = getSelectedValue(value);
  if (resolved === null) {
    return null;
  }

  if (typeof resolved !== "string") {
    return undefined;
  }

  const trimmed = resolved.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function promptRequiredText(message: string): Promise<string | null> {
  const value = await text({
    message,
    validate: (entry: string) => (entry.trim().length === 0 ? "This value is required" : undefined),
  });

  const resolved = getSelectedValue(value);
  if (resolved === null) {
    return null;
  }

  return String(resolved);
}

async function promptCommandInput(command: CommandId): Promise<CommandInput | null> {
  switch (command) {
    case "init": {
      const force = await confirm({
        message: "Overwrite existing .harness workspace if present?",
        initialValue: false,
      });
      const resolvedForce = getSelectedValue(force);
      if (resolvedForce === null) {
        return null;
      }

      return {
        command,
        options: {
          force: Boolean(resolvedForce),
        },
      };
    }
    case "provider.enable":
    case "provider.disable": {
      const provider = await select({
        message: "Select provider",
        options: providerIdSchema.options.map((entry) => ({
          value: entry,
          label: entry,
        })),
      });
      const resolvedProvider = getSelectedValue(provider);
      if (resolvedProvider === null) {
        return null;
      }

      return {
        command,
        args: {
          provider: String(resolvedProvider),
        },
      };
    }
    case "registry.add": {
      const name = await promptRequiredText("Registry name");
      if (name === null) {
        return null;
      }

      const gitUrl = await promptRequiredText("Git URL");
      if (gitUrl === null) {
        return null;
      }

      const ref = await promptOptionalText("Git ref (default: main)");
      if (ref === null) {
        return null;
      }

      const root = await promptOptionalText("Registry root path");
      if (root === null) {
        return null;
      }

      const tokenEnv = await promptOptionalText("Token env var");
      if (tokenEnv === null) {
        return null;
      }

      return {
        command,
        args: {
          name,
        },
        options: {
          gitUrl,
          ref,
          root,
          tokenEnv,
        },
      };
    }
    case "registry.remove":
    case "registry.default.set": {
      const name = await promptRequiredText("Registry name");
      if (name === null) {
        return null;
      }

      return {
        command,
        args: {
          name,
        },
      };
    }
    case "registry.pull": {
      const entityType = await select({
        message: "Entity type filter",
        options: [
          { value: "", label: "All entity types" },
          ...CLI_ENTITY_TYPES.map((entry) => ({ value: entry, label: entry })),
        ],
      });
      const resolvedEntityType = getSelectedValue(entityType);
      if (resolvedEntityType === null) {
        return null;
      }

      const id = await promptOptionalText("Entity id filter");
      if (id === null) {
        return null;
      }

      const registry = await promptOptionalText("Registry filter");
      if (registry === null) {
        return null;
      }

      const force = await confirm({
        message: "Overwrite locally modified imported sources?",
        initialValue: false,
      });
      const resolvedForce = getSelectedValue(force);
      if (resolvedForce === null) {
        return null;
      }

      return {
        command,
        args: {
          entityType: String(resolvedEntityType) || undefined,
          id,
        },
        options: {
          registry,
          force: Boolean(resolvedForce),
        },
      };
    }
    case "add.prompt": {
      const registry = await promptOptionalText("Registry id");
      if (registry === null) {
        return null;
      }

      return {
        command,
        options: {
          registry,
        },
      };
    }
    case "add.skill": {
      const skillId = await promptRequiredText("Skill id");
      if (skillId === null) {
        return null;
      }

      const registry = await promptOptionalText("Registry id");
      if (registry === null) {
        return null;
      }

      return {
        command,
        args: {
          skillId,
        },
        options: {
          registry,
        },
      };
    }
    case "add.mcp": {
      const configId = await promptRequiredText("MCP config id");
      if (configId === null) {
        return null;
      }

      const registry = await promptOptionalText("Registry id");
      if (registry === null) {
        return null;
      }

      return {
        command,
        args: {
          configId,
        },
        options: {
          registry,
        },
      };
    }
    case "add.subagent": {
      const subagentId = await promptRequiredText("Subagent id");
      if (subagentId === null) {
        return null;
      }

      const registry = await promptOptionalText("Registry id");
      if (registry === null) {
        return null;
      }

      return {
        command,
        args: {
          subagentId,
        },
        options: {
          registry,
        },
      };
    }
    case "remove": {
      const entityType = await select({
        message: "Entity type",
        options: CLI_ENTITY_TYPES.map((entry) => ({ value: entry, label: entry })),
      });
      const resolvedEntityType = getSelectedValue(entityType);
      if (resolvedEntityType === null) {
        return null;
      }

      const id = await promptRequiredText("Entity id");
      if (id === null) {
        return null;
      }

      const deleteSource = await confirm({
        message: "Delete source files too?",
        initialValue: true,
      });
      const resolvedDeleteSource = getSelectedValue(deleteSource);
      if (resolvedDeleteSource === null) {
        return null;
      }

      return {
        command,
        args: {
          entityType: String(resolvedEntityType),
          id,
        },
        options: {
          deleteSource: Boolean(resolvedDeleteSource),
        },
      };
    }
    case "migrate": {
      const dryRun = await confirm({
        message: "Run as dry-run only?",
        initialValue: false,
      });
      const resolvedDryRun = getSelectedValue(dryRun);
      if (resolvedDryRun === null) {
        return null;
      }

      return {
        command,
        options: {
          to: "latest",
          dryRun: Boolean(resolvedDryRun),
        },
      };
    }
    default:
      return { command };
  }
}

function requiresConfirmation(command: CommandId): boolean {
  return getCommandDefinition(command).mutatesWorkspace;
}

export async function runInteractiveAdapter(
  context: CliResolvedContext,
  api: InteractiveExecutionApi,
): Promise<InteractiveRunResult> {
  intro("Harness interactive mode");
  let exitCode = 0;

  while (true) {
    const command = await select({
      message: "Select a command",
      options: [
        ...INTERACTIVE_COMMAND_IDS.map((id) => ({
          value: id,
          label: getCommandDefinition(id).interactiveLabel ?? getCommandDefinition(id).description,
        })),
        {
          value: "exit",
          label: "Exit",
        },
      ],
    });

    const resolvedCommand = getSelectedValue(command);
    if (resolvedCommand === null || resolvedCommand === "exit") {
      break;
    }

    const parsedCommand = String(resolvedCommand) as CommandId;
    const input = await promptCommandInput(parsedCommand);
    if (input === null) {
      cancel("Cancelled command input.");
      continue;
    }

    if (requiresConfirmation(parsedCommand)) {
      const shouldRun = await confirm({
        message: `Run '${getCommandDefinition(parsedCommand).interactiveLabel ?? parsedCommand}' now?`,
        initialValue: true,
      });
      const resolvedShouldRun = getSelectedValue(shouldRun);
      if (resolvedShouldRun === null) {
        cancel("Cancelled command execution.");
        continue;
      }

      if (!resolvedShouldRun) {
        continue;
      }
    }

    const startedAt = context.now();
    const spinner = ora({
      text: `Running ${getCommandDefinition(parsedCommand).interactiveLabel ?? parsedCommand}...`,
    }).start();

    try {
      const output = await api.execute(input);
      const durationMs = context.now() - startedAt;
      spinner.succeed("Done.");
      api.renderOutput(output, durationMs, false);

      if (output.exitCode !== 0) {
        exitCode = output.exitCode;
      }
    } catch (error) {
      spinner.fail("Command failed.");
      context.stderr(`Error: ${toErrorMessage(error)}`);
      exitCode = 1;
    }
  }

  outro("Interactive session ended.");
  return { exitCode };
}
