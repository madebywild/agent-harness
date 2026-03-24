import type { Meta, StoryObj } from "storybook";
import { fn } from "storybook/test";
import { OnboardingComplete } from "../src/components/onboarding-complete";

const meta = {
  title: "Components/OnboardingComplete",
  component: OnboardingComplete,
  args: {
    onDismiss: fn(),
  },
} satisfies Meta<typeof OnboardingComplete>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FullSummary: Story = {
  args: {
    summary: [
      "Initialized .harness/ workspace",
      "Applied preset: starter",
      "Enabled provider(s): claude, copilot",
      "Added system prompt entity",
      "Applied workspace (generated provider artifacts)",
    ],
  },
};

export const EmptySummary: Story = {
  args: {
    summary: [],
  },
};
