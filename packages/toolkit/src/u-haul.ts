import { execFile as nodeExecFile } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import * as TOML from "@iarna/toml";
import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import matter from "gray-matter";
import { parseCanonicalCommandDocument } from "./commands.js";
import {
  addCommandEntity,
  addHookEntity,
  addMcpEntity,
  addPromptEntity,
  addSettingsEntity,
  addSkillEntity,
  addSubagentEntity,
} from "./engine/entities.js";
import { validateEntityId } from "./engine/utils.js";
import { HarnessEngine } from "./engine.js";
import { parseCanonicalHookDocument } from "./hooks.js";
import { renderSubagentMarkdown } from "./provider-adapters/subagents.js";
import { listFilesRecursively } from "./repository.js";
import type { ApplyResult, CanonicalHookEvent, CanonicalSubagent, CliEntityType, ProviderId } from "./types.js";
import {
  deepEqual,
  exists,
  normalizeRelativePath,
  parseJsonAsRecord,
  parseTomlAsRecord,
  readTextIfExists,
  sha256,
  withSingleTrailingNewline,
} from "./utils.js";

const execFileAsync = promisify(nodeExecFile);

const DEFAULT_EXEC_FILE_RUNNER: ExecFileRunner = async (file, args, options) => {
  const result = await execFileAsync(file, args, options);
  return {
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
};

export const U_HAUL_DEFAULT_PRECEDENCE = ["claude", "codex", "copilot"] as const satisfies readonly ProviderId[];

const U_HAUL_TYPE_ORDER: readonly CliEntityType[] = [
  "prompt",
  "skill",
  "mcp",
  "subagent",
  "hook",
  "settings",
  "command",
];

const CLAUDE_EVENT_FROM_PROVIDER: Record<string, CanonicalHookEvent> = {
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "prompt_submit",
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PostToolUseFailure: "post_tool_failure",
  Notification: "notification",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  StopFailure: "stop_failure",
  TeammateIdle: "teammate_idle",
  TaskCompleted: "task_completed",
  InstructionsLoaded: "instructions_loaded",
  ConfigChange: "config_change",
  WorktreeCreate: "worktree_create",
  WorktreeRemove: "worktree_remove",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  Elicitation: "elicitation",
  ElicitationResult: "elicitation_result",
};

const COPILOT_EVENT_FROM_PROVIDER: Record<string, CanonicalHookEvent> = {
  sessionStart: "session_start",
  sessionEnd: "session_end",
  userPromptSubmitted: "prompt_submit",
  preToolUse: "pre_tool_use",
  postToolUse: "post_tool_use",
  agentStop: "stop",
  subagentStop: "subagent_stop",
  errorOccurred: "error",
};

export interface LegacyAssetsDetection {
  hasLegacyAssets: boolean;
  providers: ProviderId[];
  paths: string[];
}

export type UHaulEntityCounts = Record<CliEntityType, number>;

export interface UHaulPrecedenceDrop {
  entityType: CliEntityType;
  id: string;
  keptProvider: ProviderId;
  droppedProvider: ProviderId;
  keptSourcePath: string;
  droppedSourcePath: string;
  reason: "conflict" | "duplicate";
}

export interface UHaulCollisionRemap {
  entityType: CliEntityType;
  provider: ProviderId;
  fromId: string;
  toId: string;
}

export interface UHaulApplySummary {
  operations: number;
  writtenArtifacts: number;
  prunedArtifacts: number;
  diagnostics: number;
  errorDiagnostics: number;
}

export interface UHaulSummary {
  noOp: boolean;
  precedence: ProviderId[];
  detected: UHaulEntityCounts;
  imported: UHaulEntityCounts;
  autoEnabledProviders: ProviderId[];
  deletedLegacyPaths: string[];
  precedenceDrops: UHaulPrecedenceDrop[];
  collisionRemaps: UHaulCollisionRemap[];
  apply: UHaulApplySummary;
}

export interface UHaulRunInput {
  cwd: string;
  force: boolean;
  precedencePrimary?: ProviderId;
}

export interface UHaulRunDependencies {
  execFile?: ExecFileRunner;
}

type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string }>;

interface CandidateBase {
  type: CliEntityType;
  provider: ProviderId;
  id: string;
  sourcePath: string;
  compareValue: unknown;
  fixedId?: boolean;
}

interface PromptCandidate extends CandidateBase {
  type: "prompt";
  sourceText: string;
  fixedId: true;
}

interface SkillCandidate extends CandidateBase {
  type: "skill";
  files: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>;
}

interface MappedMcpCandidate extends CandidateBase {
  type: "mcp";
  sourceJson: Record<string, unknown>;
}

interface SubagentCandidate extends CandidateBase {
  type: "subagent";
  sourceText: string;
}

interface HookCandidate extends CandidateBase {
  type: "hook";
  sourceJson: Record<string, unknown>;
}

interface SettingsCandidate extends CandidateBase {
  type: "settings";
  sourcePayload: Record<string, unknown>;
  id: ProviderId;
  fixedId: true;
}

interface CommandCandidate extends CandidateBase {
  type: "command";
  sourceText: string;
}

type UHaulCandidate =
  | PromptCandidate
  | SkillCandidate
  | MappedMcpCandidate
  | SubagentCandidate
  | HookCandidate
  | SettingsCandidate
  | CommandCandidate;

type SelectedCandidate = UHaulCandidate & { assignedId: string };

interface CandidateCollection {
  cwd: string;
  candidates: UHaulCandidate[];
  deletionPaths: Set<string>;
  parseErrors: string[];
}

interface UHaulPlan {
  selectedCandidates: SelectedCandidate[];
  detected: UHaulEntityCounts;
  imported: UHaulEntityCounts;
  deletionPaths: string[];
  autoEnabledProviders: ProviderId[];
  precedenceDrops: UHaulPrecedenceDrop[];
  collisionRemaps: UHaulCollisionRemap[];
  parseErrors: string[];
}

interface ParsedSubagentDocument {
  canonical: CanonicalSubagent;
  sourceText: string;
}

export function resolveUHaulPrecedence(primary?: ProviderId): ProviderId[] {
  if (!primary) {
    return [...U_HAUL_DEFAULT_PRECEDENCE];
  }

  const fallback = U_HAUL_DEFAULT_PRECEDENCE.filter((provider) => provider !== primary);
  return [primary, ...fallback];
}

export async function detectLegacyAssets(cwd: string): Promise<LegacyAssetsDetection> {
  const detectedPaths = new Set<string>();
  const providers = new Set<ProviderId>();

  const mark = (provider: ProviderId, legacyPath: string): void => {
    detectedPaths.add(legacyPath);
    providers.add(provider);
  };

  const legacyChecks: Array<{ provider: ProviderId; legacyPath: string; check: Promise<boolean> }> = [
    { provider: "codex", legacyPath: "AGENTS.md", check: pathExists(cwd, "AGENTS.md") },
    { provider: "claude", legacyPath: "CLAUDE.md", check: pathExists(cwd, "CLAUDE.md") },
    {
      provider: "copilot",
      legacyPath: ".github/copilot-instructions.md",
      check: pathExists(cwd, ".github/copilot-instructions.md"),
    },
    {
      provider: "codex",
      legacyPath: ".codex/skills",
      check: directoryHasMatchingFiles(cwd, ".codex/skills", (_base, relative) => relative.endsWith("/SKILL.md")),
    },
    {
      provider: "claude",
      legacyPath: ".claude/skills",
      check: directoryHasMatchingFiles(cwd, ".claude/skills", (_base, relative) => relative.endsWith("/SKILL.md")),
    },
    {
      provider: "copilot",
      legacyPath: ".github/skills",
      check: directoryHasMatchingFiles(cwd, ".github/skills", (_base, relative) => relative.endsWith("/SKILL.md")),
    },
    { provider: "codex", legacyPath: ".codex/config.toml", check: pathExists(cwd, ".codex/config.toml") },
    { provider: "claude", legacyPath: ".mcp.json", check: pathExists(cwd, ".mcp.json") },
    { provider: "copilot", legacyPath: ".vscode/mcp.json", check: pathExists(cwd, ".vscode/mcp.json") },
    {
      provider: "claude",
      legacyPath: ".claude/agents",
      check: directoryHasMatchingFiles(cwd, ".claude/agents", (base, relative) => {
        const absolute = path.join(base, relative);
        return relative.endsWith(".md") && path.dirname(absolute) === base;
      }),
    },
    {
      provider: "copilot",
      legacyPath: ".github/agents",
      check: directoryHasMatchingFiles(cwd, ".github/agents", (base, relative) => {
        const absolute = path.join(base, relative);
        return relative.endsWith(".agent.md") && path.dirname(absolute) === base;
      }),
    },
    { provider: "claude", legacyPath: ".claude/settings.json", check: pathExists(cwd, ".claude/settings.json") },
    {
      provider: "copilot",
      legacyPath: ".github/hooks/harness.generated.json",
      check: pathExists(cwd, ".github/hooks/harness.generated.json"),
    },
    { provider: "copilot", legacyPath: ".vscode/settings.json", check: pathExists(cwd, ".vscode/settings.json") },
    {
      provider: "claude",
      legacyPath: ".claude/commands",
      check: directoryHasMatchingFiles(cwd, ".claude/commands", (base, relative) => {
        const absolute = path.join(base, relative);
        return relative.endsWith(".md") && path.dirname(absolute) === base;
      }),
    },
    {
      provider: "copilot",
      legacyPath: ".github/prompts",
      check: directoryHasMatchingFiles(cwd, ".github/prompts", (base, relative) => {
        const absolute = path.join(base, relative);
        return relative.endsWith(".prompt.md") && path.dirname(absolute) === base;
      }),
    },
  ];

  const results = await Promise.all(legacyChecks.map((entry) => entry.check));
  for (let i = 0; i < legacyChecks.length; i++) {
    if (results[i]) {
      const entry = legacyChecks[i];
      if (entry) mark(entry.provider, entry.legacyPath);
    }
  }

  const orderedProviders = U_HAUL_DEFAULT_PRECEDENCE.filter((provider) => providers.has(provider));

  return {
    hasLegacyAssets: detectedPaths.size > 0,
    providers: orderedProviders,
    paths: [...detectedPaths].sort((left, right) => left.localeCompare(right)),
  };
}

export async function runUHaulInitFlow(
  input: UHaulRunInput,
  dependencies?: UHaulRunDependencies,
): Promise<UHaulSummary> {
  const precedence = resolveUHaulPrecedence(input.precedencePrimary);
  const plan = await buildUHaulPlan(input.cwd, precedence);

  if (plan.parseErrors.length > 0) {
    throw new Error(`U_HAUL_PARSE_FAILED:\n${plan.parseErrors.join("\n")}`);
  }

  if (plan.deletionPaths.length > 0) {
    await assertGitSafetyGate(input.cwd, dependencies?.execFile ?? DEFAULT_EXEC_FILE_RUNNER);
  }

  const engine = new HarnessEngine(input.cwd);
  await engine.init({ force: input.force });

  for (const candidate of plan.selectedCandidates) {
    await importCandidate(input.cwd, candidate);
  }

  for (const provider of plan.autoEnabledProviders) {
    await engine.enableProvider(provider);
  }

  const realCwd = await fs.realpath(input.cwd);
  for (const legacyPath of plan.deletionPaths) {
    const targetAbs = path.join(input.cwd, legacyPath);
    const realTarget = await fs.realpath(targetAbs).catch(() => null);
    if (realTarget === null) continue;
    if (realTarget !== realCwd && !realTarget.startsWith(realCwd + path.sep)) {
      throw new Error(
        `U_HAUL_SYMLINK_ESCAPE: refusing to delete '${legacyPath}' because its real path '${realTarget}' is outside the workspace`,
      );
    }
    await fs.rm(targetAbs, { recursive: true, force: true });
  }

  let applyResult: ApplyResult;
  try {
    applyResult = await engine.apply();
  } catch (error) {
    // Restore deleted legacy files from git so the user doesn't lose pre-migration state
    const execFileRunner = dependencies?.execFile ?? DEFAULT_EXEC_FILE_RUNNER;
    await execFileRunner("git", ["checkout", "--", ...plan.deletionPaths], { cwd: input.cwd }).catch(() => {});
    throw error;
  }

  return {
    noOp: sumCounts(plan.detected) === 0,
    precedence,
    detected: plan.detected,
    imported: plan.imported,
    autoEnabledProviders: plan.autoEnabledProviders,
    deletedLegacyPaths: plan.deletionPaths,
    precedenceDrops: plan.precedenceDrops,
    collisionRemaps: plan.collisionRemaps,
    apply: summarizeApplyResult(applyResult),
  };
}

async function buildUHaulPlan(cwd: string, precedence: readonly ProviderId[]): Promise<UHaulPlan> {
  const collection: CandidateCollection = {
    cwd,
    candidates: [],
    deletionPaths: new Set<string>(),
    parseErrors: [],
  };

  await parsePromptSources(collection);
  await parseSkillSources(collection);
  await parseCodexConfig(collection);
  await parseStandaloneMcpFiles(collection);
  await parseSubagentFiles(collection);
  await parseClaudeSettings(collection);
  await parseCopilotHooks(collection);
  await parseCopilotSettings(collection);
  await parseCommandFiles(collection);

  const detected = countByType(collection.candidates);
  const precedenceResolved = resolveByPrecedence(collection.candidates, precedence);
  const idResolved = assignCanonicalIds(precedenceResolved.selected, precedence);

  const imported = countByType(idResolved.selected);
  const providerSet = new Set<ProviderId>(idResolved.selected.map((candidate) => candidate.provider));
  const autoEnabledProviders = precedence.filter((provider) => providerSet.has(provider));

  return {
    selectedCandidates: idResolved.selected,
    detected,
    imported,
    deletionPaths: [...collection.deletionPaths].sort((left, right) => left.localeCompare(right)),
    autoEnabledProviders,
    precedenceDrops: precedenceResolved.drops,
    collisionRemaps: idResolved.remaps,
    parseErrors: collection.parseErrors,
  };
}

async function importCandidate(cwd: string, candidate: SelectedCandidate): Promise<void> {
  switch (candidate.type) {
    case "prompt": {
      await addPromptEntity(cwd, { sourceText: candidate.sourceText });
      return;
    }
    case "skill": {
      await addSkillEntity(cwd, candidate.assignedId, { files: candidate.files });
      return;
    }
    case "mcp": {
      await addMcpEntity(cwd, candidate.assignedId, { sourceJson: candidate.sourceJson });
      return;
    }
    case "subagent": {
      await addSubagentEntity(cwd, candidate.assignedId, { sourceText: candidate.sourceText });
      return;
    }
    case "hook": {
      await addHookEntity(cwd, candidate.assignedId, { sourceJson: candidate.sourceJson });
      return;
    }
    case "settings": {
      if (candidate.assignedId !== candidate.provider) {
        throw new Error(
          `U_HAUL_SETTINGS_ID_INVALID: expected settings id '${candidate.provider}', received '${candidate.assignedId}'`,
        );
      }
      await addSettingsEntity(cwd, candidate.provider, { sourcePayload: candidate.sourcePayload });
      return;
    }
    case "command": {
      await addCommandEntity(cwd, candidate.assignedId, { sourceText: candidate.sourceText });
      return;
    }
  }
}

function summarizeApplyResult(result: ApplyResult): UHaulApplySummary {
  const errorDiagnostics = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  return {
    operations: result.operations.length,
    writtenArtifacts: result.writtenArtifacts.length,
    prunedArtifacts: result.prunedArtifacts.length,
    diagnostics: result.diagnostics.length,
    errorDiagnostics,
  };
}

async function parsePromptSources(collection: CandidateCollection): Promise<void> {
  await parsePromptFile(collection, "codex", "AGENTS.md");
  await parsePromptFile(collection, "claude", "CLAUDE.md");
  await parsePromptFile(collection, "copilot", ".github/copilot-instructions.md");
}

async function parsePromptFile(
  collection: CandidateCollection,
  provider: ProviderId,
  relativePath: string,
): Promise<void> {
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  if (text.trim().length === 0) {
    pushParseError(collection, relativePath, "prompt file is empty");
    return;
  }

  pushCandidate(collection, {
    type: "prompt",
    provider,
    id: "system",
    sourcePath: relativePath,
    sourceText: withSingleTrailingNewline(text),
    compareValue: withSingleTrailingNewline(text),
    fixedId: true,
  });
  collection.deletionPaths.add(relativePath);
}

async function parseSkillSources(collection: CandidateCollection): Promise<void> {
  await parseSkillDirectory(collection, "codex", ".codex/skills");
  await parseSkillDirectory(collection, "claude", ".claude/skills");
  await parseSkillDirectory(collection, "copilot", ".github/skills");
}

async function parseSkillDirectory(
  collection: CandidateCollection,
  provider: ProviderId,
  relativeDir: string,
): Promise<void> {
  const absoluteDir = path.join(collection.cwd, relativeDir);
  if (!(await exists(absoluteDir))) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    pushParseError(collection, relativeDir, toErrorMessage(error));
    return;
  }

  let importedAny = false;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillId = entry.name;
    if (!assertValidEntityId(collection, "skill", skillId, `${relativeDir}/${entry.name}`)) {
      continue;
    }

    const skillRootAbs = path.join(absoluteDir, entry.name);
    const filesAbs = await listFilesRecursively(skillRootAbs);
    const files: SkillCandidate["files"] = [];

    for (const fileAbs of filesAbs) {
      const relativeInSkill = normalizeRelativePath(path.relative(skillRootAbs, fileAbs).replace(/\\/g, "/"));
      try {
        const buffer = await fs.readFile(fileAbs);
        if (buffer.includes(0)) {
          files.push({ path: relativeInSkill, content: buffer.toString("base64"), encoding: "base64" });
        } else {
          files.push({ path: relativeInSkill, content: buffer.toString("utf8") });
        }
      } catch (error) {
        const sourcePath = `${relativeDir}/${entry.name}/${relativeInSkill}`;
        pushParseError(collection, sourcePath, `failed to read skill file: ${toErrorMessage(error)}`);
      }
    }

    files.sort((left, right) => left.path.localeCompare(right.path));

    if (!files.some((file) => file.path === "SKILL.md")) {
      pushParseError(collection, `${relativeDir}/${entry.name}`, "skill directory must contain SKILL.md");
      continue;
    }

    pushCandidate(collection, {
      type: "skill",
      provider,
      id: skillId,
      sourcePath: `${relativeDir}/${entry.name}`,
      files,
      compareValue: files.map((file) => ({ path: file.path, content: file.content, encoding: file.encoding })),
    });
    importedAny = true;
  }

  if (importedAny) {
    collection.deletionPaths.add(relativeDir);
  }
}

async function parseCodexConfig(collection: CandidateCollection): Promise<void> {
  const relativePath = ".codex/config.toml";
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseTomlAsRecord(text, TOML);
  } catch (error) {
    pushParseError(collection, relativePath, `invalid TOML: ${toErrorMessage(error)}`);
    return;
  }

  const candidateCountBefore = collection.candidates.length;
  const consumedKeys = new Set<string>();

  if (Object.hasOwn(payload, "mcp_servers")) {
    consumedKeys.add("mcp_servers");
    parseMcpServers(collection, "codex", `${relativePath}#mcp_servers`, payload.mcp_servers);
  }

  if (Object.hasOwn(payload, "agents")) {
    consumedKeys.add("agents");
    parseCodexAgents(collection, `${relativePath}#agents`, payload.agents);
  }

  if (Object.hasOwn(payload, "notify")) {
    consumedKeys.add("notify");
    parseCodexNotify(collection, `${relativePath}#notify`, payload.notify);
  }

  const settingsPayload = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !consumedKeys.has(key)),
  ) as Record<string, unknown>;

  if (Object.keys(settingsPayload).length > 0) {
    pushCandidate(collection, {
      type: "settings",
      provider: "codex",
      id: "codex",
      sourcePath: relativePath,
      sourcePayload: settingsPayload,
      compareValue: settingsPayload,
      fixedId: true,
    });
  }

  if (collection.candidates.length > candidateCountBefore) {
    collection.deletionPaths.add(relativePath);
  }
}

function parseCodexAgents(collection: CandidateCollection, sourcePath: string, value: unknown): void {
  if (!isRecord(value)) {
    pushParseError(collection, sourcePath, "expected TOML table for 'agents'");
    return;
  }

  for (const [agentId, rawAgent] of sortedEntries(value)) {
    if (!assertValidEntityId(collection, "subagent", agentId, `${sourcePath}.${agentId}`)) {
      continue;
    }

    if (!isRecord(rawAgent)) {
      pushParseError(collection, `${sourcePath}.${agentId}`, "agent definition must be an object");
      continue;
    }

    const description = asNonEmptyString(rawAgent.description);
    const instructions = asNonEmptyString(rawAgent.developer_instructions);
    if (!description) {
      pushParseError(collection, `${sourcePath}.${agentId}`, "agent.description must be a non-empty string");
      continue;
    }
    if (!instructions) {
      pushParseError(collection, `${sourcePath}.${agentId}`, "agent.developer_instructions must be a non-empty string");
      continue;
    }

    const model = asNonEmptyString(rawAgent.model);
    const tools = asStringArray(rawAgent.tools);

    const canonical: CanonicalSubagent = {
      id: agentId,
      name: agentId,
      description,
      body: instructions,
      metadata: {},
    };

    const sourceText = renderSubagentMarkdown(canonical, {
      model,
      tools,
    });

    const parsed = parseSubagentDocument(collection, sourceText, `${sourcePath}.${agentId}`, agentId);
    if (!parsed) {
      continue;
    }

    pushCandidate(collection, {
      type: "subagent",
      provider: "codex",
      id: agentId,
      sourcePath: `${sourcePath}.${agentId}`,
      sourceText: parsed.sourceText,
      compareValue: parsed.canonical,
    });
  }
}

function parseCodexNotify(collection: CandidateCollection, sourcePath: string, value: unknown): void {
  const notifyCommand = parseNotifyCommand(value);
  if (!notifyCommand) {
    pushParseError(collection, sourcePath, "notify must be a non-empty string or non-empty string array");
    return;
  }

  addHookCandidate(collection, {
    provider: "codex",
    id: "turn_complete",
    event: "turn_complete",
    handlers: [
      {
        type: "notify",
        event: "agent-turn-complete",
        command: notifyCommand,
      },
    ],
    sourcePath,
  });
}

function parseMcpServers(
  collection: CandidateCollection,
  provider: ProviderId,
  sourcePath: string,
  value: unknown,
): void {
  if (!isRecord(value)) {
    pushParseError(collection, sourcePath, "expected MCP servers object");
    return;
  }

  for (const [serverId, serverConfig] of sortedEntries(value)) {
    const candidateId = normalizeMcpServerId(serverId);
    if (!assertValidEntityId(collection, "mcp", candidateId, `${sourcePath}.${serverId}`)) {
      continue;
    }

    const sourceJson = {
      servers: {
        [serverId]: serverConfig,
      },
    };

    pushCandidate(collection, {
      type: "mcp",
      provider,
      id: candidateId,
      sourcePath: `${sourcePath}.${serverId}`,
      sourceJson,
      compareValue: sourceJson,
    });
  }
}

async function parseStandaloneMcpFiles(collection: CandidateCollection): Promise<void> {
  await parseMcpFile(collection, "claude", ".mcp.json", ["mcpServers", "servers"]);
  await parseMcpFile(collection, "copilot", ".vscode/mcp.json", ["servers"]);
}

async function parseMcpFile(
  collection: CandidateCollection,
  provider: ProviderId,
  relativePath: string,
  candidateKeys: string[],
): Promise<void> {
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonAsRecord(text);
  } catch (error) {
    pushParseError(collection, relativePath, `invalid JSON: ${toErrorMessage(error)}`);
    return;
  }

  let servers: Record<string, unknown> | undefined;
  for (const key of candidateKeys) {
    if (Object.hasOwn(payload, key)) {
      const candidate = payload[key];
      if (!isRecord(candidate)) {
        pushParseError(collection, relativePath, `'${key}' must be an object`);
        return;
      }
      servers = candidate;
      break;
    }
  }

  if (!servers) {
    return;
  }

  const candidateCountBefore = collection.candidates.length;
  parseMcpServers(collection, provider, `${relativePath}#${candidateKeys.join("|")}`, servers);
  if (collection.candidates.length > candidateCountBefore) {
    collection.deletionPaths.add(relativePath);
  }
}

async function parseSubagentFiles(collection: CandidateCollection): Promise<void> {
  await parseSubagentDirectory(collection, "claude", ".claude/agents", ".md");
  await parseSubagentDirectory(collection, "copilot", ".github/agents", ".agent.md");
}

async function parseSubagentDirectory(
  collection: CandidateCollection,
  provider: ProviderId,
  relativeDir: string,
  suffix: string,
): Promise<void> {
  const absoluteDir = path.join(collection.cwd, relativeDir);
  if (!(await exists(absoluteDir))) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    pushParseError(collection, relativeDir, toErrorMessage(error));
    return;
  }

  let importedAny = false;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) {
      continue;
    }

    const subagentId = entry.name.slice(0, -suffix.length);
    const sourcePath = `${relativeDir}/${entry.name}`;
    if (!assertValidEntityId(collection, "subagent", subagentId, sourcePath)) {
      continue;
    }

    let text: string;
    try {
      text = await fs.readFile(path.join(absoluteDir, entry.name), "utf8");
    } catch (error) {
      pushParseError(collection, sourcePath, `failed to read subagent file: ${toErrorMessage(error)}`);
      continue;
    }

    const parsed = parseSubagentDocument(collection, text, sourcePath, subagentId);
    if (!parsed) {
      continue;
    }

    pushCandidate(collection, {
      type: "subagent",
      provider,
      id: subagentId,
      sourcePath,
      sourceText: parsed.sourceText,
      compareValue: parsed.canonical,
    });
    importedAny = true;
  }

  if (importedAny) {
    collection.deletionPaths.add(relativeDir);
  }
}

async function parseClaudeSettings(collection: CandidateCollection): Promise<void> {
  const relativePath = ".claude/settings.json";
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonAsRecord(text);
  } catch (error) {
    pushParseError(collection, relativePath, `invalid JSON: ${toErrorMessage(error)}`);
    return;
  }

  const candidateCountBefore = collection.candidates.length;

  if (Object.hasOwn(payload, "hooks")) {
    const hooks = payload.hooks;
    if (!isRecord(hooks)) {
      pushParseError(collection, `${relativePath}#hooks`, "hooks must be an object");
    } else {
      for (const [providerEvent, groupsValue] of sortedEntries(hooks)) {
        const canonicalEvent = CLAUDE_EVENT_FROM_PROVIDER[providerEvent];
        if (!canonicalEvent) {
          pushParseError(collection, `${relativePath}#hooks.${providerEvent}`, "unsupported Claude hook event");
          continue;
        }

        if (!Array.isArray(groupsValue)) {
          pushParseError(collection, `${relativePath}#hooks.${providerEvent}`, "event groups must be an array");
          continue;
        }

        const handlers: Array<Record<string, unknown>> = [];

        for (let index = 0; index < groupsValue.length; index += 1) {
          const group = groupsValue[index];
          if (!isRecord(group)) {
            pushParseError(
              collection,
              `${relativePath}#hooks.${providerEvent}[${index}]`,
              "group entry must be an object",
            );
            continue;
          }

          const matcher = asNonEmptyString(group.matcher);
          const hookEntries = group.hooks;
          if (!Array.isArray(hookEntries)) {
            pushParseError(
              collection,
              `${relativePath}#hooks.${providerEvent}[${index}]`,
              "group.hooks must be an array",
            );
            continue;
          }

          for (let hookIndex = 0; hookIndex < hookEntries.length; hookIndex += 1) {
            const hook = hookEntries[hookIndex];
            if (!isRecord(hook)) {
              pushParseError(
                collection,
                `${relativePath}#hooks.${providerEvent}[${index}].hooks[${hookIndex}]`,
                "hook entry must be an object",
              );
              continue;
            }

            const parsed = parseCommandHookHandler(collection, hook, {
              sourcePath: `${relativePath}#hooks.${providerEvent}[${index}].hooks[${hookIndex}]`,
              allowMatcher: false,
            });
            if (!parsed) {
              continue;
            }

            if (matcher) {
              parsed.matcher = matcher;
            }

            handlers.push(parsed);
          }
        }

        if (handlers.length > 0) {
          addHookCandidate(collection, {
            provider: "claude",
            id: canonicalEvent,
            event: canonicalEvent,
            handlers,
            sourcePath: `${relativePath}#hooks.${providerEvent}`,
          });
        }
      }
    }
  }

  const settingsPayload = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "hooks")) as Record<
    string,
    unknown
  >;

  if (Object.keys(settingsPayload).length > 0) {
    pushCandidate(collection, {
      type: "settings",
      provider: "claude",
      id: "claude",
      sourcePath: relativePath,
      sourcePayload: settingsPayload,
      compareValue: settingsPayload,
      fixedId: true,
    });
  }

  if (collection.candidates.length > candidateCountBefore) {
    collection.deletionPaths.add(relativePath);
  }
}

async function parseCopilotHooks(collection: CandidateCollection): Promise<void> {
  const relativePath = ".github/hooks/harness.generated.json";
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonAsRecord(text);
  } catch (error) {
    pushParseError(collection, relativePath, `invalid JSON: ${toErrorMessage(error)}`);
    return;
  }

  const hooks = payload.hooks;
  if (!isRecord(hooks)) {
    pushParseError(collection, `${relativePath}#hooks`, "hooks must be an object");
    return;
  }

  const candidateCountBefore = collection.candidates.length;

  for (const [providerEvent, entriesValue] of sortedEntries(hooks)) {
    const canonicalEvent = COPILOT_EVENT_FROM_PROVIDER[providerEvent];
    if (!canonicalEvent) {
      pushParseError(collection, `${relativePath}#hooks.${providerEvent}`, "unsupported Copilot hook event");
      continue;
    }

    if (!Array.isArray(entriesValue)) {
      pushParseError(collection, `${relativePath}#hooks.${providerEvent}`, "event handlers must be an array");
      continue;
    }

    const handlers: Array<Record<string, unknown>> = [];

    for (let index = 0; index < entriesValue.length; index += 1) {
      const hook = entriesValue[index];
      if (!isRecord(hook)) {
        pushParseError(collection, `${relativePath}#hooks.${providerEvent}[${index}]`, "hook entry must be an object");
        continue;
      }

      const parsed = parseCommandHookHandler(collection, hook, {
        sourcePath: `${relativePath}#hooks.${providerEvent}[${index}]`,
        allowMatcher: true,
      });
      if (!parsed) {
        continue;
      }

      handlers.push(parsed);
    }

    if (handlers.length > 0) {
      addHookCandidate(collection, {
        provider: "copilot",
        id: canonicalEvent,
        event: canonicalEvent,
        handlers,
        sourcePath: `${relativePath}#hooks.${providerEvent}`,
      });
    }
  }

  if (collection.candidates.length > candidateCountBefore) {
    collection.deletionPaths.add(relativePath);
  }
}

function parseCommandHookHandler(
  collection: CandidateCollection,
  value: Record<string, unknown>,
  input: { sourcePath: string; allowMatcher: boolean },
): Record<string, unknown> | undefined {
  const type = value.type;
  if (typeof type !== "undefined" && type !== "command") {
    pushParseError(collection, input.sourcePath, "hook handler type must be 'command'");
    return undefined;
  }

  const matcher = asNonEmptyString(value.matcher);
  if (matcher && !input.allowMatcher) {
    pushParseError(collection, input.sourcePath, "matcher is not supported for this hook format");
    return undefined;
  }

  const command = asNonEmptyString(value.command);
  const windows = asNonEmptyString(value.windows);
  const linux = asNonEmptyString(value.linux);
  const osx = asNonEmptyString(value.osx);
  const bash = asNonEmptyString(value.bash);
  const powershell = asNonEmptyString(value.powershell);

  if (!command && !windows && !linux && !osx && !bash && !powershell) {
    pushParseError(
      collection,
      input.sourcePath,
      "hook handler must define one of command/windows/linux/osx/bash/powershell",
    );
    return undefined;
  }

  const output: Record<string, unknown> = {
    type: "command",
  };

  if (matcher) output.matcher = matcher;
  if (command) output.command = command;
  if (windows) output.windows = windows;
  if (linux) output.linux = linux;
  if (osx) output.osx = osx;
  if (bash) output.bash = bash;
  if (powershell) output.powershell = powershell;

  const cwd = asNonEmptyString(value.cwd);
  if (cwd) {
    output.cwd = cwd;
  }

  if (Object.hasOwn(value, "env")) {
    const env = asStringRecord(value.env);
    if (!env) {
      pushParseError(collection, input.sourcePath, "env must be an object with string values");
      return undefined;
    }
    output.env = env;
  }

  const timeout = asPositiveNumber(value.timeout);
  const timeoutSec = asPositiveNumber(value.timeoutSec);
  if (Object.hasOwn(value, "timeout") && !timeout) {
    pushParseError(collection, input.sourcePath, "timeout must be a positive number");
    return undefined;
  }
  if (Object.hasOwn(value, "timeoutSec") && !timeoutSec) {
    pushParseError(collection, input.sourcePath, "timeoutSec must be a positive number");
    return undefined;
  }

  if (timeout) {
    output.timeout = timeout;
  } else if (timeoutSec) {
    output.timeoutSec = timeoutSec;
  }

  return output;
}

function addHookCandidate(
  collection: CandidateCollection,
  input: {
    provider: ProviderId;
    id: string;
    event: CanonicalHookEvent;
    handlers: Array<Record<string, unknown>>;
    sourcePath: string;
  },
): void {
  if (!assertValidEntityId(collection, "hook", input.id, input.sourcePath)) {
    return;
  }

  const sourceJson = {
    mode: "strict",
    events: {
      [input.event]: input.handlers,
    },
  };

  const parsed = parseCanonicalHookDocument(sourceJson, input.sourcePath, input.id);
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0 || !parsed.canonical) {
    const message = errors.map((diagnostic) => diagnostic.message).join("; ");
    pushParseError(collection, input.sourcePath, message || "invalid canonical hook definition");
    return;
  }

  pushCandidate(collection, {
    type: "hook",
    provider: input.provider,
    id: input.id,
    sourcePath: input.sourcePath,
    sourceJson,
    compareValue: parsed.canonical,
  });
}

async function parseCopilotSettings(collection: CandidateCollection): Promise<void> {
  const relativePath = ".vscode/settings.json";
  const absolutePath = path.join(collection.cwd, relativePath);
  const text = await readTextIfExists(absolutePath);
  if (text === null) {
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = parseJsonAsRecord(text);
  } catch (error) {
    pushParseError(collection, relativePath, `invalid JSON: ${toErrorMessage(error)}`);
    return;
  }

  if (Object.keys(payload).length === 0) {
    return;
  }

  pushCandidate(collection, {
    type: "settings",
    provider: "copilot",
    id: "copilot",
    sourcePath: relativePath,
    sourcePayload: payload,
    compareValue: payload,
    fixedId: true,
  });
  collection.deletionPaths.add(relativePath);
}

async function parseCommandFiles(collection: CandidateCollection): Promise<void> {
  await parseCommandDirectory(collection, "claude", ".claude/commands", ".md");
  await parseCommandDirectory(collection, "copilot", ".github/prompts", ".prompt.md");
}

async function parseCommandDirectory(
  collection: CandidateCollection,
  provider: ProviderId,
  relativeDir: string,
  suffix: string,
): Promise<void> {
  const absoluteDir = path.join(collection.cwd, relativeDir);
  if (!(await exists(absoluteDir))) {
    return;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    pushParseError(collection, relativeDir, toErrorMessage(error));
    return;
  }

  let importedAny = false;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(suffix)) {
      continue;
    }

    const commandId = entry.name.slice(0, -suffix.length);
    const sourcePath = `${relativeDir}/${entry.name}`;
    if (!assertValidEntityId(collection, "command", commandId, sourcePath)) {
      continue;
    }

    let text: string;
    try {
      text = await fs.readFile(path.join(absoluteDir, entry.name), "utf8");
    } catch (error) {
      pushParseError(collection, sourcePath, `failed to read command file: ${toErrorMessage(error)}`);
      continue;
    }

    const parsed = parseCanonicalCommandDocument(text, sourcePath, commandId);
    const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0 || !parsed.canonical) {
      const message = errors.map((diagnostic) => diagnostic.message).join("; ");
      pushParseError(collection, sourcePath, message || "invalid command definition");
      continue;
    }

    pushCandidate(collection, {
      type: "command",
      provider,
      id: commandId,
      sourcePath,
      sourceText: withSingleTrailingNewline(text),
      compareValue: parsed.canonical,
    });
    importedAny = true;
  }

  if (importedAny) {
    collection.deletionPaths.add(relativeDir);
  }
}

function parseSubagentDocument(
  collection: CandidateCollection,
  text: string,
  sourcePath: string,
  entityId: string,
): ParsedSubagentDocument | undefined {
  let parsedMatter: matter.GrayMatterFile<string>;
  try {
    parsedMatter = matter(text);
  } catch (error) {
    pushParseError(collection, sourcePath, `invalid frontmatter: ${toErrorMessage(error)}`);
    return undefined;
  }

  if (!isRecord(parsedMatter.data)) {
    pushParseError(collection, sourcePath, "subagent frontmatter must be an object");
    return undefined;
  }

  const name = asNonEmptyString(parsedMatter.data.name);
  const description = asNonEmptyString(parsedMatter.data.description);
  const body = parsedMatter.content.trim();

  if (!name) {
    pushParseError(collection, sourcePath, "subagent frontmatter requires non-empty 'name'");
    return undefined;
  }

  if (!description) {
    pushParseError(collection, sourcePath, "subagent frontmatter requires non-empty 'description'");
    return undefined;
  }

  if (body.length === 0) {
    pushParseError(collection, sourcePath, "subagent body cannot be empty");
    return undefined;
  }

  const metadata = Object.fromEntries(
    Object.entries(parsedMatter.data).filter(([key]) => key !== "name" && key !== "description"),
  ) as Record<string, unknown>;

  return {
    canonical: {
      id: entityId,
      name,
      description,
      body,
      metadata,
    },
    sourceText: withSingleTrailingNewline(text),
  };
}

function resolveByPrecedence(
  candidates: UHaulCandidate[],
  precedence: readonly ProviderId[],
): { selected: UHaulCandidate[]; drops: UHaulPrecedenceDrop[] } {
  const groups = new Map<string, UHaulCandidate[]>();

  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }

  const selected: UHaulCandidate[] = [];
  const drops: UHaulPrecedenceDrop[] = [];

  for (const key of [...groups.keys()].sort((left, right) => left.localeCompare(right))) {
    const group = groups.get(key);
    if (!group || group.length === 0) {
      continue;
    }

    const ordered = [...group].sort((left, right) => compareCandidatePriority(left, right, precedence));
    const winner = ordered[0];
    if (!winner) {
      continue;
    }

    selected.push(winner);

    for (let index = 1; index < ordered.length; index += 1) {
      const dropped = ordered[index];
      if (!dropped) {
        continue;
      }

      drops.push({
        entityType: dropped.type,
        id: dropped.id,
        keptProvider: winner.provider,
        droppedProvider: dropped.provider,
        keptSourcePath: winner.sourcePath,
        droppedSourcePath: dropped.sourcePath,
        reason: deepEqual(winner.compareValue, dropped.compareValue) ? "duplicate" : "conflict",
      });
    }
  }

  return {
    selected: selected.sort((left, right) => compareCandidatePriority(left, right, precedence)),
    drops: drops.sort((left, right) => {
      const typeCompare = left.entityType.localeCompare(right.entityType);
      if (typeCompare !== 0) {
        return typeCompare;
      }

      const idCompare = left.id.localeCompare(right.id);
      if (idCompare !== 0) {
        return idCompare;
      }

      const providerCompare = left.droppedProvider.localeCompare(right.droppedProvider);
      if (providerCompare !== 0) {
        return providerCompare;
      }

      return left.droppedSourcePath.localeCompare(right.droppedSourcePath);
    }),
  };
}

function assignCanonicalIds(
  candidates: UHaulCandidate[],
  precedence: readonly ProviderId[],
): { selected: SelectedCandidate[]; remaps: UHaulCollisionRemap[] } {
  const sorted = [...candidates].sort((left, right) => compareAssignmentPriority(left, right, precedence));
  const usedIds = new Set<string>();
  const remaps: UHaulCollisionRemap[] = [];
  const selected: SelectedCandidate[] = [];

  for (const candidate of sorted) {
    if (candidate.fixedId) {
      if (usedIds.has(candidate.id)) {
        throw new Error(`U_HAUL_FIXED_ID_COLLISION: fixed id '${candidate.id}' is already in use`);
      }

      usedIds.add(candidate.id);
      selected.push({
        ...candidate,
        assignedId: candidate.id,
      });
      continue;
    }

    let assignedId = candidate.id;
    if (usedIds.has(assignedId)) {
      const base = `${candidate.id}-${candidate.type}`;
      assignedId = base;
      let suffix = 2;
      while (usedIds.has(assignedId)) {
        assignedId = `${base}-${suffix}`;
        suffix += 1;
      }

      remaps.push({
        entityType: candidate.type,
        provider: candidate.provider,
        fromId: candidate.id,
        toId: assignedId,
      });
    }

    usedIds.add(assignedId);
    selected.push({
      ...candidate,
      assignedId,
    });
  }

  return {
    selected,
    remaps,
  };
}

function compareCandidatePriority(
  left: UHaulCandidate,
  right: UHaulCandidate,
  precedence: readonly ProviderId[],
): number {
  const typeCompare = typeOrder(left.type) - typeOrder(right.type);
  if (typeCompare !== 0) {
    return typeCompare;
  }

  const idCompare = left.id.localeCompare(right.id);
  if (idCompare !== 0) {
    return idCompare;
  }

  const providerCompare = providerOrder(left.provider, precedence) - providerOrder(right.provider, precedence);
  if (providerCompare !== 0) {
    return providerCompare;
  }

  return left.sourcePath.localeCompare(right.sourcePath);
}

function compareAssignmentPriority(
  left: UHaulCandidate,
  right: UHaulCandidate,
  precedence: readonly ProviderId[],
): number {
  const leftPriority = fixedIdPriority(left);
  const rightPriority = fixedIdPriority(right);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return compareCandidatePriority(left, right, precedence);
}

function fixedIdPriority(candidate: UHaulCandidate): number {
  if (candidate.type === "prompt") {
    return 0;
  }

  if (candidate.type === "settings") {
    return 1;
  }

  return 2;
}

function providerOrder(provider: ProviderId, precedence: readonly ProviderId[]): number {
  const index = precedence.indexOf(provider);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function typeOrder(type: CliEntityType): number {
  const index = U_HAUL_TYPE_ORDER.indexOf(type);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

async function assertGitSafetyGate(cwd: string, execFileRunner: ExecFileRunner): Promise<void> {
  // Sanitize env to prevent GIT_DIR / GIT_WORK_TREE from spoofing the worktree check
  const sanitizedEnv = { ...process.env };
  delete sanitizedEnv.GIT_DIR;
  delete sanitizedEnv.GIT_WORK_TREE;
  delete sanitizedEnv.GIT_WORKTREE;

  try {
    await execFileRunner("git", ["--version"], { env: sanitizedEnv });
  } catch (error) {
    throw new Error(`U_HAUL_GIT_REQUIRED: git executable not found (${toErrorMessage(error)})`);
  }

  let insideWorktree = "";
  try {
    const result = await execFileRunner("git", ["rev-parse", "--is-inside-work-tree"], { cwd, env: sanitizedEnv });
    insideWorktree = result.stdout.trim().toLowerCase();
  } catch (error) {
    throw new Error(`U_HAUL_GIT_WORKTREE_REQUIRED: unable to verify git worktree (${toErrorMessage(error)})`);
  }

  if (insideWorktree !== "true") {
    throw new Error("U_HAUL_GIT_WORKTREE_REQUIRED: current directory is not inside a git worktree");
  }
}

function pushCandidate(collection: CandidateCollection, candidate: UHaulCandidate): void {
  collection.candidates.push(candidate);
}

function pushParseError(collection: CandidateCollection, sourcePath: string, message: string): void {
  collection.parseErrors.push(`${sourcePath}: ${message}`);
}

function assertValidEntityId(
  collection: CandidateCollection,
  type: Exclude<CliEntityType, "prompt" | "settings">,
  id: string,
  sourcePath: string,
): boolean {
  try {
    const manifestType = (type === "mcp" ? "mcp_config" : type) as
      | "skill"
      | "mcp_config"
      | "subagent"
      | "hook"
      | "command";
    validateEntityId(id, manifestType);
    return true;
  } catch (error) {
    pushParseError(collection, sourcePath, toErrorMessage(error));
    return false;
  }
}

function normalizeMcpServerId(serverId: string): string {
  if (/^[a-zA-Z0-9._-]+$/u.test(serverId) && serverId !== "." && serverId !== "..") {
    return serverId;
  }

  const base = serverId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  const fallback = base.length > 0 ? base : "mcp";
  const digest = sha256(serverId).slice(0, 8);
  return `${fallback}-${digest}`;
}

function parseNotifyCommand(value: unknown): string | string[] | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const command: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return undefined;
    }
    command.push(entry);
  }

  return command;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    output.push(trimmed);
  }

  return output.length > 0 ? output : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") {
      return undefined;
    }
    output[key] = rawValue;
  }

  return output;
}

function asPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function sortedEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function countByType(candidates: ReadonlyArray<{ type: CliEntityType }>): UHaulEntityCounts {
  const counts = emptyCounts();

  for (const candidate of candidates) {
    counts[candidate.type] += 1;
  }

  return counts;
}

function emptyCounts(): UHaulEntityCounts {
  return {
    prompt: 0,
    skill: 0,
    mcp: 0,
    subagent: 0,
    hook: 0,
    settings: 0,
    command: 0,
  };
}

function sumCounts(counts: UHaulEntityCounts): number {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(cwd: string, relativePath: string): Promise<boolean> {
  return exists(path.join(cwd, relativePath));
}

async function directoryHasMatchingFiles(
  cwd: string,
  relativePath: string,
  predicate: (baseDir: string, relativeFilePath: string) => boolean,
): Promise<boolean> {
  const absolutePath = path.join(cwd, relativePath);
  if (!(await exists(absolutePath))) {
    return false;
  }

  const files = await listFilesRecursively(absolutePath);
  for (const file of files) {
    const relativeFilePath = normalizeRelativePath(path.relative(absolutePath, file).replace(/\\/g, "/"));
    if (predicate(absolutePath, relativeFilePath)) {
      return true;
    }
  }

  return false;
}

export function parseUHaulPrecedencePrimary(input?: string): ProviderId | undefined {
  if (!input) {
    return undefined;
  }

  const parsed = providerIdSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `INIT_U_HAUL_INVALID_PRECEDENCE: '${input}' is not a valid provider (${providerIdSchema.options.join(", ")})`,
    );
  }

  return parsed.data;
}
