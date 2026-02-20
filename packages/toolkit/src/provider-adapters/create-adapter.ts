import type {
  CanonicalMcpConfig,
  CanonicalPrompt,
  CanonicalSkill,
  ProviderAdapter,
  ProviderOverride,
  RenderedArtifact,
} from "../types.js";
import { normalizeRelativePath, withSingleTrailingNewline } from "../utils.js";
import { mergeMcpServers, resolveMcpTargetPath } from "./mcp.js";
import type { ProviderDefinition, SkillFileIndex } from "./types.js";

function inferSkillFormat(filePath: string): RenderedArtifact["format"] {
  return filePath.endsWith(".json") ? "json" : "markdown";
}

export function createProviderAdapter(
  definition: ProviderDefinition,
  skillFilesByEntityId: SkillFileIndex,
): ProviderAdapter {
  const { id: provider, defaults, mcpRenderer } = definition;

  return {
    id: provider,
    async renderPrompt(input: CanonicalPrompt, override?: ProviderOverride): Promise<RenderedArtifact[]> {
      if (override?.enabled === false) {
        return [];
      }

      const artifactPath = normalizeRelativePath(override?.targetPath ?? defaults.promptTarget);
      const promptContent = withSingleTrailingNewline(input.body);

      return [
        {
          path: artifactPath,
          content: promptContent,
          ownerEntityId: input.id,
          provider,
          format: "markdown",
        },
      ];
    },

    async renderSkill(input: CanonicalSkill, override?: ProviderOverride): Promise<RenderedArtifact[]> {
      if (override?.enabled === false) {
        return [];
      }

      const files = skillFilesByEntityId.get(input.id) ?? [];
      const defaultRoot = `${defaults.skillRoot}/${input.id}`;
      const targetRoot = normalizeRelativePath(override?.targetPath ?? defaultRoot);

      return files.map((file) => ({
        path: normalizeRelativePath(`${targetRoot}/${file.path}`),
        content: file.content,
        ownerEntityId: input.id,
        provider,
        format: inferSkillFormat(file.path),
      }));
    },

    async renderMcp(
      input: CanonicalMcpConfig[],
      overrideByEntity?: Map<string, ProviderOverride | undefined>,
    ): Promise<RenderedArtifact[]> {
      const enabledSources = input.filter((entry) => {
        const override = overrideByEntity?.get(entry.id);
        return override?.enabled !== false;
      });

      if (enabledSources.length === 0) {
        return [];
      }

      const targetPath = resolveMcpTargetPath(provider, defaults.mcpTarget, enabledSources, overrideByEntity);
      const mergedServers = mergeMcpServers(enabledSources);
      const content = mcpRenderer.render(mergedServers);

      return [
        {
          path: targetPath,
          content,
          ownerEntityId: enabledSources
            .map((entry) => entry.id)
            .sort()
            .join(","),
          provider,
          format: mcpRenderer.format,
        },
      ];
    },
  };
}
