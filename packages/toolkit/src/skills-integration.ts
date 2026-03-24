import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  Diagnostic,
  SkillAuditDecision,
  SkillAuditOutcome,
  SkillAuditProviderResult,
  SkillDiscoveryResult,
  SkillsFindResult,
} from "./types.js";
import { normalizeRelativePath, sha256 } from "./utils.js";

const execFileAsync = promisify(execFile);

export const SKILLS_CLI_VERSION = "1.4.6";

export interface ImportedSkillFile {
  path: string;
  content: string;
  /** Defaults to `"utf8"` when omitted. Binary files use `"base64"`. */
  encoding?: "utf8" | "base64";
  sha256: string;
  sizeBytes: number;
}

export interface SkillImportLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface ParsedSkillsImportReport {
  resolvedSource?: string;
  detailsUrl?: string;
  providers: SkillAuditProviderResult[];
}

export interface SkillsCliCommandResult {
  stdout: string;
  stderr: string;
}

export interface PrepareSkillImportInput {
  source: string;
  upstreamSkill: string;
  allowUnsafe: boolean;
  allowUnaudited: boolean;
}

export interface PrepareSkillImportResult {
  ok: boolean;
  files?: ImportedSkillFile[];
  resolvedSource?: string;
  audit: SkillAuditDecision;
  diagnostics: Diagnostic[];
  rawText: string;
}

export interface SkillsIntegrationDependencies {
  createSandbox?: () => Promise<string>;
  cleanupSandbox?: (sandboxAbs: string) => Promise<void>;
  runSkillsCliCommand?: (args: string[], cwd: string) => Promise<SkillsCliCommandResult>;
  limits?: SkillImportLimits;
}

const DEFAULT_IMPORT_LIMITS: SkillImportLimits = {
  maxFiles: 200,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
};

function validateUpstreamSkillId(upstreamSkill: string): void {
  if (upstreamSkill === "." || upstreamSkill === "..") {
    throw new Error(
      `Invalid upstream skill id '${upstreamSkill}'. Values '.' and '..' are not allowed due to path traversal risk.`,
    );
  }

  if (!/^[a-zA-Z0-9._-]+$/u.test(upstreamSkill)) {
    throw new Error(`Invalid upstream skill id '${upstreamSkill}'. Allowed characters: letters, digits, '.', '_', '-'`);
  }
}

export async function findSkills(
  query: string,
  deps?: Pick<SkillsIntegrationDependencies, "createSandbox" | "cleanupSandbox" | "runSkillsCliCommand">,
): Promise<SkillsFindResult> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    throw new Error("query must not be empty");
  }

  const createSandbox = deps?.createSandbox ?? createDefaultSandbox;
  const cleanupSandbox = deps?.cleanupSandbox ?? cleanupDefaultSandbox;
  const runSkillsCliCommand = deps?.runSkillsCliCommand ?? runSkillsCliCommandDefault;
  const diagnostics: Diagnostic[] = [];

  const sandboxAbs = await createSandbox();
  try {
    const commandResult = await runSkillsCliCommand(["find", normalizedQuery], sandboxAbs);
    const rawText = normalizeSkillsOutput(commandResult.stdout);
    return {
      query: normalizedQuery,
      results: parseSkillsFindOutput(rawText),
      rawText,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.push({
      code: "SKILL_FIND_SUBPROCESS_FAILED",
      severity: "error",
      message: `Failed to run skills find: ${message}`,
    });
    return {
      query: normalizedQuery,
      results: [],
      rawText: "",
      diagnostics,
    };
  } finally {
    await cleanupSandbox(sandboxAbs);
  }
}

export async function prepareSkillImport(
  input: PrepareSkillImportInput,
  deps?: SkillsIntegrationDependencies,
): Promise<PrepareSkillImportResult> {
  const source = input.source.trim();
  const upstreamSkill = input.upstreamSkill.trim();
  if (source.length === 0) {
    throw new Error("source must not be empty");
  }
  if (upstreamSkill.length === 0) {
    throw new Error("upstream skill must not be empty");
  }
  validateUpstreamSkillId(upstreamSkill);

  const createSandbox = deps?.createSandbox ?? createDefaultSandbox;
  const cleanupSandbox = deps?.cleanupSandbox ?? cleanupDefaultSandbox;
  const runSkillsCliCommand = deps?.runSkillsCliCommand ?? runSkillsCliCommandDefault;
  const limits = deps?.limits ?? DEFAULT_IMPORT_LIMITS;

  const sandboxAbs = await createSandbox();
  try {
    const commandResult = await runSkillsCliCommand(
      ["add", source, "--skill", upstreamSkill, "--agent", "codex", "--yes", "--copy"],
      sandboxAbs,
    );
    const rawText = normalizeSkillsOutput(commandResult.stdout);
    const report = parseSkillsImportReport(rawText, upstreamSkill);
    const audit = evaluateSkillAudit(report.providers, {
      allowUnsafe: input.allowUnsafe,
      allowUnaudited: input.allowUnaudited,
      detailsUrl: report.detailsUrl,
    });

    const diagnostics: Diagnostic[] = [];
    if (!audit.audited && !input.allowUnaudited) {
      diagnostics.push({
        code: "SKILL_IMPORT_AUDIT_UNAUDITED",
        severity: "error",
        message:
          "Blocked import because this skill source has no published audit report. Use --allow-unaudited to override.",
      });
    } else if (audit.audited && !audit.allowed && audit.reason === "fail") {
      diagnostics.push({
        code: "SKILL_IMPORT_AUDIT_BLOCKED",
        severity: "error",
        message:
          "Blocked import because at least one audit provider reported a failure. Use --allow-unsafe to override.",
      });
    } else if (audit.reason === "warn") {
      diagnostics.push({
        code: "SKILL_IMPORT_AUDIT_WARN",
        severity: "warning",
        message: "Some audit providers reported warnings. Review audit details before use.",
      });
    }

    const filesResult = await readImportedSkillFiles(sandboxAbs, upstreamSkill, limits);
    diagnostics.push(...filesResult.diagnostics);

    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      ok: !hasErrors,
      files: filesResult.files,
      resolvedSource: report.resolvedSource,
      audit,
      diagnostics,
      rawText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      audit: {
        audited: false,
        allowed: false,
        reason: "not_evaluated",
        allowUnsafe: input.allowUnsafe,
        allowUnaudited: input.allowUnaudited,
        providers: [],
      },
      diagnostics: [
        {
          code: "SKILL_IMPORT_SUBPROCESS_FAILED",
          severity: "error",
          message: `Failed to import skill from source '${source}': ${message}`,
        },
      ],
      rawText: "",
    };
  } finally {
    await cleanupSandbox(sandboxAbs);
  }
}

export function parseSkillsFindOutput(rawText: string): SkillDiscoveryResult[] {
  const lines = rawText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const output: SkillDiscoveryResult[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    const entryMatch =
      /^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)@([a-zA-Z0-9._-]+)(?:\s+([0-9][0-9.,]*[KMB]? installs))?$/u.exec(line);
    if (!entryMatch) {
      continue;
    }
    const source = entryMatch[1];
    const upstream = entryMatch[2];
    if (!source || !upstream) {
      continue;
    }

    let url: string | undefined;
    const nextLine = lines[index + 1];
    if (nextLine) {
      const urlMatch = /^(?:└\s+)?(https?:\/\/\S+)$/u.exec(nextLine);
      if (urlMatch?.[1]) {
        url = urlMatch[1];
        index += 1;
      }
    }

    output.push({
      source,
      upstreamSkill: upstream,
      installs: entryMatch[3],
      url,
      rawLine: line,
    });
  }

  return output;
}

export function parseSkillsImportReport(rawText: string, upstreamSkill: string): ParsedSkillsImportReport {
  const lines = rawText.split(/\r?\n/u).map((line) => line.trim());
  let resolvedSource: string | undefined;
  let detailsUrl: string | undefined;
  const providers: SkillAuditProviderResult[] = [];

  for (const line of lines) {
    if (!resolvedSource) {
      const sourceMatch = /Source:\s*(.+)$/u.exec(line);
      if (sourceMatch?.[1]) {
        resolvedSource = sourceMatch[1].trim();
      }
    }

    if (!detailsUrl) {
      const detailsMatch = /Details:\s*(https?:\/\/\S+)/u.exec(line);
      if (detailsMatch?.[1]) {
        detailsUrl = detailsMatch[1].trim();
      }
    }

    if (!line.includes(upstreamSkill)) {
      continue;
    }

    const cells = line
      .replaceAll("│", " ")
      .split(/\s{2,}/u)
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells[0] !== upstreamSkill || cells.length < 4) {
      continue;
    }
    const gen = cells[1];
    const socket = cells[2];
    const snyk = cells[3];
    if (!gen || !socket || !snyk) {
      continue;
    }

    providers.splice(
      0,
      providers.length,
      {
        provider: "gen",
        raw: gen,
        outcome: classifyAuditOutcome(gen),
      },
      {
        provider: "socket",
        raw: socket,
        outcome: classifyAuditOutcome(socket),
      },
      {
        provider: "snyk",
        raw: snyk,
        outcome: classifyAuditOutcome(snyk),
      },
    );
  }

  return {
    resolvedSource,
    detailsUrl,
    providers,
  };
}

export function classifyAuditOutcome(value: string): SkillAuditOutcome {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return "unknown";
  }

  if (normalized === "safe" || normalized === "pass" || /^0\s+alerts?$/u.test(normalized)) {
    return "pass";
  }

  if (/\b(fail|critical|high risk)\b/u.test(normalized)) {
    return "fail";
  }

  if (/^\d+\s+alerts?$/u.test(normalized)) {
    return normalized.startsWith("0 ") ? "pass" : "warn";
  }

  if (/\b(warn|risk|unknown|unaudited)\b/u.test(normalized)) {
    return "warn";
  }

  return "unknown";
}

export function evaluateSkillAudit(
  providers: SkillAuditProviderResult[],
  options: { allowUnsafe: boolean; allowUnaudited: boolean; detailsUrl?: string },
): SkillAuditDecision {
  if (providers.length === 0) {
    return {
      audited: false,
      allowed: options.allowUnaudited,
      reason: "unaudited",
      allowUnsafe: options.allowUnsafe,
      allowUnaudited: options.allowUnaudited,
      detailsUrl: options.detailsUrl,
      providers: [],
    };
  }

  const hasFail = providers.some((p) => p.outcome === "fail");
  const hasWarn = providers.some((p) => p.outcome === "warn" || p.outcome === "unknown");

  if (!hasFail && !hasWarn) {
    return {
      audited: true,
      allowed: true,
      reason: "pass",
      allowUnsafe: options.allowUnsafe,
      allowUnaudited: options.allowUnaudited,
      detailsUrl: options.detailsUrl,
      providers,
    };
  }

  if (hasFail) {
    return {
      audited: true,
      allowed: options.allowUnsafe,
      reason: "fail",
      allowUnsafe: options.allowUnsafe,
      allowUnaudited: options.allowUnaudited,
      detailsUrl: options.detailsUrl,
      providers,
    };
  }

  return {
    audited: true,
    allowed: true,
    reason: "warn",
    allowUnsafe: options.allowUnsafe,
    allowUnaudited: options.allowUnaudited,
    detailsUrl: options.detailsUrl,
    providers,
  };
}

async function readImportedSkillFiles(
  sandboxAbs: string,
  upstreamSkill: string,
  limits: SkillImportLimits,
): Promise<{ files: ImportedSkillFile[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const skillRootAbs = path.join(sandboxAbs, ".agents", "skills", upstreamSkill);

  let rootStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    rootStat = await fs.lstat(skillRootAbs);
  } catch {
    return {
      files: [],
      diagnostics: [
        {
          code: "SKILL_IMPORT_PAYLOAD_MISSING",
          severity: "error",
          message: `Imported payload not found at '.agents/skills/${upstreamSkill}'.`,
        },
      ],
    };
  }

  if (!rootStat.isDirectory()) {
    return {
      files: [],
      diagnostics: [
        {
          code: "SKILL_IMPORT_PAYLOAD_INVALID_ROOT",
          severity: "error",
          message: `Imported payload root '.agents/skills/${upstreamSkill}' is not a directory.`,
        },
      ],
    };
  }

  const files: ImportedSkillFile[] = [];
  const queue = [skillRootAbs];
  let totalBytes = 0;
  const utf8Decoder = new TextDecoder("utf8", { fatal: true });
  const openReadOnlyNoFollow =
    process.platform === "win32" ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

  let limitExceeded = false;

  outer: while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);

      let absoluteStat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        absoluteStat = await fs.lstat(absolutePath);
      } catch {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_READ_FAILED",
          severity: "error",
          message: `Failed to inspect imported file '${entry.name}'.`,
        });
        continue;
      }

      if (absoluteStat.isSymbolicLink()) {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_SYMLINK",
          severity: "error",
          message: `Symlink '${entry.name}' is not allowed in imported skill payload.`,
        });
        continue;
      }

      if (absoluteStat.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!absoluteStat.isFile()) {
        continue;
      }

      let relativePath: string;
      try {
        relativePath = normalizeRelativePath(path.relative(skillRootAbs, absolutePath).replace(/\\/g, "/"));
      } catch {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_PATH_INVALID",
          severity: "error",
          message: `Invalid imported file path '${absolutePath}'.`,
        });
        continue;
      }

      if (absoluteStat.size > limits.maxFileBytes) {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_FILE_TOO_LARGE",
          severity: "error",
          message: `Imported file '${relativePath}' exceeds max size (${limits.maxFileBytes} bytes).`,
        });
        continue;
      }

      let buffer: Buffer;
      try {
        const fileHandle = await fs.open(absolutePath, openReadOnlyNoFollow);
        try {
          buffer = await fileHandle.readFile();
        } finally {
          await fileHandle.close();
        }
      } catch (error) {
        if (isErrno(error, "ELOOP")) {
          diagnostics.push({
            code: "SKILL_IMPORT_PAYLOAD_SYMLINK",
            severity: "error",
            message: `Symlink '${relativePath}' is not allowed in imported skill payload.`,
          });
          continue;
        }

        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_READ_FAILED",
          severity: "error",
          message: `Failed to read imported file '${relativePath}'.`,
        });
        continue;
      }

      if (buffer.length > limits.maxFileBytes) {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_FILE_TOO_LARGE",
          severity: "error",
          message: `Imported file '${relativePath}' exceeds max size (${limits.maxFileBytes} bytes).`,
        });
        continue;
      }

      let content: string;
      let encoding: "utf8" | "base64" = "utf8";
      try {
        const decoded = utf8Decoder.decode(buffer);
        if (decoded.includes("\u0000")) {
          content = buffer.toString("base64");
          encoding = "base64";
        } else {
          content = decoded;
        }
      } catch {
        content = buffer.toString("base64");
        encoding = "base64";
      }

      totalBytes += buffer.length;
      if (totalBytes > limits.maxTotalBytes) {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_TOTAL_TOO_LARGE",
          severity: "error",
          message: `Imported payload exceeds max total size (${limits.maxTotalBytes} bytes).`,
        });
        limitExceeded = true;
        break outer;
      }

      files.push({
        path: relativePath,
        content,
        encoding,
        sha256: sha256(content),
        sizeBytes: buffer.length,
      });

      if (files.length > limits.maxFiles) {
        diagnostics.push({
          code: "SKILL_IMPORT_PAYLOAD_TOO_MANY_FILES",
          severity: "error",
          message: `Imported payload exceeds max file count (${limits.maxFiles}).`,
        });
        limitExceeded = true;
        break outer;
      }
    }
  }

  if (!limitExceeded && !files.some((file) => file.path === "SKILL.md")) {
    diagnostics.push({
      code: "SKILL_IMPORT_PAYLOAD_MISSING_SKILL_MD",
      severity: "error",
      message: "Imported payload must include a top-level SKILL.md file.",
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, diagnostics };
}

async function createDefaultSandbox(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-skills-"));
}

async function cleanupDefaultSandbox(sandboxAbs: string): Promise<void> {
  await fs.rm(sandboxAbs, { recursive: true, force: true });
}

async function runSkillsCliCommandDefault(args: string[], cwd: string): Promise<SkillsCliCommandResult> {
  const result = await execFileAsync("npx", ["-y", `skills@${SKILLS_CLI_VERSION}`, ...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeSkillsOutput(rawText: string): string {
  return stripAnsi(rawText)
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function stripAnsi(value: string): string {
  return value
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC sequence stripping for external CLI output.
      /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)/gu,
      "",
    )
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequence stripping for external CLI output.
      /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu,
      "",
    );
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
