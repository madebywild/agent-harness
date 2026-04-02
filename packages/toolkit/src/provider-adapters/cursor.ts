import type { CanonicalSubagent, ProviderAdapter } from "../types.js";
import { normalizeRelativePath, uniqSorted } from "../utils.js";
import { PROVIDER_DEFAULTS } from "./constants.js";
import { createProviderAdapter } from "./create-adapter.js";
import { renderCursorHookConfig, resolveHookTargetPath } from "./hooks.js";
import { createJsonMcpRenderer } from "./renderers.js";
import { parseCursorSubagentOptions, renderSubagentMarkdown } from "./subagents.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

const CURSOR_DEFINITION: ProviderDefinition = {
  id: "cursor",
  defaults: PROVIDER_DEFAULTS.cursor,
  mcpRenderer: createJsonMcpRenderer("mcpServers"),
};

export function buildCursorAdapter(skillFilesByEntityId: SkillFileIndex): ProviderAdapter {
  const base = createProviderAdapter(CURSOR_DEFINITION, skillFilesByEntityId);

  return {
    id: "cursor",
    renderSkill: base.renderSkill,
    renderMcp: base.renderMcp,
    async renderHooks(input, overrideByEntity) {
      const enabledHooks = input.filter((entry) => overrideByEntity?.get(entry.id)?.enabled !== false);
      if (enabledHooks.length === 0) {
        return [];
      }

      const targetPath = resolveHookTargetPath(
        "cursor",
        PROVIDER_DEFAULTS.cursor.hookTarget,
        enabledHooks.map((entry) => entry.id),
        overrideByEntity,
      );

      return [
        {
          path: targetPath,
          content: renderCursorHookConfig(enabledHooks),
          ownerEntityId: uniqSorted(enabledHooks.map((entry) => entry.id)).join(","),
          provider: "cursor",
          format: "json",
        },
      ];
    },
    async renderSubagent(input, override) {
      if (override?.enabled === false) {
        return [];
      }

      const targetPath = normalizeRelativePath(override?.targetPath ?? `.cursor/agents/${input.id}.md`);
      const overrideOptions = parseCursorSubagentOptions(override);
      const metadataOptions = parseCursorSubagentMetadata(input);

      return [
        {
          path: targetPath,
          content: renderSubagentMarkdown(input, {
            model: overrideOptions.model ?? metadataOptions.model,
            readonly: overrideOptions.readonly ?? metadataOptions.readonly,
            is_background: overrideOptions.isBackground ?? metadataOptions.isBackground,
          }),
          ownerEntityId: input.id,
          provider: "cursor",
          format: "markdown",
        },
      ];
    },
  };
}

interface CursorSubagentMetadata {
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
}

function parseCursorSubagentMetadata(input: CanonicalSubagent): CursorSubagentMetadata {
  const metadata = input.metadata;
  return {
    model: asString(metadata.model),
    readonly: asBoolean(metadata.readonly),
    isBackground: asBoolean(metadata.is_background),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
