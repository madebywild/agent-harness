#!/usr/bin/env node
import { runCliArgv } from "./cli/main.js";

async function main(): Promise<void> {
  const result = await runCliArgv(process.argv.slice(2));
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
