import type {
  CanonicalMcpConfig,
  CanonicalPromptSection,
  CanonicalSkill,
  ProviderAdapter,
  ProviderOverride,
  RenderedArtifact,
} from "../types.js";
import { normalizeRelativePath, uniqSorted, withSingleTrailingNewline } from "../utils.js";
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
    async renderPromptSections(
      sections: CanonicalPromptSection[],
      overrideByEntity?: Map<string, ProviderOverride | undefined>,
    ): Promise<RenderedArtifact[]> {
      const enabled = sections.filter((section) => overrideByEntity?.get(section.id)?.enabled !== false);
      if (enabled.length === 0) {
        return [];
      }

      // Sections compose into one system-prompt artifact per resolved output path. A provider that
      // does not nest the prompt collapses every section into its single root instructions file;
      // sections carrying a `target` (on a nesting provider) group into that package's own file.
      const groups = groupByOutputPath(enabled, provider, "prompt", defaults.promptTarget, (id) =>
        overrideByEntity?.get(id),
      );

      return [...groups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([targetPath, groupSections]) => {
          const ordered = [...groupSections].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
          const content = withSingleTrailingNewline(ordered.map((section) => section.body.trim()).join("\n\n"));
          return {
            path: normalizeRelativePath(targetPath),
            content,
            ownerEntityId: uniqSorted(ordered.map((section) => section.id)).join(","),
            provider,
            format: "markdown" as const,
          };
        });
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
