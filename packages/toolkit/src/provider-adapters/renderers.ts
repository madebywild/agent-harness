import { stableStringify } from "../utils.js";
import type { ProviderMcpRenderer } from "./types.js";

export function createJsonMcpRenderer(serverProperty: "mcpServers" | "servers"): ProviderMcpRenderer {
  return {
    format: "json",
    render(servers) {
      return stableStringify({ [serverProperty]: servers });
    }
  };
}
