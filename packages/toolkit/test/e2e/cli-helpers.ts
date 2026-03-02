import { type ExecFileException, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const toolkitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface CliRunResult {
  stdout: string;
  stderr: string;
}

export interface CliFailure {
  code?: number;
  stdout: string;
  stderr: string;
  message: string;
}

export async function runHarnessCli(
  cwd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<CliRunResult> {
  const result = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", "--cwd", cwd, ...args], {
    cwd: toolkitDir,
    env: {
      ...process.env,
      ...options?.env,
    },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runHarnessCliExpectFailure(
  cwd: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<CliFailure> {
  try {
    await runHarnessCli(cwd, args, options);
  } catch (error) {
    const failure = error as ExecFileException & { stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === "number" ? failure.code : undefined,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
      message: failure.message,
    };
  }

  throw new Error(`Expected CLI command to fail: harness ${args.join(" ")}`);
}

export async function readWorkspaceJson<T>(cwd: string, relativePath: string): Promise<T> {
  const text = await fs.readFile(path.join(cwd, relativePath), "utf8");
  return JSON.parse(text) as T;
}

export async function readWorkspaceText(cwd: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(cwd, relativePath), "utf8");
}
