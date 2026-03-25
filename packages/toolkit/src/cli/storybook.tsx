#!/usr/bin/env node
/**
 * Terminal Storybook — browse and preview TUI components in isolation.
 *
 * Usage:  pnpm --filter @madebywild/agent-harness-framework storybook
 *   or:   tsx packages/toolkit/src/cli/storybook.tsx
 */

import { Spinner } from "@inkjs/ui";
import {
  AutocompleteSelect,
  OnboardingComplete,
  OutputStep,
  TextPrompt,
  ToggleConfirm,
} from "@madebywild/agent-harness-tui";
import { Box, render, Text, useApp, useInput } from "ink";
import type { ReactNode } from "react";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Story definitions
// ---------------------------------------------------------------------------

interface Story {
  label: string;
  value: string;
  render: (onBack: () => void) => ReactNode;
}

const SAMPLE_OPTIONS = [
  { label: "Initialize workspace", value: "init" },
  { label: "Enable provider", value: "provider.enable" },
  { label: "Disable provider", value: "provider.disable" },
  { label: "Add skill", value: "add.skill" },
  { label: "Add MCP server", value: "add.mcp" },
  { label: "Add subagent", value: "add.subagent" },
  { label: "Add hook", value: "add.hook" },
  { label: "Add settings", value: "add.settings" },
  { label: "Add command", value: "add.command" },
  { label: "Remove entity", value: "remove" },
  { label: "Validate workspace", value: "validate" },
  { label: "Run doctor", value: "doctor" },
  { label: "Run migration", value: "migrate" },
  { label: "Plan changes", value: "plan" },
  { label: "Apply changes", value: "apply" },
  { label: "Registry list", value: "registry.list" },
  { label: "Registry add", value: "registry.add" },
  { label: "Registry remove", value: "registry.remove" },
  { label: "Registry pull", value: "registry.pull" },
  { label: "Exit", value: "exit" },
];

const PROVIDER_OPTIONS = [
  { label: "claude", value: "claude" },
  { label: "codex", value: "codex" },
  { label: "copilot", value: "copilot" },
];

function StoryValue({ label, value }: { label: string; value: string | null }) {
  if (value === null) {
    return null;
  }

  return (
    <Box marginTop={1}>
      <Text dimColor>{`${label}: ${value}`}</Text>
    </Box>
  );
}

function AutocompleteDefaultStory({ onBack }: { onBack: () => void }) {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <StoryFrame title="AutocompleteSelect">
      <AutocompleteSelect options={SAMPLE_OPTIONS} onChange={setLastSelected} onCancel={onBack} />
      <StoryValue label="Last selected" value={lastSelected} />
    </StoryFrame>
  );
}

function AutocompleteFewStory({ onBack }: { onBack: () => void }) {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <StoryFrame title="AutocompleteSelect (few options)">
      <AutocompleteSelect options={PROVIDER_OPTIONS} label="Provider" onChange={setLastSelected} onCancel={onBack} />
      <StoryValue label="Last selected" value={lastSelected} />
    </StoryFrame>
  );
}

function AutocompleteVisibleCountStory({ onBack }: { onBack: () => void }) {
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  return (
    <StoryFrame title="AutocompleteSelect (visibleOptionCount=4)">
      <AutocompleteSelect
        options={SAMPLE_OPTIONS}
        visibleOptionCount={4}
        onChange={setLastSelected}
        onCancel={onBack}
      />
      <StoryValue label="Last selected" value={lastSelected} />
    </StoryFrame>
  );
}

function ToggleConfirmStory({
  defaultValue,
  message,
  onBack,
  title,
}: {
  defaultValue: boolean;
  message: string;
  onBack: () => void;
  title: string;
}) {
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  return (
    <StoryFrame title={title}>
      <ToggleConfirm
        message={message}
        defaultValue={defaultValue}
        onSubmit={(value) => setLastSubmitted(value ? "Yes" : "No")}
        onEscape={onBack}
      />
      <StoryValue label="Last submitted" value={lastSubmitted} />
    </StoryFrame>
  );
}

function TextPromptStory({
  onBack,
  required,
  title,
  message,
}: {
  onBack: () => void;
  required: boolean;
  title: string;
  message: string;
}) {
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  return (
    <StoryFrame title={title}>
      <TextPrompt
        message={message}
        required={required}
        onSubmit={(value) => setLastSubmitted(value.length > 0 ? value : "(empty)")}
        onCancel={onBack}
      />
      <StoryValue label="Last submitted" value={lastSubmitted} />
    </StoryFrame>
  );
}

const STORIES: Story[] = [
  {
    label: "AutocompleteSelect (default)",
    value: "autocomplete-default",
    render: (onBack) => <AutocompleteDefaultStory onBack={onBack} />,
  },
  {
    label: "AutocompleteSelect (few options)",
    value: "autocomplete-few",
    render: (onBack) => <AutocompleteFewStory onBack={onBack} />,
  },
  {
    label: "AutocompleteSelect (custom visible count)",
    value: "autocomplete-visible",
    render: (onBack) => <AutocompleteVisibleCountStory onBack={onBack} />,
  },
  {
    label: "ToggleConfirm (default=false)",
    value: "toggle-default-no",
    render: (onBack) => (
      <ToggleConfirmStory
        title="ToggleConfirm (default No)"
        message="Overwrite existing workspace?"
        defaultValue={false}
        onBack={onBack}
      />
    ),
  },
  {
    label: "ToggleConfirm (default=true)",
    value: "toggle-default-yes",
    render: (onBack) => (
      <ToggleConfirmStory
        title="ToggleConfirm (default Yes)"
        message="Add a system prompt entity?"
        defaultValue
        onBack={onBack}
      />
    ),
  },
  {
    label: "TextPrompt (required)",
    value: "text-required",
    render: (onBack) => <TextPromptStory title="TextPrompt (required)" message="Skill id" required onBack={onBack} />,
  },
  {
    label: "TextPrompt (optional)",
    value: "text-optional",
    render: (onBack) => (
      <TextPromptStory title="TextPrompt (optional)" message="Registry id" required={false} onBack={onBack} />
    ),
  },
  {
    label: "OutputStep (success)",
    value: "output-success",
    render: (onBack) => (
      <StoryFrame title="OutputStep (success)" onBack={onBack}>
        <OutputStep
          label="Apply"
          lines={[
            "Created CLAUDE.md",
            "Created .github/copilot-instructions.md",
            "Updated .harness/lock.json",
            "3 artifacts written, 0 pruned",
          ]}
          isError={false}
          onDismiss={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "OutputStep (error)",
    value: "output-error",
    render: (onBack) => (
      <StoryFrame title="OutputStep (error)" onBack={onBack}>
        <OutputStep
          label="Apply"
          lines={[
            "Error: Manifest validation failed",
            "  - Missing required field 'entities'",
            "  - Invalid provider id",
          ]}
          isError
          onDismiss={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "Spinner",
    value: "spinner",
    render: (onBack) => (
      <StoryFrame title="Spinner" onBack={onBack}>
        <Box marginTop={1}>
          <Spinner label="Running apply..." />
        </Box>
      </StoryFrame>
    ),
  },
  {
    label: "OnboardingComplete",
    value: "onboarding-complete",
    render: (onBack) => (
      <StoryFrame title="OnboardingComplete" onBack={onBack}>
        <OnboardingComplete
          summary={[
            "Initialized .harness/ workspace",
            "Applied preset: starter",
            "Enabled provider(s): claude, copilot",
            "Added system prompt entity",
            "Applied workspace (generated provider artifacts)",
          ]}
          onDismiss={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "Welcome screen (logo)",
    value: "welcome",
    render: (onBack) => {
      const logo = `   __ __
  / // /__ ________  ___ ___ ___
 / _  / _ \`/ __/ _ \\/ -_|_-<(_-<
/_//_/\\_,_/_/ /_//_/\\__/___/___/`;
      const tagline = "Configure your AI coding agents from a single source of truth.";
      return (
        <StoryFrame title="Welcome Screen" onBack={onBack}>
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">{logo}</Text>
            <Box marginTop={1}>
              <Text color="cyan">
                {"  "}
                {tagline}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to get started...</Text>
            </Box>
          </Box>
        </StoryFrame>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// StoryFrame — wraps each story with a title bar and back hint
// ---------------------------------------------------------------------------

function StoryFrame({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  useInput(
    (_input, key) => {
      if (key.escape) {
        onBack?.();
      }
    },
    { isActive: onBack !== undefined },
  );

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          {title}
        </Text>
      </Box>
      {children}
      <Box marginTop={1}>
        <Text dimColor>Escape to go back to story list</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// StorybookApp — main storybook shell
// ---------------------------------------------------------------------------

function StorybookApp() {
  const { exit } = useApp();
  const [activeStory, setActiveStory] = useState<string | null>(null);

  const story = activeStory ? STORIES.find((s) => s.value === activeStory) : null;

  if (story) {
    return <>{story.render(() => setActiveStory(null))}</>;
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="double" borderColor="magenta" paddingX={1}>
        <Text bold color="magenta">
          Harness TUI Storybook
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Select a component story to preview. Press Escape or Ctrl+C to exit.</Text>
      </Box>
      <Box marginTop={1}>
        <AutocompleteSelect
          options={STORIES.map((s) => ({ label: s.label, value: s.value }))}
          label="Story"
          onChange={(value) => {
            setActiveStory(value);
          }}
          onCancel={() => exit()}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

render(<StorybookApp />, { exitOnCtrlC: true });
