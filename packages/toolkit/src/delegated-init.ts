import { spawn } from "node:child_process";
import type { ProviderId } from "@madebywild/agent-harness-manifest";

export const DELEGATED_INIT_PRESET_ID = "delegate";

/**
 * Provider-specific CLI invocation details.
 *
 * - claude: `claude -p <task>` runs non-interactively (print mode).
 * - codex:  `codex exec <task>` runs non-interactively.
 * - copilot: `copilot -p <task>` runs non-interactively (prompt mode).
 */
const DELEGATED_INIT_COMMANDS: Record<ProviderId, { binary: string; buildArgs: (task: string) => string[] }> = {
  claude: { binary: "claude", buildArgs: (task) => ["-p", task] },
  codex: { binary: "codex", buildArgs: (task) => ["exec", task] },
  copilot: { binary: "copilot", buildArgs: (task) => ["-p", task] },
};

export function buildDelegatedBootstrapPrompt(): string {
  return `# System Prompt

This is a temporary bootstrap prompt for agent-harness.

Inspect the repository before writing the final instructions. Infer the stack, build and test commands, project layout, conventions, and any non-obvious workflows. Then replace this bootstrap content with a project-specific system prompt in \`.harness/src/prompts/system.md\`.

Manage all agent customization through the canonical harness sources, not generated provider files.

- Prompt: add or refine \`.harness/src/prompts/system.md\`
- MCP: manage \`.harness/src/mcp/*.json\`
- Skills: manage \`.harness/src/skills/<id>/\`
- Lifecycle hooks: manage \`.harness/src/hooks/*.json\`
- Provider settings: manage \`.harness/src/settings/<provider>.json\` or \`.toml\`
- Commands: manage \`.harness/src/commands/*.md\`

Use harness in non-interactive mode only.

- Prefer \`pnpm harness <command>\` when the repository uses pnpm and exposes a harness script
- Otherwise use \`npx harness <command>\`
- Use harness subcommands to manage prompts, MCP, skills, lifecycle hooks, settings, commands, plan, and apply

Do not edit generated files like \`CLAUDE.md\`, \`AGENTS.md\`, or \`.github/copilot-instructions.md\` directly. Harness owns those outputs and will regenerate them from the canonical sources.
`;
}

export function buildDelegatedInitTask(): string {
  return `Inspect this repository and finish agent-harness onboarding.

1. Replace the bootstrap content in .harness/src/prompts/system.md with the real shared system prompt for this project.
2. Add any other required harness entities using non-interactive pnpm harness or npx harness commands only.
3. Keep all edits in canonical .harness/src sources rather than generated provider outputs.
4. Run harness plan and apply when the setup is ready.

Do not edit generated files such as CLAUDE.md, AGENTS.md, or .github/copilot-instructions.md directly.`;
}

interface SpawnedProcessLike {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: "inherit";
  },
) => SpawnedProcessLike;

export function launchDelegatedInit(
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    provider: ProviderId;
  },
  spawnImpl: SpawnLike = (command, args, options) => spawn(command, [...args], options),
): Promise<void> {
  const { binary, buildArgs } = DELEGATED_INIT_COMMANDS[input.provider];
  const child = spawnImpl(binary, buildArgs(buildDelegatedInitTask()), {
    cwd: input.cwd,
    env: input.env,
    stdio: "inherit",
  });

  return new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`INIT_DELEGATE_FAILED: unable to launch '${binary}': ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`INIT_DELEGATE_FAILED: '${binary}' exited with ${detail}`));
    });
  });
}
