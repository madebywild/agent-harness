import type { Preview } from "@storybook/react-vite";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "terminal",
      values: [
        { name: "terminal", value: "#1e1e1e" },
        { name: "light", value: "#ffffff" },
      ],
    },
  },
  decorators: [
    (Story) => ({
      type: "div",
      props: {
        style: {
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
          fontSize: "14px",
          lineHeight: "1.4",
          color: "#d4d4d4",
          padding: "16px",
        },
        children: { type: Story, props: {} },
      },
    }),
  ],
};

export default preview;
