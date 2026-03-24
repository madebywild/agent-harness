import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-essentials"],
  viteFinal(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    // Redirect ink imports to browser-compatible shims
    Object.assign(config.resolve.alias, {
      ink: resolve(__dirname, "../src/shims/ink.tsx"),
      "@inkjs/ui": resolve(__dirname, "../src/shims/inkjs-ui.tsx"),
    });
    return config;
  },
};

export default config;
