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
import { Box, render, Text, useApp } from "ink";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Story definitions
// ---------------------------------------------------------------------------

interface Story {
  label: string;
  value: string;
  render: (onBack: () => void) => React.ReactNode;
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

const STORIES: Story[] = [
  {
    label: "AutocompleteSelect (default)",
    value: "autocomplete-default",
    render: (onBack) => (
      <StoryFrame title="AutocompleteSelect">
        <AutocompleteSelect
          options={SAMPLE_OPTIONS}
          onChange={(v) => console.log(`Selected: ${v}`)}
          onCancel={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "AutocompleteSelect (few options)",
    value: "autocomplete-few",
    render: (onBack) => (
      <StoryFrame title="AutocompleteSelect (few options)">
        <AutocompleteSelect
          options={[
            { label: "claude", value: "claude" },
            { label: "codex", value: "codex" },
            { label: "copilot", value: "copilot" },
          ]}
          label="Provider"
          onChange={(v) => console.log(`Selected: ${v}`)}
          onCancel={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "AutocompleteSelect (custom visible count)",
    value: "autocomplete-visible",
    render: (onBack) => (
      <StoryFrame title="AutocompleteSelect (visibleOptionCount=4)">
        <AutocompleteSelect
          options={SAMPLE_OPTIONS}
          visibleOptionCount={4}
          onChange={(v) => console.log(`Selected: ${v}`)}
          onCancel={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "ToggleConfirm (default=false)",
    value: "toggle-default-no",
    render: (onBack) => (
      <StoryFrame title="ToggleConfirm (default No)">
        <ToggleConfirm
          message="Overwrite existing workspace?"
          defaultValue={false}
          onSubmit={(v) => console.log(`Submitted: ${v}`)}
          onEscape={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "ToggleConfirm (default=true)",
    value: "toggle-default-yes",
    render: (onBack) => (
      <StoryFrame title="ToggleConfirm (default Yes)">
        <ToggleConfirm
          message="Add a system prompt entity?"
          defaultValue
          onSubmit={(v) => console.log(`Submitted: ${v}`)}
          onEscape={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "TextPrompt (required)",
    value: "text-required",
    render: (onBack) => (
      <StoryFrame title="TextPrompt (required)">
        <TextPrompt message="Skill id" required onSubmit={(v) => console.log(`Submitted: ${v}`)} onCancel={onBack} />
      </StoryFrame>
    ),
  },
  {
    label: "TextPrompt (optional)",
    value: "text-optional",
    render: (onBack) => (
      <StoryFrame title="TextPrompt (optional)">
        <TextPrompt
          message="Registry id"
          required={false}
          onSubmit={(v) => console.log(`Submitted: ${v}`)}
          onCancel={onBack}
        />
      </StoryFrame>
    ),
  },
  {
    label: "OutputStep (success)",
    value: "output-success",
    render: (onBack) => (
      <StoryFrame title="OutputStep (success)">
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
      <StoryFrame title="OutputStep (error)">
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
    render: () => (
      <StoryFrame title="Spinner">
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
      <StoryFrame title="OnboardingComplete">
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
    render: () => {
      const logo = `   __ __
  / // /__ ________  ___ ___ ___
 / _  / _ \`/ __/ _ \\/ -_|_-<(_-<
/_//_/\\_,_/_/ /_//_/\\__/___/___/`;
      const tagline = "Configure your AI coding agents from a single source of truth.";
      return (
        <StoryFrame title="Welcome Screen">
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

function StoryFrame({ title, children }: { title: string; children: React.ReactNode }) {
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
