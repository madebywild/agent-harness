import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function mkTmpRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-test-"));
}
