import path from "node:path";
import type { ProviderId, ProviderOverride } from "../types.js";
import { normalizeRelativePath } from "../utils.js";
import { type ArtifactType, isNestable } from "./constants.js";

// Composes the final output path for a generated artifact.
// `target` (a package directory) is applied only when the provider nests this artifact type;
// within the chosen directory, a per-provider `targetPath` override wins over the default.
// With no `target` and no override this reduces to `defaultRelative`, so existing (non-monorepo)
// workspaces render byte-identically.
export function resolveOutputPath(options: {
  nestable: boolean;
  target?: string;
  targetPath?: string;
  defaultRelative: string;
}): string {
  const { nestable, target, targetPath, defaultRelative } = options;
  const base = targetPath ?? defaultRelative;
  const prefix = nestable && target ? target : "";
  return normalizeRelativePath(path.posix.join(prefix, base));
}

// Buckets aggregated entities (mcp/hooks) by their resolved output path, so each distinct
// target directory produces its own merged file. For a provider that does not nest the given
// artifact, every entity resolves to the root path and collapses into a single bucket.
export function groupByOutputPath<T extends { id: string; target?: string }>(
  items: readonly T[],
  provider: ProviderId,
  artifact: ArtifactType,
  defaultRelative: string,
  getOverride?: (id: string) => ProviderOverride | undefined,
): Map<string, T[]> {
  const nestable = isNestable(provider, artifact);
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const outputPath = resolveOutputPath({
      nestable,
      target: item.target,
      targetPath: getOverride?.(item.id)?.targetPath,
      defaultRelative,
    });
    const bucket = groups.get(outputPath) ?? [];
    bucket.push(item);
    groups.set(outputPath, bucket);
  }
  return groups;
}
