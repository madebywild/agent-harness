import * as TOML from "@iarna/toml";
import type { ProviderAdapter } from "../types.js";
import { withSingleTrailingNewline } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const CODEX_DEFINITION: ProviderDefinition = {
  id: "codex",
  defaults: PROVIDER_DEFAULTS.codex,
  mcpRenderer: {
    format: "toml",
    render(servers) {
      return withSingleTrailingNewline(
        TOML.stringify({
          mcp_servers: servers as unknown as TOML.AnyJson,
        }),
      );
    },
  },
};

export function buildCodexAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  return createProviderAdapter(CODEX_DEFINITION, skillFilesByEntityId);
}
