import type { Meta, StoryObj } from "storybook";
import { fn } from "storybook/test";
import { ToggleConfirm } from "../src/components/toggle-confirm";

const meta = {
  title: "Components/ToggleConfirm",
  component: ToggleConfirm,
  args: {
    message: "Overwrite existing workspace?",
    onSubmit: fn(),
    onEscape: fn(),
  },
} satisfies Meta<typeof ToggleConfirm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultNo: Story = {
  args: {
    defaultValue: false,
  },
};

export const DefaultYes: Story = {
  args: {
    message: "Add a system prompt entity?",
    defaultValue: true,
  },
};
