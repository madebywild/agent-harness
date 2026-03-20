import { HarnessEngine } from "../../engine.js";
import { validateRegistryRepo } from "../../registry-validator.js";
import { CLI_ENTITY_TYPES, isCliEntityType } from "../../types.js";
import type { CliResolvedContext, RegistryOutput } from "../contracts.js";

export async function handleRegistryList(context: CliResolvedContext): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  const registries = await engine.listRegistries();

  return {
    family: "registry",
    command: "registry.list",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "list",
      registries,
    },
  };
}

export async function handleRegistryValidate(
  input: { path?: string; root?: string },
  context: CliResolvedContext,
): Promise<RegistryOutput> {
  const result = await validateRegistryRepo({
    repoPath: input.path ?? context.cwd,
    rootPath: input.root,
  });

  return {
    family: "registry",
    command: "registry.validate",
    ok: result.valid,
    diagnostics: result.diagnostics,
    exitCode: result.valid ? 0 : 1,
    data: {
      operation: "validate",
      result,
    },
  };
}

export async function handleRegistryAdd(
  input: { name: string; gitUrl: string; ref?: string; root?: string; tokenEnv?: string },
  context: CliResolvedContext,
): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.addRegistry(input.name, {
    gitUrl: input.gitUrl,
    ref: input.ref,
    rootPath: input.root,
    tokenEnvVar: input.tokenEnv,
  });

  return {
    family: "registry",
    command: "registry.add",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "add",
      name: input.name,
      message: `Added registry '${input.name}'.`,
    },
  };
}

export async function handleRegistryRemove(
  input: { name: string },
  context: CliResolvedContext,
): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.removeRegistry(input.name);

  return {
    family: "registry",
    command: "registry.remove",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "remove",
      name: input.name,
      message: `Removed registry '${input.name}'.`,
    },
  };
}

export async function handleRegistryDefaultShow(context: CliResolvedContext): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  const registry = await engine.getDefaultRegistry();

  return {
    family: "registry",
    command: "registry.default.show",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "default.show",
      registry,
    },
  };
}

export async function handleRegistryDefaultSet(
  input: { name: string },
  context: CliResolvedContext,
): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  await engine.setDefaultRegistry(input.name);

  return {
    family: "registry",
    command: "registry.default.set",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "default.set",
      name: input.name,
      message: `Default registry set to '${input.name}'.`,
    },
  };
}

function parseOptionalEntityType(
  entityType: string | undefined,
): undefined | "prompt" | "skill" | "mcp" | "subagent" | "hook" {
  if (!entityType) {
    return undefined;
  }

  if (!isCliEntityType(entityType)) {
    throw new Error(`entity-type must be one of: ${CLI_ENTITY_TYPES.join(", ")}`);
  }

  return entityType;
}

export async function handleRegistryPull(
  input: { entityType?: string; id?: string; registry?: string; force?: boolean },
  context: CliResolvedContext,
): Promise<RegistryOutput> {
  const engine = new HarnessEngine(context.cwd);
  const result = await engine.pullRegistry({
    entityType: parseOptionalEntityType(input.entityType),
    id: input.id,
    registry: input.registry,
    force: input.force,
  });

  return {
    family: "registry",
    command: "registry.pull",
    ok: true,
    diagnostics: [],
    exitCode: 0,
    data: {
      operation: "pull",
      result,
    },
  };
}
