import type { Meta, StoryObj } from "storybook";
import { fn } from "storybook/test";
import { AutocompleteSelect } from "../src/components/autocomplete-select";

const COMMAND_OPTIONS = [
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

const meta = {
  title: "Components/AutocompleteSelect",
  component: AutocompleteSelect,
  args: {
    options: COMMAND_OPTIONS,
    onChange: fn(),
    onCancel: fn(),
    label: "Search",
    visibleOptionCount: 8,
  },
} satisfies Meta<typeof AutocompleteSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FewOptions: Story = {
  args: {
    options: [
      { label: "claude", value: "claude" },
      { label: "codex", value: "codex" },
      { label: "copilot", value: "copilot" },
    ],
    label: "Provider",
  },
};

export const CustomVisibleCount: Story = {
  args: {
    visibleOptionCount: 4,
  },
};
