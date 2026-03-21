import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as TOML from "@iarna/toml";
import {
  parseRegistryManifest,
  providerIdSchema,
  type RegistryDefinition,
  type RegistryManifest,
  type RegistryRevision,
} from "@madebywild/agent-harness-manifest";
import { readPresetPackageFromDir } from "./preset-packages.js";
import { listFilesRecursively } from "./repository.js";
import type { EntityType, RegistryId, ResolvedPresetSource } from "./types.js";
import { normalizeRelativePath, parseJsonAsRecord, parseTomlAsRecord, sha256, stableStringify } from "./utils.js";

const execFileAsync = promisify(execFile);

const REGISTRY_MANIFEST_FILE = "harness-registry.json";

export class RegistryError extends Error {
  readonly code: string;
  readonly registry: string;
  readonly pathValue?: string;

  constructor(code: string, registry: string, message: string, pathValue?: string) {
    super(`${code}: ${message}`);
    this.name = "RegistryError";
    this.code = code;
    this.registry = registry;
    this.pathValue = pathValue;
  }
}

export interface FetchedEntityBase {
  readonly type: EntityType;
  readonly id: string;
  readonly registry: RegistryId;
  readonly registryManifest: RegistryManifest;
  readonly registryRevision: RegistryRevision;
  readonly importedSourceSha256: string;
}

export interface FetchedPromptEntity extends FetchedEntityBase {
  readonly type: "prompt";
  readonly sourceText: string;
}

export interface FetchedSkillFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}

export interface FetchedSkillEntity extends FetchedEntityBase {
  readonly type: "skill";
  readonly files: FetchedSkillFile[];
}

export interface FetchedMcpEntity extends FetchedEntityBase {
  readonly type: "mcp_config";
  readonly sourceJson: Record<string, unknown>;
}

export interface FetchedSubagentEntity extends FetchedEntityBase {
  readonly type: "subagent";
  readonly sourceText: string;
}

export interface FetchedHookEntity extends FetchedEntityBase {
  readonly type: "hook";
  readonly sourceJson: Record<string, unknown>;
}

export interface FetchedCommandEntity extends FetchedEntityBase {
  readonly type: "command";
  readonly sourceText: string;
}

export interface FetchedSettingsEntity extends FetchedEntityBase {
  readonly type: "settings";
  readonly provider: "codex" | "claude" | "copilot";
  readonly sourcePayload: Record<string, unknown>;
}

export type FetchedRegistryEntity =
  | FetchedPromptEntity
  | FetchedSkillEntity
  | FetchedMcpEntity
  | FetchedSubagentEntity
  | FetchedHookEntity
  | FetchedSettingsEntity
  | FetchedCommandEntity;

export interface FetchedPreset {
  readonly id: string;
  readonly registry: RegistryId;
  readonly registryManifest: RegistryManifest;
  readonly registryRevision: RegistryRevision;
  readonly definition: Awaited<ReturnType<typeof readPresetPackageFromDir>>["definition"];
  readonly content: ResolvedPresetSource;
}

export async function fetchEntityFromRegistry(
  registryId: RegistryId,
  definition: RegistryDefinition,
  entityType: EntityType,
  id: string,
): Promise<FetchedRegistryEntity> {
  const checkout = await checkoutRegistry(registryId, definition);
  try {
    return await fetchEntityFromCheckout(registryId, checkout, entityType, id);
  } finally {
    await cleanupTempDir(checkout.tempRoot);
  }
}

export async function fetchEntityFromCheckout(
  registryId: RegistryId,
  checkout: CheckedOutRegistry,
  entityType: EntityType,
  id: string,
): Promise<FetchedRegistryEntity> {
  const { checkoutDir, registryManifest, registryRevision, rootPath } = checkout;

  if (entityType === "prompt") {
    if (id !== "system") {
      throw new RegistryError("REGISTRY_ENTITY_NOT_FOUND", registryId, `Prompt id must be 'system', received '${id}'`);
    }

    const sourceText = await readFileWithNotFound(
      path.join(checkoutDir, rootPath, "prompts", "system.md"),
      registryId,
      `Prompt 'system' not found in registry '${registryId}'`,
    );

    return {
      type: "prompt",
      id,
      registry: registryId,
      sourceText,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(sourceText),
    };
  }

  if (entityType === "skill") {
    const skillDir = path.join(checkoutDir, rootPath, "skills", id);
    const files = await readSkillFiles(skillDir, registryId, id);
    const normalizedFiles = files
      .filter((entry) => !isSkillOverrideFile(entry.path))
      .map((entry) => ({ path: entry.path, sha256: entry.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path));

    return {
      type: "skill",
      id,
      registry: registryId,
      files,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(stableStringify(normalizedFiles)),
    };
  }

  if (entityType === "mcp_config") {
    const mcpPath = path.join(checkoutDir, rootPath, "mcp", `${id}.json`);
    const mcpText = await readFileWithNotFound(
      mcpPath,
      registryId,
      `MCP config '${id}' not found in registry '${registryId}'`,
    );

    let sourceJson: Record<string, unknown>;
    try {
      const parsed = JSON.parse(mcpText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("MCP config must be a JSON object");
      }
      sourceJson = parsed as Record<string, unknown>;
    } catch (error) {
      throw new RegistryError(
        "REGISTRY_FETCH_FAILED",
        registryId,
        `MCP config '${id}' in registry '${registryId}' is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    return {
      type: "mcp_config",
      id,
      registry: registryId,
      sourceJson,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(stableStringify(sourceJson)),
    };
  }

  if (entityType === "hook") {
    const hookPath = path.join(checkoutDir, rootPath, "hooks", `${id}.json`);
    const hookText = await readFileWithNotFound(
      hookPath,
      registryId,
      `Hook '${id}' not found in registry '${registryId}'`,
    );

    let sourceJson: Record<string, unknown>;
    try {
      const parsed = JSON.parse(hookText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Hook config must be a JSON object");
      }
      sourceJson = parsed as Record<string, unknown>;
    } catch (error) {
      throw new RegistryError(
        "REGISTRY_FETCH_FAILED",
        registryId,
        `Hook '${id}' in registry '${registryId}' is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    return {
      type: "hook",
      id,
      registry: registryId,
      sourceJson,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(stableStringify(sourceJson)),
    };
  }

  if (entityType === "subagent") {
    const subagentPath = path.join(checkoutDir, rootPath, "subagents", `${id}.md`);
    const sourceText = await readFileWithNotFound(
      subagentPath,
      registryId,
      `Subagent '${id}' not found in registry '${registryId}'`,
    );

    return {
      type: "subagent",
      id,
      registry: registryId,
      sourceText,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(sourceText),
    };
  }

  if (entityType === "command") {
    const commandPath = path.join(checkoutDir, rootPath, "commands", `${id}.md`);
    const sourceText = await readFileWithNotFound(
      commandPath,
      registryId,
      `Command '${id}' not found in registry '${registryId}'`,
    );

    return {
      type: "command",
      id,
      registry: registryId,
      sourceText,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(sourceText),
    };
  }

  if (entityType === "settings") {
    const parsedProvider = providerIdSchema.safeParse(id);
    if (!parsedProvider.success) {
      throw new RegistryError(
        "REGISTRY_ENTITY_NOT_FOUND",
        registryId,
        `Settings id must be one of: ${providerIdSchema.options.join(", ")}`,
      );
    }

    const provider = parsedProvider.data;
    const fileName = provider === "codex" ? "codex.toml" : `${provider}.json`;
    const settingsPath = path.join(checkoutDir, rootPath, "settings", fileName);
    const sourceText = await readFileWithNotFound(
      settingsPath,
      registryId,
      `Settings '${provider}' not found in registry '${registryId}'`,
    );

    let sourcePayload: Record<string, unknown>;
    try {
      sourcePayload = provider === "codex" ? parseTomlAsRecord(sourceText, TOML) : parseJsonAsRecord(sourceText);
    } catch (error) {
      const format = provider === "codex" ? "TOML" : "JSON";
      throw new RegistryError(
        "REGISTRY_FETCH_FAILED",
        registryId,
        `Settings '${provider}' in registry '${registryId}' is invalid ${format}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    return {
      type: "settings",
      id,
      provider,
      registry: registryId,
      sourcePayload,
      registryManifest,
      registryRevision,
      importedSourceSha256: sha256(stableStringify(sourcePayload)),
    };
  }

  throw new RegistryError(
    "REGISTRY_FETCH_FAILED",
    registryId,
    `Unsupported entity type '${entityType}' for registry fetch`,
  );
}

export async function listPresetsFromRegistry(
  registryId: RegistryId,
  definition: RegistryDefinition,
): Promise<FetchedPreset[]> {
  const { checkoutDir, registryManifest, registryRevision, tempRoot, rootPath } = await checkoutRegistry(
    registryId,
    definition,
  );

  try {
    const presetsRoot = path.join(checkoutDir, rootPath, "presets");
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(presetsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const presets: FetchedPreset[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const loaded = await readPresetPackageFromDir(path.join(presetsRoot, entry.name));
      presets.push({
        id: loaded.definition.id,
        registry: registryId,
        registryManifest,
        registryRevision,
        definition: loaded.definition,
        content: loaded.content,
      });
    }

    presets.sort((left, right) => left.id.localeCompare(right.id));
    return presets;
  } finally {
    await cleanupTempDir(tempRoot);
  }
}

export async function fetchPresetFromRegistry(
  registryId: RegistryId,
  definition: RegistryDefinition,
  presetId: string,
): Promise<FetchedPreset> {
  const presets = await listPresetsFromRegistry(registryId, definition);
  const preset = presets.find((entry) => entry.id === presetId);
  if (!preset) {
    throw new RegistryError(
      "REGISTRY_ENTITY_NOT_FOUND",
      registryId,
      `Preset '${presetId}' not found in registry '${registryId}'`,
    );
  }
  return preset;
}

export interface CheckedOutRegistry {
  checkoutDir: string;
  registryManifest: RegistryManifest;
  registryRevision: RegistryRevision;
  tempRoot: string;
  rootPath: string;
}

export async function checkoutRegistry(
  registryId: RegistryId,
  definition: RegistryDefinition,
): Promise<CheckedOutRegistry> {
  if (definition.type === "local") {
    throw new RegistryError("REGISTRY_FETCH_FAILED", registryId, "Local registry does not support remote fetch");
  }

  const authToken = definition.tokenEnvVar ? process.env[definition.tokenEnvVar] : undefined;
  if (definition.tokenEnvVar && !authToken) {
    throw new RegistryError(
      "REGISTRY_AUTH_MISSING",
      registryId,
      `Missing required token environment variable '${definition.tokenEnvVar}' for registry '${registryId}'`,
    );
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-registry-"));
  const checkoutDir = path.join(tempRoot, "repo");

  try {
    const cloneCommand = buildGitCloneCommand(definition, authToken, checkoutDir);
    await execFileAsync("git", cloneCommand.args, {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
      },
    });
  } catch (error) {
    await cleanupTempDir(tempRoot);
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Failed to fetch git registry '${registryId}': ${cloneErrorMessage(error, authToken)}`,
    );
  }

  try {
    const commit = await resolveCommit(checkoutDir, registryId);
    const registryManifest = await readRegistryManifest(checkoutDir, registryId);
    const rootPath = definition.rootPath ? normalizeRelativePath(definition.rootPath) : ".";
    return {
      checkoutDir,
      registryManifest,
      registryRevision: {
        kind: "git",
        ref: definition.ref,
        commit,
      },
      tempRoot,
      rootPath,
    };
  } catch (error) {
    await cleanupTempDir(tempRoot);
    throw error;
  }
}

async function resolveCommit(checkoutDir: string, registryId: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", checkoutDir, "rev-parse", "HEAD"], {
      env: process.env,
    });
    const commit = stdout.trim();
    if (!commit) {
      throw new Error("empty commit hash");
    }
    return commit;
  } catch (error) {
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Failed to resolve commit for registry '${registryId}': ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

async function readRegistryManifest(checkoutDir: string, registryId: string): Promise<RegistryManifest> {
  const manifestPath = path.join(checkoutDir, REGISTRY_MANIFEST_FILE);

  let text: string;
  try {
    text = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new RegistryError(
        "REGISTRY_MANIFEST_MISSING",
        registryId,
        `Registry '${registryId}' is missing required ${REGISTRY_MANIFEST_FILE}`,
        REGISTRY_MANIFEST_FILE,
      );
    }
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Failed to read registry manifest for '${registryId}': ${error instanceof Error ? error.message : "unknown error"}`,
      REGISTRY_MANIFEST_FILE,
    );
  }

  try {
    return parseRegistryManifest(JSON.parse(text) as unknown);
  } catch (error) {
    throw new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      registryId,
      `Registry '${registryId}' has invalid ${REGISTRY_MANIFEST_FILE}: ${error instanceof Error ? error.message : "unknown error"}`,
      REGISTRY_MANIFEST_FILE,
    );
  }
}

async function readSkillFiles(skillDir: string, registryId: string, skillId: string): Promise<FetchedSkillFile[]> {
  let rootStat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    rootStat = await fs.stat(skillDir);
  } catch (error) {
    if (isNotFound(error)) {
      throw new RegistryError(
        "REGISTRY_ENTITY_NOT_FOUND",
        registryId,
        `Skill '${skillId}' not found in registry '${registryId}'`,
      );
    }
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Failed to stat skill '${skillId}' from registry '${registryId}': ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!rootStat.isDirectory()) {
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Skill '${skillId}' is not a directory in registry '${registryId}'`,
    );
  }

  const files = await listFilesRecursively(skillDir);

  if (files.length === 0) {
    throw new RegistryError(
      "REGISTRY_ENTITY_NOT_FOUND",
      registryId,
      `Skill '${skillId}' has no files in registry '${registryId}'`,
    );
  }

  const loaded: FetchedSkillFile[] = [];
  for (const absolutePath of files) {
    const relativePath = normalizeRelativePath(path.relative(skillDir, absolutePath).replace(/\\/g, "/"));
    const content = await fs.readFile(absolutePath, "utf8");
    loaded.push({
      path: relativePath,
      content,
      sha256: sha256(content),
    });
  }

  loaded.sort((left, right) => left.path.localeCompare(right.path));

  if (!loaded.some((file) => file.path === "SKILL.md")) {
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Skill '${skillId}' in registry '${registryId}' must include SKILL.md`,
    );
  }

  return loaded;
}

async function readFileWithNotFound(filePath: string, registryId: string, notFoundMessage: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new RegistryError("REGISTRY_ENTITY_NOT_FOUND", registryId, notFoundMessage);
    }
    throw new RegistryError(
      "REGISTRY_FETCH_FAILED",
      registryId,
      `Failed reading registry source file: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

export async function cleanupTempDir(tempDir: string): Promise<void> {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
    // best-effort temp cleanup
  });
}

function isSkillOverrideFile(relativePath: string): boolean {
  return /^OVERRIDES\.[^.]+\.ya?ml$/u.test(path.basename(relativePath));
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
  );
}

function buildGitCloneCommand(
  definition: Extract<RegistryDefinition, { type: "git" }>,
  authToken: string | undefined,
  checkoutDir: string,
): { args: string[] } {
  const args = ["clone", "--depth", "1", "--branch", definition.ref];
  if (authToken) {
    args.push("-c", `http.extraHeader=Authorization: ${toAuthHeader(authToken)}`);
  }
  args.push(definition.url, checkoutDir);
  return { args };
}

function toAuthHeader(rawToken: string): string {
  const token = rawToken.trim();
  if (/^(Bearer|Basic)\s+/u.test(token)) {
    return token;
  }

  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

function cloneErrorMessage(error: unknown, authToken: string | undefined): string {
  if (!(error instanceof Error)) {
    return "unknown error";
  }

  if (!authToken) {
    return error.message;
  }

  const headerValue = toAuthHeader(authToken);
  return error.message
    .replaceAll(authToken, "<redacted>")
    .replaceAll(headerValue, "<redacted>")
    .replaceAll(Buffer.from(`x-access-token:${authToken.trim()}`).toString("base64"), "<redacted>");
}
