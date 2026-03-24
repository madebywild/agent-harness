import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { CLI_ENTITY_TYPES } from "../types.js";
import type { CliResolvedContext, CommandId, CommandInput, CommandOutput } from "./contracts.js";
import { handleApply } from "./handlers/apply.js";
import { handleDoctor } from "./handlers/doctor.js";
import {
  handleAddCommand,
  handleAddHook,
  handleAddMcp,
  handleAddPrompt,
  handleAddSettings,
  handleAddSkill,
  handleAddSubagent,
  handleRemoveEntity,
} from "./handlers/entities.js";
import { handleInit } from "./handlers/init.js";
import { handleMigrate } from "./handlers/migrate.js";
import { handlePlan } from "./handlers/plan.js";
import { handlePresetApply, handlePresetDescribe, handlePresetList } from "./handlers/preset.js";
import { handleProviderDisable, handleProviderEnable } from "./handlers/provider.js";
import {
  handleRegistryAdd,
  handleRegistryDefaultSet,
  handleRegistryDefaultShow,
  handleRegistryList,
  handleRegistryPull,
  handleRegistryRemove,
  handleRegistryValidate,
} from "./handlers/registry.js";
import { handleSkillFind, handleSkillImport } from "./handlers/skills.js";
import { handleValidate } from "./handlers/validate.js";
import { handleWatch } from "./handlers/watch.js";

export interface CommandArgumentDefinition {
  name: string;
  required: boolean;
  description: string;
}

export interface CommandOptionDefinition {
  name: string;
  description: string;
  takesValue: boolean;
  defaultValue?: boolean | number | string;
}

export interface CommandDefinition {
  id: CommandId;
  path: readonly string[];
  description: string;
  args: readonly CommandArgumentDefinition[];
  options: readonly CommandOptionDefinition[];
  mutatesWorkspace: boolean;
  interactiveLabel?: string;
  run: (input: CommandInput, context: CliResolvedContext) => Promise<CommandOutput>;
}

function readStringArg(input: CommandInput, key: string, required = true): string | undefined {
  const value = input.args?.[key];
  if (value === undefined) {
    if (required) {
      throw new Error(`Missing required argument: ${key}`);
    }
    return undefined;
  }
  return value;
}

function readStringOption(input: CommandInput, key: string): string | undefined {
  const value = input.options?.[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Option '${key}' must be a string`);
  }

  return value;
}

function readRequiredStringOption(input: CommandInput, key: string): string {
  const value = readStringOption(input, key);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option: ${key}`);
  }

  return value;
}

function readBooleanOption(input: CommandInput, key: string, fallback = false): boolean {
  const value = input.options?.[key];
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }

  throw new Error(`Option '${key}' must be a boolean`);
}

function readNumberOption(input: CommandInput, key: string, fallback: number): number {
  const value = input.options?.[key];
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Option '${key}' must be a number`);
}

export const COMMAND_DEFINITIONS: readonly CommandDefinition[] = [
  {
    id: "init",
    path: ["init"],
    description: "Initialize .harness structure and state files",
    args: [],
    options: [
      {
        name: "force",
        description: "overwrite an existing .harness workspace",
        takesValue: false,
        defaultValue: false,
      },
      {
        name: "preset",
        description: "apply a bundled or local preset after initialization",
        takesValue: true,
      },
      {
        name: "delegate",
        description: `launch delegated prompt authoring with a provider CLI (${providerIdSchema.options.join(", ")})`,
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Initialize workspace",
    run: (input, context) =>
      handleInit(
        {
          force: readBooleanOption(input, "force"),
          preset: readStringOption(input, "preset"),
          delegate: readStringOption(input, "delegate"),
          json: readBooleanOption(input, "json"),
        },
        context,
      ),
  },
  {
    id: "preset.list",
    path: ["preset", "list"],
    description: "List available presets",
    args: [],
    options: [
      {
        name: "registry",
        description: "list presets from a configured registry",
        takesValue: true,
      },
    ],
    mutatesWorkspace: false,
    interactiveLabel: "List presets",
    run: (input, context) => handlePresetList({ registry: readStringOption(input, "registry") }, context),
  },
  {
    id: "preset.describe",
    path: ["preset", "describe"],
    description: "Describe a preset",
    args: [{ name: "presetId", required: true, description: "preset id" }],
    options: [
      {
        name: "registry",
        description: "load the preset from a configured registry",
        takesValue: true,
      },
    ],
    mutatesWorkspace: false,
    interactiveLabel: "Describe preset",
    run: (input, context) =>
      handlePresetDescribe(
        {
          presetId: readStringArg(input, "presetId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "preset.apply",
    path: ["preset", "apply"],
    description: "Apply a preset to the current workspace",
    args: [{ name: "presetId", required: true, description: "preset id" }],
    options: [
      {
        name: "registry",
        description: "load the preset from a configured registry",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Apply preset",
    run: (input, context) =>
      handlePresetApply(
        {
          presetId: readStringArg(input, "presetId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "skill.find",
    path: ["skill", "find"],
    description: "Search third-party skills via skills.sh",
    args: [{ name: "query", required: true, description: "search query" }],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "Find third-party skills",
    run: (input, context) =>
      handleSkillFind(
        {
          query: readStringArg(input, "query") ?? "",
        },
        context,
      ),
  },
  {
    id: "skill.import",
    path: ["skill", "import"],
    description: "Import a third-party skill into .harness/src/skills",
    args: [{ name: "source", required: true, description: "skills source (owner/repo, URL, or local path)" }],
    options: [
      {
        name: "skill",
        description: "upstream skill id to import",
        takesValue: true,
      },
      {
        name: "as",
        description: "target harness skill id",
        takesValue: true,
      },
      {
        name: "replace",
        description: "replace existing target skill when it already exists",
        takesValue: false,
        defaultValue: false,
      },
      {
        name: "allowUnsafe",
        description: "allow importing non-pass audited skills",
        takesValue: false,
        defaultValue: false,
      },
      {
        name: "allowUnaudited",
        description: "allow importing skills without published audits",
        takesValue: false,
        defaultValue: false,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Import third-party skill",
    run: (input, context) =>
      handleSkillImport(
        {
          source: readStringArg(input, "source") ?? "",
          upstreamSkill: readRequiredStringOption(input, "skill"),
          as: readStringOption(input, "as"),
          replace: readBooleanOption(input, "replace"),
          allowUnsafe: readBooleanOption(input, "allowUnsafe"),
          allowUnaudited: readBooleanOption(input, "allowUnaudited"),
        },
        context,
      ),
  },
  {
    id: "provider.enable",
    path: ["provider", "enable"],
    description: "Enable a provider",
    args: [
      {
        name: "provider",
        required: true,
        description: `provider id (${providerIdSchema.options.join(", ")})`,
      },
    ],
    options: [],
    mutatesWorkspace: true,
    interactiveLabel: "Enable provider",
    run: (input, context) => handleProviderEnable({ provider: readStringArg(input, "provider") ?? "" }, context),
  },
  {
    id: "provider.disable",
    path: ["provider", "disable"],
    description: "Disable a provider",
    args: [
      {
        name: "provider",
        required: true,
        description: `provider id (${providerIdSchema.options.join(", ")})`,
      },
    ],
    options: [],
    mutatesWorkspace: true,
    interactiveLabel: "Disable provider",
    run: (input, context) => handleProviderDisable({ provider: readStringArg(input, "provider") ?? "" }, context),
  },
  {
    id: "registry.list",
    path: ["registry", "list"],
    description: "List configured registries",
    args: [],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "List registries",
    run: (_input, context) => handleRegistryList(context),
  },
  {
    id: "registry.validate",
    path: ["registry", "validate"],
    description: "Validate a git registry repository structure and metadata",
    args: [],
    options: [
      {
        name: "path",
        description: "registry repository path",
        takesValue: true,
      },
      {
        name: "root",
        description: "registry root path inside repository",
        takesValue: true,
        defaultValue: ".",
      },
    ],
    mutatesWorkspace: false,
    interactiveLabel: "Validate registry repository",
    run: (input, context) =>
      handleRegistryValidate(
        {
          path: readStringOption(input, "path"),
          root: readStringOption(input, "root"),
        },
        context,
      ),
  },
  {
    id: "registry.add",
    path: ["registry", "add"],
    description: "Add a git registry",
    args: [{ name: "name", required: true, description: "registry id" }],
    options: [
      {
        name: "gitUrl",
        description: "git remote url",
        takesValue: true,
      },
      {
        name: "ref",
        description: "git branch/tag/ref to track",
        takesValue: true,
        defaultValue: "main",
      },
      {
        name: "root",
        description: "root path inside the git repository",
        takesValue: true,
      },
      {
        name: "tokenEnv",
        description: "environment variable name containing registry token",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add registry",
    run: (input, context) =>
      handleRegistryAdd(
        {
          name: readStringArg(input, "name") ?? "",
          gitUrl: readRequiredStringOption(input, "gitUrl"),
          ref: readStringOption(input, "ref"),
          root: readStringOption(input, "root"),
          tokenEnv: readStringOption(input, "tokenEnv"),
        },
        context,
      ),
  },
  {
    id: "registry.remove",
    path: ["registry", "remove"],
    description: "Remove a configured registry",
    args: [{ name: "name", required: true, description: "registry id" }],
    options: [],
    mutatesWorkspace: true,
    interactiveLabel: "Remove registry",
    run: (input, context) => handleRegistryRemove({ name: readStringArg(input, "name") ?? "" }, context),
  },
  {
    id: "registry.default.show",
    path: ["registry", "default", "show"],
    description: "Show the current default registry",
    args: [],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "Show default registry",
    run: (_input, context) => handleRegistryDefaultShow(context),
  },
  {
    id: "registry.default.set",
    path: ["registry", "default", "set"],
    description: "Set the default registry",
    args: [{ name: "name", required: true, description: "registry id" }],
    options: [],
    mutatesWorkspace: true,
    interactiveLabel: "Set default registry",
    run: (input, context) => handleRegistryDefaultSet({ name: readStringArg(input, "name") ?? "" }, context),
  },
  {
    id: "registry.pull",
    path: ["registry", "pull"],
    description: "Refresh imported entities from configured registries",
    args: [
      {
        name: "entityType",
        required: false,
        description: CLI_ENTITY_TYPES.join("|"),
      },
      {
        name: "id",
        required: false,
        description: "entity id; use 'system' for prompt",
      },
    ],
    options: [
      {
        name: "registry",
        description: "limit pull to one registry",
        takesValue: true,
      },
      {
        name: "force",
        description: "overwrite locally modified imported sources",
        takesValue: false,
        defaultValue: false,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Pull registry entities",
    run: (input, context) =>
      handleRegistryPull(
        {
          entityType: readStringArg(input, "entityType", false),
          id: readStringArg(input, "id", false),
          registry: readStringOption(input, "registry"),
          force: readBooleanOption(input, "force"),
        },
        context,
      ),
  },
  {
    id: "add.prompt",
    path: ["add", "prompt"],
    description: "Create the v1 system prompt entity",
    args: [],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add prompt",
    run: (input, context) => handleAddPrompt({ registry: readStringOption(input, "registry") }, context),
  },
  {
    id: "add.skill",
    path: ["add", "skill"],
    description: "Create a skill entity",
    args: [{ name: "skillId", required: true, description: "skill id" }],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add skill",
    run: (input, context) =>
      handleAddSkill(
        {
          skillId: readStringArg(input, "skillId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "add.mcp",
    path: ["add", "mcp"],
    description: "Create an MCP config entity",
    args: [{ name: "configId", required: true, description: "MCP config id" }],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add MCP config",
    run: (input, context) =>
      handleAddMcp(
        {
          configId: readStringArg(input, "configId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "add.subagent",
    path: ["add", "subagent"],
    description: "Create a subagent entity",
    args: [{ name: "subagentId", required: true, description: "subagent id" }],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add subagent",
    run: (input, context) =>
      handleAddSubagent(
        {
          subagentId: readStringArg(input, "subagentId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "add.hook",
    path: ["add", "hook"],
    description: "Create a lifecycle hook entity",
    args: [{ name: "hookId", required: true, description: "hook id" }],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add hook",
    run: (input, context) =>
      handleAddHook(
        {
          hookId: readStringArg(input, "hookId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "add.settings",
    path: ["add", "settings"],
    description: "Create a provider settings entity",
    args: [
      {
        name: "provider",
        required: true,
        description: `provider id (${providerIdSchema.options.join(", ")})`,
      },
    ],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add settings",
    run: (input, context) =>
      handleAddSettings(
        {
          provider: readStringArg(input, "provider") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "add.command",
    path: ["add", "command"],
    description: "Create a command entity",
    args: [{ name: "commandId", required: true, description: "command id" }],
    options: [
      {
        name: "registry",
        description: "registry id (defaults to configured default/local)",
        takesValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Add command",
    run: (input, context) =>
      handleAddCommand(
        {
          commandId: readStringArg(input, "commandId") ?? "",
          registry: readStringOption(input, "registry"),
        },
        context,
      ),
  },
  {
    id: "remove",
    path: ["remove"],
    description: "Remove an existing entity",
    args: [
      {
        name: "entityType",
        required: true,
        description: CLI_ENTITY_TYPES.join("|"),
      },
      {
        name: "id",
        required: true,
        description: "entity id; use 'system' for prompt",
      },
    ],
    options: [
      {
        name: "deleteSource",
        description: "keep scaffolded source files (advanced; may trigger ownership diagnostics)",
        takesValue: false,
        defaultValue: true,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Remove entity",
    run: (input, context) =>
      handleRemoveEntity(
        {
          entityType: readStringArg(input, "entityType") ?? "",
          id: readStringArg(input, "id") ?? "",
          deleteSource: readBooleanOption(input, "deleteSource", true),
        },
        context,
      ),
  },
  {
    id: "validate",
    path: ["validate"],
    description: "Validate manifest, ownership, and generation constraints",
    args: [],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "Validate workspace",
    run: (_input, context) => handleValidate(context),
  },
  {
    id: "doctor",
    path: ["doctor"],
    description: "Inspect workspace schema version health",
    args: [],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "Doctor",
    run: (_input, context) => handleDoctor(context),
  },
  {
    id: "migrate",
    path: ["migrate"],
    description: "Migrate workspace schema to latest supported version",
    args: [],
    options: [
      {
        name: "to",
        description: "migration target (latest)",
        takesValue: true,
        defaultValue: "latest",
      },
      {
        name: "dryRun",
        description: "preview migration actions without writing files",
        takesValue: false,
        defaultValue: false,
      },
    ],
    mutatesWorkspace: true,
    interactiveLabel: "Migrate workspace",
    run: (input, context) =>
      handleMigrate(
        {
          to: readStringOption(input, "to") ?? "latest",
          dryRun: readBooleanOption(input, "dryRun"),
        },
        context,
      ),
  },
  {
    id: "plan",
    path: ["plan"],
    description: "Show planned create/update/delete operations",
    args: [],
    options: [],
    mutatesWorkspace: false,
    interactiveLabel: "Plan",
    run: (_input, context) => handlePlan({ defaultInvocation: false }, context),
  },
  {
    id: "apply",
    path: ["apply"],
    description: "Apply planned operations and write managed outputs",
    args: [],
    options: [],
    mutatesWorkspace: true,
    interactiveLabel: "Apply",
    run: (_input, context) => handleApply(context),
  },
  {
    id: "watch",
    path: ["watch"],
    description: "Watch source files and apply on changes",
    args: [],
    options: [
      {
        name: "debounceMs",
        description: "debounce window in milliseconds",
        takesValue: true,
        defaultValue: 250,
      },
    ],
    mutatesWorkspace: false,
    interactiveLabel: "Watch",
    run: (input, context) =>
      handleWatch(
        {
          debounceMs: readNumberOption(input, "debounceMs", 250),
          json: readBooleanOption(input, "json", false),
        },
        context,
      ),
  },
  {
    id: "default.plan",
    path: [],
    description: "Default command behavior",
    args: [],
    options: [],
    mutatesWorkspace: false,
    run: (_input, context) => handlePlan({ defaultInvocation: true }, context),
  },
];

const COMMAND_BY_ID = new Map<CommandId, CommandDefinition>(
  COMMAND_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getCommandDefinition(commandId: CommandId): CommandDefinition {
  const definition = COMMAND_BY_ID.get(commandId);
  if (!definition) {
    throw new Error(`Unknown command '${commandId}'`);
  }

  return definition;
}

export function listCommandDefinitions(): readonly CommandDefinition[] {
  return COMMAND_DEFINITIONS;
}

export async function dispatch(
  commandId: CommandId,
  input: CommandInput,
  context: CliResolvedContext,
): Promise<CommandOutput> {
  const definition = getCommandDefinition(commandId);
  return definition.run(input, context);
}
