import type { CliExecutionContext, CliResolvedContext } from "../contracts.js";

export type InteractionMode = "interactive" | "command";

interface RuntimeFlags {
  forceInteractive: boolean;
  forceNonInteractive: boolean;
}

export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  if (!value) {
    return false;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

export function isInteractiveTty(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): boolean {
  return stdin.isTTY === true && stdout.isTTY === true;
}

export function parseRuntimeFlags(argv: readonly string[]): RuntimeFlags {
  return {
    forceInteractive: argv.includes("--interactive"),
    forceNonInteractive: argv.includes("--no-interactive"),
  };
}

export function parseGlobalJsonFlag(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

export function parseGlobalCwd(argv: readonly string[], fallbackCwd: string): string {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--cwd") {
      const value = argv[index + 1];
      if (value) {
        return value;
      }
      continue;
    }

    if (token.startsWith("--cwd=")) {
      const [, value] = token.split("=", 2);
      if (value) {
        return value;
      }
    }
  }

  return fallbackCwd;
}

export function isNoArgShortcutEligible(argv: readonly string[]): boolean {
  let expectingCwdValue = false;

  for (const token of argv) {
    if (expectingCwdValue) {
      if (token.length === 0 || token.startsWith("-")) {
        return false;
      }
      expectingCwdValue = false;
      continue;
    }

    if (token === "--cwd") {
      expectingCwdValue = true;
      continue;
    }

    if (token.startsWith("--cwd=")) {
      const [, value] = token.split("=", 2);
      if (!value) {
        return false;
      }
      continue;
    }

    if (token === "--interactive" || token === "--no-interactive" || token === "--json") {
      continue;
    }

    // Let commander own help/version/unknown option handling.
    if (token.startsWith("-")) {
      return false;
    }

    // Positional args should not enter the no-arg shortcut path.
    return false;
  }

  return !expectingCwdValue;
}

export function detectPrimaryCommand(argv: readonly string[]): string | null {
  let skipNext = false;
  for (const token of argv) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (token === "--cwd") {
      skipNext = true;
      continue;
    }

    if (token.startsWith("--cwd=")) {
      continue;
    }

    if (token === "--") {
      return null;
    }

    if (token.startsWith("-")) {
      continue;
    }

    return token;
  }

  return null;
}

function parseInteractiveEnvOverride(env: NodeJS.ProcessEnv): boolean | undefined {
  const raw = env.HARNESS_INTERACTIVE;
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return undefined;
}

export function resolveNoArgMode(input: {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  isTty: boolean;
  isCi: boolean;
}): InteractionMode {
  const flags = parseRuntimeFlags(input.argv);

  if (flags.forceInteractive && flags.forceNonInteractive) {
    throw new Error("Cannot combine --interactive and --no-interactive");
  }

  if (flags.forceNonInteractive) {
    return "command";
  }

  if (flags.forceInteractive) {
    return "interactive";
  }

  const envOverride = parseInteractiveEnvOverride(input.env);
  if (envOverride === false) {
    return "command";
  }

  if (envOverride === true) {
    return "interactive";
  }

  if (input.isTty && !input.isCi) {
    return "interactive";
  }

  return "command";
}

export function ensureInteractiveFeasible(input: { isTty: boolean; isCi: boolean }): void {
  if (!input.isTty) {
    throw new Error("Interactive mode requires a TTY terminal");
  }

  if (input.isCi) {
    throw new Error("Interactive mode is disabled in CI. Use --no-interactive to run non-interactively.");
  }
}

export function resolveCliContext(context?: CliExecutionContext): CliResolvedContext {
  const env = context?.env ?? process.env;
  const resolvedIsCi = context?.isCi ?? isCi(env);
  const resolvedIsTty = context?.isTty ?? isInteractiveTty(process.stdin, process.stdout);

  return {
    cwd: context?.cwd ?? process.cwd(),
    env,
    stdout: context?.stdout ?? ((line: string) => process.stdout.write(`${line}\n`)),
    stderr: context?.stderr ?? ((line: string) => process.stderr.write(`${line}\n`)),
    now: context?.now ?? Date.now,
    isTty: resolvedIsTty,
    isCi: resolvedIsCi,
  };
}
