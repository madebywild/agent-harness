import { Spinner, TextInput } from "@inkjs/ui";
import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import { Box, render, Static, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { listBuiltinPresets, summarizePreset } from "../../presets.js";
import { CLI_ENTITY_TYPES } from "../../types.js";
import { getCommandDefinition } from "../command-registry.js";
import type { CommandId, CommandInput, CommandOutput } from "../contracts.js";
import { renderTextOutput } from "../renderers/text.js";
import { AutocompleteSelect } from "./autocomplete-select.js";
import { ToggleConfirm } from "./toggle-confirm.js";

export interface InteractiveExecutionApi {
  execute: (input: CommandInput) => Promise<CommandOutput>;
}

interface InteractiveRunResult {
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Command list shown in the main selector
// ---------------------------------------------------------------------------

const INTERACTIVE_COMMAND_IDS: readonly CommandId[] = [
  "init",
  "provider.enable",
  "provider.disable",
  "registry.list",
  "registry.default.show",
  "registry.default.set",
  "registry.add",
  "registry.remove",
  "registry.pull",
  "preset.list",
  "preset.describe",
  "preset.apply",
  "add.prompt",
  "add.skill",
  "add.mcp",
  "add.subagent",
  "add.hook",
  "add.settings",
  "add.command",
  "remove",
  "validate",
  "doctor",
  "migrate",
  "plan",
  "apply",
];

const COMMAND_OPTIONS = [
  ...INTERACTIVE_COMMAND_IDS.map((id) => ({
    label: getCommandDefinition(id).interactiveLabel ?? getCommandDefinition(id).description,
    value: id,
  })),
  { label: "Exit", value: "exit" },
];

// ---------------------------------------------------------------------------
// Wizard step types — a simple state machine
// ---------------------------------------------------------------------------

type WizardStep =
  | { type: "select-command" }
  | { type: "prompt-input"; commandId: CommandId; collector: InputCollector }
  | { type: "confirm-run"; commandId: CommandId; input: CommandInput }
  | { type: "running"; commandId: CommandId; input: CommandInput }
  | { type: "show-output"; label: string; lines: string[]; isError: boolean }
  | { type: "done" };

// ---------------------------------------------------------------------------
// Input collection — sequential prompts for a command
// ---------------------------------------------------------------------------

type CollectedValues = Record<string, string | boolean | undefined>;

interface InputCollector {
  prompts: CollectorPrompt[];
  values: CollectedValues;
  index: number;
}

type CollectorPrompt =
  | { id: string; type: "text"; message: string; required: boolean }
  | { id: string; type: "confirm"; message: string; initial: boolean }
  | { id: string; type: "select"; message: string; options: Array<{ label: string; value: string }> };

// ---------------------------------------------------------------------------
// Build the prompt list for each command
// ---------------------------------------------------------------------------

function buildPromptsForCommand(commandId: CommandId, presets: Array<{ id: string; name: string }>): CollectorPrompt[] {
  const providers = providerIdSchema.options.map((p) => ({ label: p, value: p }));
  const entityTypes = CLI_ENTITY_TYPES.map((t) => ({ label: t, value: t }));

  switch (commandId) {
    case "init":
      return [
        { id: "force", type: "confirm", message: "Overwrite existing .harness workspace if present?", initial: false },
        {
          id: "preset",
          type: "select",
          message: "Select a preset to apply during init",
          options: [
            { value: "", label: "Skip preset" },
            ...presets.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` })),
          ],
        },
        // delegate prompt inserted dynamically when preset === "delegate"
      ];

    case "provider.enable":
    case "provider.disable":
      return [{ id: "provider", type: "select", message: "Select provider", options: providers }];

    case "registry.add":
      return [
        { id: "name", type: "text", message: "Registry name", required: true },
        { id: "gitUrl", type: "text", message: "Git URL", required: true },
        { id: "ref", type: "text", message: "Git ref (default: main)", required: false },
        { id: "root", type: "text", message: "Registry root path", required: false },
        { id: "tokenEnv", type: "text", message: "Token env var", required: false },
      ];

    case "registry.remove":
    case "registry.default.set":
      return [{ id: "name", type: "text", message: "Registry name", required: true }];

    case "registry.pull":
      return [
        {
          id: "entityType",
          type: "select",
          message: "Entity type filter",
          options: [{ value: "", label: "All entity types" }, ...entityTypes],
        },
        { id: "id", type: "text", message: "Entity id filter", required: false },
        { id: "registry", type: "text", message: "Registry filter", required: false },
        { id: "force", type: "confirm", message: "Overwrite locally modified imported sources?", initial: false },
      ];

    case "preset.list":
      return [{ id: "registry", type: "text", message: "Registry id", required: false }];

    case "preset.describe":
    case "preset.apply":
      return [
        { id: "presetId", type: "text", message: "Preset id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.prompt":
      return [{ id: "registry", type: "text", message: "Registry id", required: false }];

    case "add.skill":
      return [
        { id: "skillId", type: "text", message: "Skill id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.mcp":
      return [
        { id: "configId", type: "text", message: "MCP config id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.subagent":
      return [
        { id: "subagentId", type: "text", message: "Subagent id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.hook":
      return [
        { id: "hookId", type: "text", message: "Hook id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.settings":
      return [
        { id: "provider", type: "select", message: "Provider", options: providers },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "add.command":
      return [
        { id: "commandId", type: "text", message: "Command id", required: true },
        { id: "registry", type: "text", message: "Registry id", required: false },
      ];

    case "remove":
      return [
        { id: "entityType", type: "select", message: "Entity type", options: entityTypes },
        { id: "id", type: "text", message: "Entity id", required: true },
        { id: "deleteSource", type: "confirm", message: "Delete source files too?", initial: true },
      ];

    case "migrate":
      return [{ id: "dryRun", type: "confirm", message: "Run as dry-run only?", initial: false }];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Build CommandInput from collected values
// ---------------------------------------------------------------------------

function buildCommandInput(commandId: CommandId, values: CollectedValues): CommandInput {
  const str = (k: string): string | undefined => {
    const v = values[k];
    if (typeof v === "string") {
      const t = v.trim();
      return t.length > 0 ? t : undefined;
    }
    return undefined;
  };
  const bool = (k: string, fallback = false): boolean => {
    const v = values[k];
    return typeof v === "boolean" ? v : fallback;
  };

  switch (commandId) {
    case "init":
      return {
        command: commandId,
        options: { force: bool("force"), preset: str("preset"), delegate: str("delegate") },
      };

    case "provider.enable":
    case "provider.disable":
      return { command: commandId, args: { provider: str("provider") } };

    case "registry.add":
      return {
        command: commandId,
        args: { name: str("name") },
        options: { gitUrl: str("gitUrl"), ref: str("ref"), root: str("root"), tokenEnv: str("tokenEnv") },
      };

    case "registry.remove":
    case "registry.default.set":
      return { command: commandId, args: { name: str("name") } };

    case "registry.pull":
      return {
        command: commandId,
        args: { entityType: str("entityType"), id: str("id") },
        options: { registry: str("registry"), force: bool("force") },
      };

    case "preset.list":
      return { command: commandId, options: { registry: str("registry") } };

    case "preset.describe":
    case "preset.apply":
      return { command: commandId, args: { presetId: str("presetId") }, options: { registry: str("registry") } };

    case "add.prompt":
      return { command: commandId, options: { registry: str("registry") } };

    case "add.skill":
      return { command: commandId, args: { skillId: str("skillId") }, options: { registry: str("registry") } };

    case "add.mcp":
      return { command: commandId, args: { configId: str("configId") }, options: { registry: str("registry") } };

    case "add.subagent":
      return { command: commandId, args: { subagentId: str("subagentId") }, options: { registry: str("registry") } };

    case "add.hook":
      return { command: commandId, args: { hookId: str("hookId") }, options: { registry: str("registry") } };

    case "add.settings":
      return { command: commandId, args: { provider: str("provider") }, options: { registry: str("registry") } };

    case "add.command":
      return { command: commandId, args: { commandId: str("commandId") }, options: { registry: str("registry") } };

    case "remove":
      return {
        command: commandId,
        args: { entityType: str("entityType"), id: str("id") },
        options: { deleteSource: bool("deleteSource", true) },
      };

    case "migrate":
      return { command: commandId, options: { to: "latest", dryRun: bool("dryRun") } };

    default:
      return { command: commandId };
  }
}

// ---------------------------------------------------------------------------
// React components
// ---------------------------------------------------------------------------

interface AppProps {
  api: InteractiveExecutionApi;
  presets: Array<{ id: string; name: string }>;
  onExit: (exitCode: number) => void;
}

function App({ api, presets, onExit }: AppProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>({ type: "select-command" });
  const [pastLines, setPastLines] = useState([{ id: 0, text: "Harness interactive mode" }]);
  const nextLineId = useRef(1);
  const [exitCode, setExitCode] = useState(0);

  const addPastLine = useCallback((text: string) => {
    const id = nextLineId.current++;
    setPastLines((prev) => [...prev, { id, text }]);
  }, []);

  // FIX 2: Transition out of prompt-input when all prompts are answered via useEffect,
  // not during render. Renders must be pure — no state updates allowed.
  useEffect(() => {
    if (step.type !== "prompt-input") return;
    const { commandId, collector } = step;
    if (collector.prompts[collector.index]) return;

    const input = buildCommandInput(commandId, collector.values);
    setStep(
      getCommandDefinition(commandId).mutatesWorkspace
        ? { type: "confirm-run", commandId, input }
        : { type: "running", commandId, input },
    );
  }, [step]);

  useEffect(() => {
    if (step.type === "done") {
      onExit(exitCode);
      exit();
    }
  }, [step, exitCode, exit, onExit]);

  const renderCurrentStep = () => {
    if (step.type === "select-command") {
      return (
        <Box marginTop={1}>
          <AutocompleteSelect
            label="Command"
            options={COMMAND_OPTIONS}
            onChange={(value) => {
              if (value === "exit") {
                addPastLine("Interactive session ended.");
                setStep({ type: "done" });
                return;
              }
              const commandId = value as CommandId;
              const prompts = buildPromptsForCommand(commandId, presets);
              setStep({ type: "prompt-input", commandId, collector: { prompts, values: {}, index: 0 } });
            }}
          />
        </Box>
      );
    }

    if (step.type === "prompt-input") {
      const { commandId, collector } = step;
      const prompt = collector.prompts[collector.index];

      // Effect above handles the transition when prompts are exhausted
      if (!prompt) return null;

      const advanceWith = (value: string | boolean) => {
        const newValues = { ...collector.values, [prompt.id]: value };
        let newPrompts = collector.prompts;

        // Dynamically inject delegate-provider prompt when "delegate" preset is selected
        if (commandId === "init" && prompt.id === "preset" && value === "delegate") {
          const delegatePrompt: CollectorPrompt = {
            id: "delegate",
            type: "select",
            message: "Select the provider CLI to delegate prompt authoring to",
            options: providerIdSchema.options.map((p) => ({ label: p, value: p })),
          };
          newPrompts = [
            ...collector.prompts.slice(0, collector.index + 1),
            delegatePrompt,
            ...collector.prompts.slice(collector.index + 1),
          ];
        }

        setStep({
          type: "prompt-input",
          commandId,
          collector: { prompts: newPrompts, values: newValues, index: collector.index + 1 },
        });
      };

      const cancelPrompt = () => {
        addPastLine("Cancelled command input.");
        setStep({ type: "select-command" });
      };

      if (prompt.type === "text") {
        return (
          <TextPrompt
            key={`${commandId}-${collector.index}`}
            message={prompt.message}
            required={prompt.required}
            onSubmit={advanceWith}
            onCancel={cancelPrompt}
          />
        );
      }

      if (prompt.type === "confirm") {
        return (
          <ToggleConfirm
            message={prompt.message}
            defaultValue={prompt.initial}
            onSubmit={advanceWith}
            onEscape={cancelPrompt}
          />
        );
      }

      if (prompt.type === "select") {
        return (
          <Box marginTop={1}>
            <AutocompleteSelect
              label={prompt.message}
              options={prompt.options}
              onChange={(value) => advanceWith(value)}
              onCancel={cancelPrompt}
            />
          </Box>
        );
      }
    }

    if (step.type === "confirm-run") {
      const { commandId, input } = step;
      const label = getCommandDefinition(commandId).interactiveLabel ?? commandId;
      return (
        <ToggleConfirm
          message={`Run '${label}' now?`}
          defaultValue
          onSubmit={(confirmed) => {
            if (confirmed) {
              setStep({ type: "running", commandId, input });
            } else {
              addPastLine("Cancelled command execution.");
              setStep({ type: "select-command" });
            }
          }}
        />
      );
    }

    if (step.type === "show-output") {
      return (
        <OutputStep
          label={step.label}
          lines={step.lines}
          isError={step.isError}
          onDismiss={() => setStep({ type: "select-command" })}
        />
      );
    }

    if (step.type === "running") {
      const { commandId, input } = step;
      const label = getCommandDefinition(commandId).interactiveLabel ?? commandId;
      return (
        <RunningStep
          label={label}
          input={input}
          api={api}
          onDone={(output, code) => {
            if (code !== 0) setExitCode(code);
            const lines: string[] = [];
            renderTextOutput(output, (line) => lines.push(line));
            setStep({ type: "show-output", label, lines, isError: code !== 0 });
          }}
          onError={(message) => {
            setExitCode(1);
            setStep({ type: "show-output", label, lines: [`Error: ${message}`], isError: true });
          }}
        />
      );
    }

    return null;
  };

  // FIX 1: A single Static at the root — never unmounts, never re-renders old items.
  // Step-specific content renders below it.
  return (
    <Box flexDirection="column">
      <Static items={pastLines}>{(line) => <Text key={line.id}>{line.text}</Text>}</Static>
      {renderCurrentStep()}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// TextPrompt — wraps TextInput and handles Escape via useInput
// ---------------------------------------------------------------------------

interface TextPromptProps {
  message: string;
  required: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function TextPrompt({ message, required, onSubmit, onCancel }: TextPromptProps) {
  const [error, setError] = useState(false);

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (error && !key.return) setError(false);
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>{message}: </Text>
        <TextInput
          placeholder={required ? "" : "optional"}
          onSubmit={(value) => {
            if (required && value.trim().length === 0) {
              setError(true);
              return;
            }
            onSubmit(value);
          }}
        />
      </Box>
      {error && <Text color="red">{"  This value is required"}</Text>}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// OutputStep — shows command output inline, dismissed with Enter
// ---------------------------------------------------------------------------

interface OutputStepProps {
  label: string;
  lines: string[];
  isError: boolean;
  onDismiss: () => void;
}

function OutputStep({ label, lines, isError, onDismiss }: OutputStepProps) {
  useInput((_input, key) => {
    if (key.return) onDismiss();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={isError ? "red" : "green"}>
        {isError ? `✗ ${label}` : `✓ ${label}`}
      </Text>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>{lines.join("\n")}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue...</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// RunningStep — fires the command once and shows a spinner
// ---------------------------------------------------------------------------

interface RunningStepProps {
  label: string;
  input: CommandInput;
  api: InteractiveExecutionApi;
  onDone: (output: CommandOutput, exitCode: number) => void;
  onError: (message: string) => void;
}

function RunningStep({ label, input, api, onDone, onError }: RunningStepProps) {
  const callbacks = useRef({ onDone, onError });
  callbacks.current = { onDone, onError };

  useEffect(() => {
    api
      .execute(input)
      .then((output) => {
        callbacks.current.onDone(output, output.exitCode);
      })
      .catch((err: unknown) => {
        callbacks.current.onError(err instanceof Error ? err.message : String(err));
      });
  }, [api, input]);

  return (
    <Box marginTop={1}>
      <Spinner label={`Running ${label}...`} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

export async function runInteractiveAdapter(api: InteractiveExecutionApi): Promise<InteractiveRunResult> {
  const presets = (await listBuiltinPresets()).map((p) => summarizePreset(p));

  let resolvedExitCode = 0;

  const { waitUntilExit } = render(
    <App
      api={api}
      presets={presets}
      onExit={(code) => {
        resolvedExitCode = code;
      }}
    />,
    { exitOnCtrlC: true },
  );

  await waitUntilExit();
  return { exitCode: resolvedExitCode };
}
