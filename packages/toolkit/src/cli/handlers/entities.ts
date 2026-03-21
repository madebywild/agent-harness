import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { HarnessEngine } from "../../engine.js";
import { CLI_ENTITY_TYPES, isCliEntityType } from "../../types.js";
import type { CliResolvedContext, EntityMutationOutput } from "../contracts.js";

export async function handleAddPrompt(
  input: { registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addPrompt({ registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.prompt",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "prompt",
      id: "system",
      message: "Added prompt entity 'system'.",
    },
  };
}

export async function handleAddSkill(
  input: { skillId: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addSkill(input.skillId, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.skill",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "skill",
      id: input.skillId,
      message: `Added skill '${input.skillId}'.`,
    },
  };
}

export async function handleAddMcp(
  input: { configId: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addMcp(input.configId, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.mcp",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "mcp",
      id: input.configId,
      message: `Added MCP config '${input.configId}'.`,
    },
  };
}

export async function handleAddSubagent(
  input: { subagentId: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addSubagent(input.subagentId, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.subagent",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "subagent",
      id: input.subagentId,
      message: `Added subagent '${input.subagentId}'.`,
    },
  };
}

export async function handleAddHook(
  input: { hookId: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addHook(input.hookId, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.hook",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "hook",
      id: input.hookId,
      message: `Added hook '${input.hookId}'.`,
    },
  };
}

export async function handleAddCommand(
  input: { commandId: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addCommand(input.commandId, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.command",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "command",
      id: input.commandId,
      message: `Added command '${input.commandId}'.`,
    },
  };
}

export async function handleAddSettings(
  input: { provider: string; registry?: string },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  const parsed = providerIdSchema.safeParse(input.provider);
  if (!parsed.success) {
    throw new Error(`provider must be one of: ${providerIdSchema.options.join(", ")}`);
  }

  const engine = new HarnessEngine(context.cwd);
  await engine.addSettings(parsed.data, { registry: input.registry });

  return {
    family: "entity-mutation",
    command: "add.settings",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      entityType: "settings",
      id: parsed.data,
      message: `Added settings '${parsed.data}'.`,
    },
  };
}

export async function handleRemoveEntity(
  input: { entityType: string; id: string; deleteSource: boolean },
  context: CliResolvedContext,
): Promise<EntityMutationOutput> {
  if (!isCliEntityType(input.entityType)) {
    throw new Error(`entity-type must be one of: ${CLI_ENTITY_TYPES.join(", ")}`);
  }

  const engine = new HarnessEngine(context.cwd);
  const removed = await engine.remove(input.entityType, input.id, input.deleteSource);

  return {
    family: "entity-mutation",
    command: "remove",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "remove",
      entityType: removed.entityType,
      id: removed.id,
      removed,
      message: `Removed ${removed.entityType} '${removed.id}'.`,
    },
  };
}
