import type {
  CanonicalMcpConfig,
  CanonicalPrompt,
  CanonicalSkill,
  ProviderAdapter,
  ProviderOverride,
  RenderedArtifact,
} from "../types.js";
import { normalizeRelativePath, withSingleTrailingNewline } from "../utils.js";
import { isNestable } from "./constants.js";
import { mergeMcpServers } from "./mcp.js";
import { groupByOutputPath, resolveOutputPath } from "./paths.js";
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

      // A non-nesting provider (e.g. copilot) places the prompt at its single root
      // instructions file. Which prompt "wins" that single slot is decided by the planner
      // (it sees all prompts); this adapter only renders the prompts it is handed.
      const artifactPath = resolveOutputPath({
        nestable: isNestable(provider, "prompt"),
        target: input.target,
        targetPath: override?.targetPath,
        defaultRelative: defaults.promptTarget,
      });
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
      const targetRoot = resolveOutputPath({
        nestable: isNestable(provider, "skill"),
        target: input.target,
        targetPath: override?.targetPath,
        defaultRelative: `${defaults.skillRoot}/${input.id}`,
      });

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

      const groups = groupByOutputPath(enabledSources, provider, "mcp", defaults.mcpTarget, (id) =>
        overrideByEntity?.get(id),
      );

      return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([targetPath, sources]) => ({
          path: targetPath,
          content: mcpRenderer.render(mergeMcpServers(sources)),
          ownerEntityId: sources
            .map((entry) => entry.id)
            .sort()
            .join(","),
          provider,
          format: mcpRenderer.format,
        }));
    },
  };
}
