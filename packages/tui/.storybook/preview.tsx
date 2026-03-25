import React from "react";
import type { Preview } from "storybook";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      options: {
        terminal: { name: "terminal", value: "#1e1e1e" },
        light: { name: "light", value: "#ffffff" },
      },
    },
  },

  decorators: [
    (Story) => (
      <div
        style={{
          fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
          fontSize: "14px",
          lineHeight: "1.4",
          color: "#d4d4d4",
          padding: "16px",
        }}
      >
        <Story />
      </div>
    ),
  ],

  initialGlobals: {
    backgrounds: {
      value: "terminal",
    },
  },
};

export default preview;
