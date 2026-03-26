import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-test-"));
}

export async function initGitRepo(cwd: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd });
}
