import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "@storybook/test";
import { OutputStep } from "../src/components/output-step";

const meta = {
  title: "Components/OutputStep",
  component: OutputStep,
  args: {
    onDismiss: fn(),
  },
} satisfies Meta<typeof OutputStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    label: "Apply",
    lines: [
      "Created CLAUDE.md",
      "Created .github/copilot-instructions.md",
      "Updated .harness/lock.json",
      "3 artifacts written, 0 pruned",
    ],
    isError: false,
  },
};

export const ErrorOutput: Story = {
  args: {
    label: "Apply",
    lines: ["Error: Manifest validation failed", "  - Missing required field 'entities'", "  - Invalid provider id"],
    isError: true,
  },
};
