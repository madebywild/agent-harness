// This file has been automatically migrated to valid ESM format by Storybook.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: getAbsolutePath("@storybook/react-vite"),
  addons: [getAbsolutePath("@storybook/addon-docs")],
  viteFinal(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    // Redirect ink imports to browser-compatible shims
    Object.assign(config.resolve.alias, {
      ink: resolve(__dirname, "../src/shims/ink.tsx"),
      "@inkjs/ui": resolve(__dirname, "../src/shims/inkjs-ui.tsx"),
    });
    // Ensure a single React instance across shims and Storybook renderer
    config.resolve.dedupe = [...(config.resolve.dedupe ?? []), "react", "react-dom"];
    return config;
  },
};

export default config;

function getAbsolutePath(value: string): any {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}
