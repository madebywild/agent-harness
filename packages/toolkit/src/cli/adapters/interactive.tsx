import { Spinner } from "@inkjs/ui";
import { providerIdSchema } from "@madebywild/agent-harness-manifest";
import {
  OnboardingComplete,
  type OnboardingCompleteProps,
  OutputStep,
  type OutputStepProps,
  TextPrompt,
  type TextPromptProps,
} from "@madebywild/agent-harness-tui";
import { Box, render, Static, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveHarnessPaths } from "../../paths.js";
import { listBuiltinPresets, summarizePreset } from "../../presets.js";
import type { Diagnostic, SkillDiscoveryResult } from "../../types.js";
import { CLI_ENTITY_TYPES } from "../../types.js";
import { exists } from "../../utils.js";
import { runDoctor } from "../../versioning/doctor.js";
import { getCommandDefinition } from "../command-registry.js";
import type { CommandId, CommandInput, CommandOutput } from "../contracts.js";
import { renderTextOutput } from "../renderers/text.js";
import { AutocompleteMultiSelect, AutocompleteSelect, type RenderLabelProps } from "./autocomplete-select.js";
import { ToggleConfirm } from "./toggle-confirm.js";

export {
  OnboardingComplete,
  type OnboardingCompleteProps,
  OutputStep,
  type OutputStepProps,
  TextPrompt,
  type TextPromptProps,
};

export interface InteractiveExecutionApi {
  execute: (input: CommandInput) => Promise<CommandOutput>;
}

// ---------------------------------------------------------------------------
// Workspace status detection
// ---------------------------------------------------------------------------

export type WorkspaceStatus =
  | { state: "missing" }
  | { state: "unhealthy"; diagnostics: Diagnostic[] }
  | { state: "healthy" };

export async function detectWorkspaceStatus(cwd: string): Promise<WorkspaceStatus> {
  const paths = resolveHarnessPaths(cwd);
  const [dirExists, manifestExists] = await Promise.all([exists(paths.agentsDir), exists(paths.manifestFile)]);
  if (!dirExists || !manifestExists) {
    return { state: "missing" };
  }
  try {
    const doctor = await runDoctor(paths);
    if (!doctor.healthy) {
      return { state: "unhealthy", diagnostics: doctor.diagnostics };
    }
    return { state: "healthy" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: "unhealthy",
      diagnostics: [
        {
          code: "INTERACTIVE_WORKSPACE_STATUS_CHECK_FAILED",
          severity: "error",
          message: `Failed to determine workspace health: ${message}`,
        },
      ],
    };
  }
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
  "skill.import",
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
  | { type: "onboarding" }
  | { type: "workspace-warning"; diagnostics: Diagnostic[] }
  | { type: "select-command" }
  | { type: "skills-import-workflow" }
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
  | {
      id: string;
      type: "select";
      message: string;
      options: Array<{ label: string; value: string }>;
    };

// ---------------------------------------------------------------------------
// Build the prompt list for each command
// ---------------------------------------------------------------------------

function buildPromptsForCommand(commandId: CommandId, presets: Array<{ id: string; name: string }>): CollectorPrompt[] {
  const providers = providerIdSchema.options.map((p) => ({
    label: p,
    value: p,
  }));
  const entityTypes = CLI_ENTITY_TYPES.map((t) => ({ label: t, value: t }));

  switch (commandId) {
    case "init":
      return [
        {
          id: "force",
          type: "confirm",
          message: "Overwrite existing .harness workspace if present?",
          initial: false,
        },
        {
          id: "preset",
          type: "select",
          message: "Select a preset to apply during init",
          options: [
            { value: "", label: "Skip preset" },
            ...presets.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.id})`,
            })),
          ],
        },
        // delegate prompt inserted dynamically when preset === "delegate"
      ];

    case "provider.enable":
    case "provider.disable":
      return [
        {
          id: "provider",
          type: "select",
          message: "Select provider",
          options: providers,
        },
      ];

    case "registry.add":
      return [
        { id: "name", type: "text", message: "Registry name", required: true },
        { id: "gitUrl", type: "text", message: "Git URL", required: true },
        {
          id: "ref",
          type: "text",
          message: "Git ref (default: main)",
          required: false,
        },
        {
          id: "root",
          type: "text",
          message: "Registry root path",
          required: false,
        },
        {
          id: "tokenEnv",
          type: "text",
          message: "Token env var",
          required: false,
        },
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
        {
          id: "id",
          type: "text",
          message: "Entity id filter",
          required: false,
        },
        {
          id: "registry",
          type: "text",
          message: "Registry filter",
          required: false,
        },
        {
          id: "force",
          type: "confirm",
          message: "Overwrite locally modified imported sources?",
          initial: false,
        },
      ];

    case "preset.list":
      return [
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "preset.describe":
    case "preset.apply":
      return [
        { id: "presetId", type: "text", message: "Preset id", required: true },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "skill.find":
      return [{ id: "query", type: "text", message: "Search query", required: true }];

    case "skill.import":
      return [
        {
          id: "source",
          type: "text",
          message: "Source (owner/repo, URL, or local path)",
          required: true,
        },
        {
          id: "upstreamSkill",
          type: "text",
          message: "Upstream skill id",
          required: true,
        },
        {
          id: "as",
          type: "text",
          message: "Target harness skill id",
          required: false,
        },
        {
          id: "replace",
          type: "confirm",
          message: "Replace existing skill if it already exists?",
          initial: false,
        },
        {
          id: "allowUnsafe",
          type: "confirm",
          message: "Allow non-pass audited skills?",
          initial: false,
        },
        {
          id: "allowUnaudited",
          type: "confirm",
          message: "Allow unaudited sources?",
          initial: false,
        },
      ];

    case "add.prompt":
      return [
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.skill":
      return [
        { id: "skillId", type: "text", message: "Skill id", required: true },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.mcp":
      return [
        {
          id: "configId",
          type: "text",
          message: "MCP config id",
          required: true,
        },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.subagent":
      return [
        {
          id: "subagentId",
          type: "text",
          message: "Subagent id",
          required: true,
        },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.hook":
      return [
        { id: "hookId", type: "text", message: "Hook id", required: true },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.settings":
      return [
        {
          id: "provider",
          type: "select",
          message: "Provider",
          options: providers,
        },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "add.command":
      return [
        {
          id: "commandId",
          type: "text",
          message: "Command id",
          required: true,
        },
        {
          id: "registry",
          type: "text",
          message: "Registry id",
          required: false,
        },
      ];

    case "remove":
      return [
        {
          id: "entityType",
          type: "select",
          message: "Entity type",
          options: entityTypes,
        },
        { id: "id", type: "text", message: "Entity id", required: true },
        {
          id: "deleteSource",
          type: "confirm",
          message: "Delete source files too?",
          initial: true,
        },
      ];

    case "migrate":
      return [
        {
          id: "dryRun",
          type: "confirm",
          message: "Run as dry-run only?",
          initial: false,
        },
      ];

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
        options: {
          force: bool("force"),
          preset: str("preset"),
          delegate: str("delegate"),
        },
      };

    case "provider.enable":
    case "provider.disable":
      return { command: commandId, args: { provider: str("provider") } };

    case "registry.add":
      return {
        command: commandId,
        args: { name: str("name") },
        options: {
          gitUrl: str("gitUrl"),
          ref: str("ref"),
          root: str("root"),
          tokenEnv: str("tokenEnv"),
        },
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
      return {
        command: commandId,
        args: { presetId: str("presetId") },
        options: { registry: str("registry") },
      };

    case "skill.find":
      return {
        command: commandId,
        args: { query: str("query") },
      };

    case "skill.import":
      return {
        command: commandId,
        args: { source: str("source") },
        options: {
          skill: str("upstreamSkill"),
          as: str("as"),
          replace: bool("replace"),
          allowUnsafe: bool("allowUnsafe"),
          allowUnaudited: bool("allowUnaudited"),
        },
      };

    case "add.prompt":
      return { command: commandId, options: { registry: str("registry") } };

    case "add.skill":
      return {
        command: commandId,
        args: { skillId: str("skillId") },
        options: { registry: str("registry") },
      };

    case "add.mcp":
      return {
        command: commandId,
        args: { configId: str("configId") },
        options: { registry: str("registry") },
      };

    case "add.subagent":
      return {
        command: commandId,
        args: { subagentId: str("subagentId") },
        options: { registry: str("registry") },
      };

    case "add.hook":
      return {
        command: commandId,
        args: { hookId: str("hookId") },
        options: { registry: str("registry") },
      };

    case "add.settings":
      return {
        command: commandId,
        args: { provider: str("provider") },
        options: { registry: str("registry") },
      };

    case "add.command":
      return {
        command: commandId,
        args: { commandId: str("commandId") },
        options: { registry: str("registry") },
      };

    case "remove":
      return {
        command: commandId,
        args: { entityType: str("entityType"), id: str("id") },
        options: { deleteSource: bool("deleteSource", true) },
      };

    case "migrate":
      return {
        command: commandId,
        options: { to: "latest", dryRun: bool("dryRun") },
      };

    default:
      return { command: commandId };
  }
}

// ---------------------------------------------------------------------------
// React components
// ---------------------------------------------------------------------------

export interface AppProps {
  api: InteractiveExecutionApi;
  presets: Array<{ id: string; name: string }>;
  workspaceStatus?: WorkspaceStatus;
  onExit: (exitCode: number) => void;
}

function initialStepFromStatus(status: WorkspaceStatus | undefined): WizardStep {
  if (!status || status.state === "healthy") return { type: "select-command" };
  if (status.state === "missing") return { type: "onboarding" };
  return { type: "workspace-warning", diagnostics: status.diagnostics };
}

export function App({ api, presets, workspaceStatus, onExit }: AppProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<WizardStep>(() => initialStepFromStatus(workspaceStatus));
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
    if (step.type === "onboarding") {
      return (
        <OnboardingWizard
          api={api}
          presets={presets}
          onComplete={() => {
            addPastLine("Onboarding complete.");
            setStep({ type: "select-command" });
          }}
        />
      );
    }

    if (step.type === "workspace-warning") {
      return (
        <WorkspaceWarningStep
          diagnostics={step.diagnostics}
          api={api}
          onDismiss={() => setStep({ type: "select-command" })}
        />
      );
    }

    if (step.type === "select-command") {
      return (
        <Box marginTop={1}>
          <AutocompleteSelect
            key="select-command"
            label="Command"
            options={COMMAND_OPTIONS}
            onChange={(value) => {
              if (value === "exit") {
                addPastLine("Interactive session ended.");
                setStep({ type: "done" });
                return;
              }
              const commandId = value as CommandId;
              if (commandId === "skill.import") {
                setStep({ type: "skills-import-workflow" });
                return;
              }
              const prompts = buildPromptsForCommand(commandId, presets);
              setStep({
                type: "prompt-input",
                commandId,
                collector: { prompts, values: {}, index: 0 },
              });
            }}
          />
        </Box>
      );
    }

    if (step.type === "skills-import-workflow") {
      return (
        <SkillsImportWorkflow
          api={api}
          onCancel={() => {
            addPastLine("Cancelled command input.");
            setStep({ type: "select-command" });
          }}
          onComplete={(lines, isError) => {
            setStep({
              type: "show-output",
              label: "Search and import third-party skills",
              lines,
              isError,
            });
          }}
          onDismiss={() => setStep({ type: "select-command" })}
        />
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
            options: providerIdSchema.options.map((p) => ({
              label: p,
              value: p,
            })),
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
          collector: {
            prompts: newPrompts,
            values: newValues,
            index: collector.index + 1,
          },
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
              key={`${commandId}-${collector.index}`}
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
            setStep({
              type: "show-output",
              label,
              lines: [`Error: ${message}`],
              isError: true,
            });
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
// RunningStep — fires the command once and shows a spinner
// ---------------------------------------------------------------------------

interface RunningStepProps {
  label: string;
  input: CommandInput;
  api: InteractiveExecutionApi;
  onDone: (output: CommandOutput, exitCode: number) => void;
  onError: (message: string) => void;
}

export function RunningStep({ label, input, api, onDone, onError }: RunningStepProps) {
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
// SkillsImportWorkflow — integrated search + multi-select + batch import
// ---------------------------------------------------------------------------

interface SkillsImportWorkflowProps {
  api: InteractiveExecutionApi;
  onCancel: () => void;
  onComplete: (lines: string[], isError: boolean) => void;
  onDismiss: () => void;
}

interface SkillSearchState {
  query: string;
  results: SkillDiscoveryResult[];
  diagnostics: Diagnostic[];
  rawText: string;
}

interface SkillImportOptionsState {
  replace: boolean;
  allowUnsafe: boolean;
  allowUnaudited: boolean;
}

const DEFAULT_SKILL_IMPORT_OPTIONS: SkillImportOptionsState = {
  replace: false,
  allowUnsafe: false,
  allowUnaudited: false,
};

const SKILL_IMPORT_OPTION_PROMPTS: Array<{
  key: keyof SkillImportOptionsState;
  message: string;
}> = [
  { key: "replace", message: "Replace existing local skills if they already exist?" },
  { key: "allowUnsafe", message: "Allow non-pass audited skills?" },
  { key: "allowUnaudited", message: "Allow unaudited sources?" },
];

interface SkillImportEntry {
  skill: SkillDiscoveryResult;
  ok: boolean;
  fileCount: number;
  auditSummary: string;
  errorMessage?: string;
}

type SkillImportWorkflowStep =
  | { type: "query" }
  | { type: "searching"; query: string }
  | { type: "select"; search: SkillSearchState }
  | {
      type: "options";
      search: SkillSearchState;
      selected: SkillDiscoveryResult[];
      options: SkillImportOptionsState;
      optionIndex: number;
    }
  | {
      type: "confirm";
      search: SkillSearchState;
      selected: SkillDiscoveryResult[];
      options: SkillImportOptionsState;
    }
  | {
      type: "running";
      search: SkillSearchState;
      selected: SkillDiscoveryResult[];
      options: SkillImportOptionsState;
    }
  | { type: "results"; entries: SkillImportEntry[] };

function formatDiagnosticLine(diagnostic: Diagnostic): string {
  const p = diagnostic.path ? ` (${diagnostic.path})` : "";
  return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${p}`;
}

function summarizeAudit(output: CommandOutput): string {
  if (output.family !== "skills" || output.data.operation !== "import") return "";
  const audit = output.data.result.audit;
  if (!audit.audited) return "";
  return audit.providers.map((p) => `${p.provider}: ${p.raw}`).join(" · ");
}

function extractUserError(output: CommandOutput): string | undefined {
  const errors = output.diagnostics.filter((d) => d.severity === "error");
  if (errors.length === 0) return undefined;
  for (const e of errors) {
    if (e.code === "SKILL_IMPORT_SUBPROCESS_FAILED") return "Skill source not found or unavailable.";
    if (e.code === "SKILL_IMPORT_AUDIT_BLOCKED") return "Blocked by security audit. Use --allow-unsafe to override.";
    if (e.code === "SKILL_IMPORT_AUDIT_UNAUDITED")
      return "No audit report available. Use --allow-unaudited to override.";
    if (e.code === "SKILL_IMPORT_COLLISION") return "Skill already exists. Enable replace to overwrite.";
    if (e.code?.startsWith("SKILL_IMPORT_PAYLOAD_")) return "Skill payload validation failed.";
  }
  return errors[0]?.message;
}

function formatSkillResultLabel(result: SkillDiscoveryResult): string {
  return `${result.source}@${result.upstreamSkill}`;
}

function SkillItemLabel({
  result,
  isFocused,
  isSelected,
}: {
  result: SkillDiscoveryResult;
  isFocused: boolean;
  isSelected: boolean;
}) {
  const nameColor = isSelected ? "green" : isFocused ? "cyan" : undefined;
  const meta = [result.source, result.installs].filter(Boolean).join(" · ");
  return (
    <Box flexDirection="column">
      <Text bold color={nameColor}>
        {result.upstreamSkill}
      </Text>
      {meta && <Text dimColor>{`    ${meta}`}</Text>}
    </Box>
  );
}

function readSkillFindState(output: CommandOutput): SkillSearchState | null {
  if (output.family !== "skills") return null;
  if (output.data.operation !== "find") return null;
  return {
    query: output.data.query,
    results: output.data.results,
    diagnostics: output.diagnostics,
    rawText: output.data.rawText,
  };
}

function buildSkillImportInput(skill: SkillDiscoveryResult, options: SkillImportOptionsState): CommandInput {
  return {
    command: "skill.import",
    args: { source: skill.source },
    options: {
      skill: skill.upstreamSkill,
      replace: options.replace,
      allowUnsafe: options.allowUnsafe,
      allowUnaudited: options.allowUnaudited,
    },
  };
}

function SkillsImportWorkflow({ api, onCancel, onComplete, onDismiss }: SkillsImportWorkflowProps) {
  const [step, setStep] = useState<SkillImportWorkflowStep>({ type: "query" });
  const runningRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (runningRef.current) return;

    if (step.type === "searching") {
      runningRef.current = true;
      api
        .execute({ command: "skill.find", args: { query: step.query } })
        .then((output) => {
          const search = readSkillFindState(output);
          if (!search) {
            onCompleteRef.current(["Error: Unexpected output while searching third-party skills."], true);
            return;
          }

          if (search.results.length === 0) {
            const lines = [`No skills found for query '${search.query}'.`];
            if (search.rawText.trim().length > 0) {
              lines.push("", search.rawText.trim());
            }
            if (search.diagnostics.length > 0) {
              lines.push("", ...search.diagnostics.map(formatDiagnosticLine));
            }
            onCompleteRef.current(lines, output.exitCode !== 0);
            return;
          }

          setStep({ type: "select", search });
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          onCompleteRef.current([`Error: ${message}`], true);
        })
        .finally(() => {
          runningRef.current = false;
        });
      return;
    }

    if (step.type === "running") {
      runningRef.current = true;
      (async () => {
        const entries: SkillImportEntry[] = [];
        for (const skill of step.selected) {
          const output = await api.execute(buildSkillImportInput(skill, step.options));
          const fileCount =
            output.family === "skills" && output.data.operation === "import" ? output.data.result.fileCount : 0;
          entries.push({
            skill,
            ok: output.ok,
            fileCount,
            auditSummary: summarizeAudit(output),
            errorMessage: output.ok ? undefined : extractUserError(output),
          });
        }
        setStep({ type: "results", entries });
      })()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          onCompleteRef.current([`Error: ${message}`], true);
        })
        .finally(() => {
          runningRef.current = false;
        });
    }
  }, [api, step]);

  if (step.type === "query") {
    return (
      <TextPrompt
        key="skill-import-query"
        message="Search third-party skills"
        required
        onSubmit={(value) => {
          const query = value.trim();
          if (query.length === 0) return;
          setStep({ type: "searching", query });
        }}
        onCancel={onCancel}
      />
    );
  }

  if (step.type === "searching") {
    return (
      <Box marginTop={1}>
        <Spinner label={`Searching skills for '${step.query}'...`} />
      </Box>
    );
  }

  if (step.type === "select") {
    const results = step.search.results;
    const options = results.map((result, index) => ({
      value: String(index),
      label: formatSkillResultLabel(result),
    }));
    const renderSkillLabel = ({ option, isFocused, isSelected }: RenderLabelProps) => {
      const result = results[Number(option.value)];
      if (!result) return null;
      return <SkillItemLabel result={result} isFocused={isFocused} isSelected={isSelected} />;
    };

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>{`Found ${results.length} skill(s) for '${step.search.query}'.`}</Text>
        <Box marginTop={1}>
          <AutocompleteMultiSelect
            key={`skill-import-select-${step.search.query}`}
            label="Filter skills"
            options={options}
            renderLabel={renderSkillLabel}
            onCancel={onCancel}
            onSubmit={(selectedValues) => {
              const selected = selectedValues
                .map((value) => Number.parseInt(value, 10))
                .filter((index) => Number.isInteger(index))
                .map((index) => step.search.results[index])
                .filter((result): result is SkillDiscoveryResult => result !== undefined);

              if (selected.length === 0) {
                onComplete(["No skills selected. Nothing imported."], false);
                return;
              }

              setStep({
                type: "options",
                search: step.search,
                selected,
                options: { ...DEFAULT_SKILL_IMPORT_OPTIONS },
                optionIndex: 0,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (step.type === "options") {
    const prompt = SKILL_IMPORT_OPTION_PROMPTS[step.optionIndex];
    if (!prompt) {
      return null;
    }
    return (
      <ToggleConfirm
        key={`skill-import-option-${step.optionIndex}`}
        message={prompt.message}
        defaultValue={step.options[prompt.key]}
        onEscape={onCancel}
        onSubmit={(value) => {
          const nextOptions: SkillImportOptionsState = {
            ...step.options,
            [prompt.key]: value,
          };

          const nextIndex = step.optionIndex + 1;
          if (nextIndex < SKILL_IMPORT_OPTION_PROMPTS.length) {
            setStep({
              ...step,
              options: nextOptions,
              optionIndex: nextIndex,
            });
            return;
          }

          setStep({
            type: "confirm",
            search: step.search,
            selected: step.selected,
            options: nextOptions,
          });
        }}
      />
    );
  }

  if (step.type === "confirm") {
    return (
      <ToggleConfirm
        message={`Import ${step.selected.length} selected skill(s) now?`}
        defaultValue
        onEscape={onCancel}
        onSubmit={(confirmed) => {
          if (!confirmed) {
            onCancel();
            return;
          }

          setStep({
            type: "running",
            search: step.search,
            selected: step.selected,
            options: step.options,
          });
        }}
      />
    );
  }

  if (step.type === "running") {
    return (
      <Box marginTop={1}>
        <Spinner label={`Importing ${step.selected.length} skill(s)...`} />
      </Box>
    );
  }

  if (step.type === "results") {
    return <SkillImportResults entries={step.entries} onDismiss={onDismiss} />;
  }

  return null;
}

function SkillImportResults({ entries, onDismiss }: { entries: SkillImportEntry[]; onDismiss: () => void }) {
  useInput((_input, key) => {
    if (key.return) onDismiss();
  });

  const imported = entries.filter((e) => e.ok);
  const failed = entries.filter((e) => !e.ok);
  const allOk = failed.length === 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={allOk ? "green" : "yellow"}>
        {allOk ? `✓ Imported ${imported.length} skill(s)` : `${imported.length} imported, ${failed.length} failed`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry) => (
          <Box key={`${entry.skill.source}/${entry.skill.upstreamSkill}`} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color={entry.ok ? "green" : "red"}>{entry.ok ? "✓" : "✗"}</Text>
              <Text bold>{entry.skill.upstreamSkill}</Text>
              <Text dimColor>{entry.skill.source}</Text>
            </Box>
            {entry.ok && entry.fileCount > 0 && <Text dimColor>{`    ${entry.fileCount} file(s) added`}</Text>}
            {entry.ok && entry.auditSummary && <Text dimColor>{`    Audit: ${entry.auditSummary}`}</Text>}
            {!entry.ok && entry.errorMessage && <Text color="red">{`    ${entry.errorMessage}`}</Text>}
          </Box>
        ))}
      </Box>
      <Text dimColor>Press Enter to continue...</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// OnboardingWizard — full guided setup for new workspaces
// ---------------------------------------------------------------------------

const HARNESS_LOGO = `   __ __
  / // /__ ________  ___ ___ ___
 / _  / _ \`/ __/ _ \\/ -_|_-<(_-<
/_//_/\\_,_/_/ /_//_/\\__/___/___/`;

const HARNESS_TAGLINE = "Configure your AI coding agents from a single source of truth.";

type OnboardingSubStep =
  | { type: "welcome" }
  | { type: "preset" }
  | { type: "delegate-provider" }
  | { type: "running-init"; preset?: string; delegate?: string }
  | { type: "init-error"; message: string; preset?: string; delegate?: string }
  | { type: "providers"; selected: string[] }
  | { type: "running-providers"; selected: string[] }
  | { type: "add-prompt" }
  | { type: "running-add-prompt" }
  | { type: "running-apply" }
  | { type: "complete"; summary: string[] };

interface OnboardingWizardProps {
  api: InteractiveExecutionApi;
  presets: Array<{ id: string; name: string }>;
  onComplete: () => void;
}

function OnboardingWizard({ api, presets, onComplete }: OnboardingWizardProps) {
  const [subStep, setSubStep] = useState<OnboardingSubStep>({
    type: "welcome",
  });
  const [revealIndex, setRevealIndex] = useState(0);
  const [animationDone, setAnimationDone] = useState(false);
  const summaryRef = useRef<string[]>([]);
  const runningRef = useRef(false);

  const fullText = `${HARNESS_LOGO}\n\n  ${HARNESS_TAGLINE}`;

  // Animated typing effect for welcome screen
  useEffect(() => {
    if (subStep.type !== "welcome") return;
    if (revealIndex >= fullText.length) {
      setAnimationDone(true);
      return;
    }
    const timer = setTimeout(() => setRevealIndex((i) => i + 1), revealIndex === 0 ? 100 : 8);
    return () => clearTimeout(timer);
  }, [subStep.type, revealIndex, fullText.length]);

  useInput((_input, key) => {
    if (subStep.type === "welcome" && key.return) {
      if (!animationDone) {
        setRevealIndex(fullText.length);
        setAnimationDone(true);
      } else {
        setSubStep({ type: "preset" });
      }
    }
  });

  // Single effect for all async onboarding actions, guarded by ref.
  // Uses else-if so only one branch can fire per render cycle.
  useEffect(() => {
    if (runningRef.current) return;

    if (subStep.type === "running-init") {
      runningRef.current = true;
      api
        .execute({
          command: "init",
          options: {
            force: false,
            preset: subStep.preset,
            delegate: subStep.delegate,
          },
        })
        .then((output) => {
          if (output.exitCode !== 0) {
            const lines: string[] = [];
            renderTextOutput(output, (line) => lines.push(line));
            setSubStep({
              type: "init-error",
              message: lines.join("\n"),
              preset: subStep.preset,
              delegate: subStep.delegate,
            });
            return;
          }
          summaryRef.current.push("Initialized .harness/ workspace");
          if (subStep.preset) summaryRef.current.push(`Applied preset: ${subStep.preset}`);
          setSubStep({ type: "providers", selected: [] });
        })
        .catch((err: unknown) => {
          setSubStep({
            type: "init-error",
            message: err instanceof Error ? err.message : String(err),
            preset: subStep.preset,
            delegate: subStep.delegate,
          });
        })
        .finally(() => {
          runningRef.current = false;
        });
    } else if (subStep.type === "running-providers") {
      runningRef.current = true;
      const { selected } = subStep;
      (async () => {
        for (const provider of selected) {
          await api.execute({ command: "provider.enable", args: { provider } });
        }
        summaryRef.current.push(`Enabled provider(s): ${selected.join(", ")}`);
        setSubStep({ type: "add-prompt" });
      })()
        .catch((err: unknown) => {
          summaryRef.current.push(
            `Warning: provider enablement failed (${err instanceof Error ? err.message : String(err)})`,
          );
          setSubStep({ type: "add-prompt" });
        })
        .finally(() => {
          runningRef.current = false;
        });
    } else if (subStep.type === "running-add-prompt") {
      runningRef.current = true;
      api
        .execute({ command: "add.prompt" })
        .then(() => {
          summaryRef.current.push("Added system prompt entity");
          setSubStep({ type: "running-apply" });
        })
        .catch((err: unknown) => {
          summaryRef.current.push(
            `Warning: failed to add prompt (${err instanceof Error ? err.message : String(err)})`,
          );
          setSubStep({ type: "running-apply" });
        })
        .finally(() => {
          runningRef.current = false;
        });
    } else if (subStep.type === "running-apply") {
      runningRef.current = true;
      api
        .execute({ command: "apply" })
        .then(() => {
          summaryRef.current.push("Applied workspace (generated provider artifacts)");
          setSubStep({ type: "complete", summary: summaryRef.current });
        })
        .catch((err: unknown) => {
          summaryRef.current.push(`Warning: apply failed (${err instanceof Error ? err.message : String(err)})`);
          setSubStep({ type: "complete", summary: summaryRef.current });
        })
        .finally(() => {
          runningRef.current = false;
        });
    }
  }, [subStep, api]);

  if (subStep.type === "welcome") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">{fullText.slice(0, revealIndex)}</Text>
        {animationDone && (
          <Box marginTop={1}>
            <Text dimColor>Press Enter to get started...</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (subStep.type === "preset") {
    const presetOptions = [
      { value: "", label: "Skip preset" },
      ...presets.map((p) => ({ value: p.id, label: `${p.name} (${p.id})` })),
    ];
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Step 1/4 — Choose a preset</Text>
        <Box marginTop={1}>
          <AutocompleteSelect
            key="onboarding-preset"
            label="Preset"
            options={presetOptions}
            onChange={(value) => {
              if (value === "delegate") {
                setSubStep({ type: "delegate-provider" });
              } else {
                setSubStep({
                  type: "running-init",
                  preset: value || undefined,
                });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (subStep.type === "delegate-provider") {
    const providers = providerIdSchema.options.map((p) => ({
      label: p,
      value: p,
    }));
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Step 1/4 — Select delegate provider</Text>
        <Box marginTop={1}>
          <AutocompleteSelect
            key="onboarding-delegate"
            label="Provider"
            options={providers}
            onChange={(value) => {
              setSubStep({
                type: "running-init",
                preset: "delegate",
                delegate: value,
              });
            }}
          />
        </Box>
      </Box>
    );
  }

  if (subStep.type === "running-init") {
    return (
      <Box marginTop={1}>
        <Spinner label="Initializing workspace..." />
      </Box>
    );
  }

  if (subStep.type === "init-error") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="red">
          Initialization failed
        </Text>
        <Box marginLeft={2} marginTop={1}>
          <Text>{subStep.message}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Please resolve the issue and try again.</Text>
        </Box>
        <Box marginTop={1}>
          <AutocompleteSelect
            key="onboarding-init-error-action"
            label="Action"
            options={[
              { label: "Retry initialization", value: "retry" },
              { label: "Back", value: "back" },
              { label: "Continue to main menu", value: "continue" },
            ]}
            onChange={(value) => {
              if (value === "retry") {
                setSubStep({
                  type: "running-init",
                  preset: subStep.preset,
                  delegate: subStep.delegate,
                });
                return;
              }
              if (value === "back") {
                if (subStep.preset === "delegate") {
                  setSubStep({ type: "delegate-provider" });
                } else {
                  setSubStep({ type: "preset" });
                }
                return;
              }
              onComplete();
            }}
          />
        </Box>
      </Box>
    );
  }

  if (subStep.type === "providers") {
    const remaining = providerIdSchema.options
      .filter((p) => !subStep.selected.includes(p))
      .map((p) => ({ label: p, value: p }));
    const doneLabel = subStep.selected.length === 0 ? "Skip (enable later)" : `Done (${subStep.selected.join(", ")})`;
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Step 2/4 — Enable providers</Text>
        {subStep.selected.length > 0 && <Text dimColor>Selected: {subStep.selected.join(", ")}</Text>}
        <Box marginTop={1}>
          <AutocompleteSelect
            key={`onboarding-providers-${subStep.selected.length}`}
            label="Provider"
            options={[{ label: doneLabel, value: "" }, ...remaining]}
            onChange={(value) => {
              if (!value) {
                if (subStep.selected.length === 0) {
                  setSubStep({ type: "add-prompt" });
                } else {
                  setSubStep({
                    type: "running-providers",
                    selected: subStep.selected,
                  });
                }
              } else {
                setSubStep({
                  type: "providers",
                  selected: [...subStep.selected, value],
                });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (subStep.type === "running-providers") {
    return (
      <Box marginTop={1}>
        <Spinner label={`Enabling provider(s): ${subStep.selected.join(", ")}...`} />
      </Box>
    );
  }

  if (subStep.type === "add-prompt") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Step 3/4 — System prompt</Text>
        <ToggleConfirm
          message="Add a system prompt entity?"
          defaultValue
          onSubmit={(yes) => {
            if (yes) {
              setSubStep({ type: "running-add-prompt" });
            } else {
              setSubStep({ type: "running-apply" });
            }
          }}
        />
      </Box>
    );
  }

  if (subStep.type === "running-add-prompt") {
    return (
      <Box marginTop={1}>
        <Spinner label="Adding system prompt..." />
      </Box>
    );
  }

  if (subStep.type === "running-apply") {
    return (
      <Box marginTop={1}>
        <Spinner label="Step 4/4 — Applying workspace..." />
      </Box>
    );
  }

  if (subStep.type === "complete") {
    return <OnboardingComplete summary={subStep.summary} onDismiss={onComplete} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// WorkspaceWarningStep — shown when doctor detects issues
// ---------------------------------------------------------------------------

interface WorkspaceWarningStepProps {
  diagnostics: Diagnostic[];
  api: InteractiveExecutionApi;
  onDismiss: () => void;
}

function WorkspaceWarningStep({ diagnostics, api, onDismiss }: WorkspaceWarningStepProps) {
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<{
    lines: string[];
    isError: boolean;
  } | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!running || runningRef.current) return;
    runningRef.current = true;
    api
      .execute({ command: "doctor" })
      .then((result) => {
        const lines: string[] = [];
        renderTextOutput(result, (line) => lines.push(line));
        setOutput({ lines, isError: result.exitCode !== 0 });
      })
      .catch((err: unknown) => {
        setOutput({
          lines: [err instanceof Error ? err.message : String(err)],
          isError: true,
        });
      })
      .finally(() => {
        runningRef.current = false;
        setRunning(false);
      });
  }, [running, api]);

  useInput((_input, key) => {
    if (output && key.return) onDismiss();
  });

  if (running) {
    return (
      <Box marginTop={1}>
        <Spinner label="Running doctor..." />
      </Box>
    );
  }

  if (output) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={output.isError ? "red" : "green"}>
          {output.isError ? "✗ Doctor" : "✓ Doctor"}
        </Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text>{output.lines.join("\n")}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to continue...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">
        Workspace issues detected
      </Text>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        {diagnostics.map((d) => (
          <Text key={d.code}>
            <Text color="yellow">[{d.severity}]</Text> {d.code}: {d.message}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <AutocompleteSelect
          key="workspace-warning"
          label="Action"
          options={[
            { label: "Run doctor", value: "doctor" },
            { label: "Continue to menu", value: "continue" },
          ]}
          onChange={(value) => {
            if (value === "doctor") {
              setRunning(true);
            } else {
              onDismiss();
            }
          }}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Exported entry point
// ---------------------------------------------------------------------------

export async function runInteractiveAdapter(
  api: InteractiveExecutionApi,
  options?: { cwd?: string },
): Promise<InteractiveRunResult> {
  const cwd = options?.cwd ?? process.cwd();
  const [presets, workspaceStatus] = await Promise.all([
    listBuiltinPresets().then((ps) => ps.map(summarizePreset)),
    detectWorkspaceStatus(cwd),
  ]);

  let resolvedExitCode = 0;

  const { waitUntilExit } = render(
    <App
      api={api}
      presets={presets}
      workspaceStatus={workspaceStatus}
      onExit={(code) => {
        resolvedExitCode = code;
      }}
    />,
    { exitOnCtrlC: true },
  );

  await waitUntilExit();
  return { exitCode: resolvedExitCode };
}
