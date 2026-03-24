import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "@storybook/test";
import { TextPrompt } from "../src/components/text-prompt";

const meta = {
  title: "Components/TextPrompt",
  component: TextPrompt,
  args: {
    onSubmit: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof TextPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Required: Story = {
  args: {
    message: "Skill id",
    required: true,
  },
};

export const Optional: Story = {
  args: {
    message: "Registry id",
    required: false,
  },
};
