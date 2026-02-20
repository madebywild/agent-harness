import path from "node:path";
import type { ManagedIndex, ManifestLock, ProviderId } from "@agent-harness/manifest-schema";
import type { HarnessPaths } from "./paths.js";
import { buildBuiltinAdapters } from "./providers.js";
import { collectManagedSourcePaths } from "./repository.js";
import type { Diagnostic, InternalPlanResult, LoadResult, Operation, RenderedArtifact } from "./types.js";
import { deepEqual, normalizeRelativePath, nowIso, readTextIfExists, sha256, uniqSorted } from "./utils.js";

interface DesiredArtifact {
  path: string;
  provider: ProviderId;
  content: string;
  ownerEntityIds: string[];
}

export async function buildPlan(
  paths: HarnessPaths,
  loaded: LoadResult,
  managedIndex: ManagedIndex,
  previousLock: ManifestLock | null,
): Promise<InternalPlanResult> {
  const diagnostics: Diagnostic[] = [...loaded.diagnostics];

  const skillFilesByEntity = new Map(loaded.skills.map((skill) => [skill.entity.id, skill.filesWithContent] as const));

  const adapters = buildBuiltinAdapters(skillFilesByEntity);
  const artifacts: RenderedArtifact[] = [];

  const enabledProviders = [...loaded.manifest.providers.enabled].sort((left, right) => left.localeCompare(right));

  for (const provider of enabledProviders) {
    const adapter = adapters[provider];

    if (loaded.prompt && adapter.renderPrompt) {
      try {
        artifacts.push(
          ...(await adapter.renderPrompt(loaded.prompt.canonical, loaded.prompt.overrideByProvider.get(provider))),
        );
      } catch (error) {
        diagnostics.push({
          code: "PROMPT_RENDER_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "Prompt render failed",
          entityId: loaded.prompt.entity.id,
          provider,
        });
      }
    }

    for (const skill of loaded.skills) {
      if (!adapter.renderSkill) {
        continue;
      }

      try {
        artifacts.push(...(await adapter.renderSkill(skill.canonical, skill.overrideByProvider.get(provider))));
      } catch (error) {
        diagnostics.push({
          code: "SKILL_RENDER_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "Skill render failed",
          entityId: skill.entity.id,
          provider,
        });
      }
    }

    if (adapter.renderMcp) {
      try {
        const overrideByEntity = new Map(
          loaded.mcps.map((mcp) => [mcp.entity.id, mcp.overrideByProvider.get(provider)] as const),
        );
        artifacts.push(
          ...(await adapter.renderMcp(
            loaded.mcps.map((mcp) => mcp.canonical),
            overrideByEntity,
          )),
        );
      } catch (error) {
        diagnostics.push({
          code: "MCP_RENDER_FAILED",
          severity: "error",
          message: error instanceof Error ? error.message : "MCP render failed",
          provider,
        });
      }
    }
  }

  const desiredByPath = new Map<string, DesiredArtifact>();

  for (const artifact of artifacts) {
    const normalizedPath = normalizeRelativePath(artifact.path);
    const ownerEntityIds = uniqSorted(
      artifact.ownerEntityId
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
    const existing = desiredByPath.get(normalizedPath);

    if (!existing) {
      desiredByPath.set(normalizedPath, {
        path: normalizedPath,
        provider: artifact.provider,
        content: artifact.content,
        ownerEntityIds,
      });
      continue;
    }

    if (existing.provider !== artifact.provider) {
      diagnostics.push({
        code: "OUTPUT_PATH_COLLISION",
        severity: "error",
        message: `Multiple providers generated the same output path '${normalizedPath}' (${existing.provider}, ${artifact.provider})`,
        path: normalizedPath,
        provider: artifact.provider,
      });
      continue;
    }

    if (existing.content !== artifact.content) {
      diagnostics.push({
        code: "OUTPUT_PATH_COLLISION",
        severity: "error",
        message: `Multiple artifacts generated different content for '${normalizedPath}'`,
        path: normalizedPath,
        provider: artifact.provider,
      });
      continue;
    }

    existing.ownerEntityIds = uniqSorted([...existing.ownerEntityIds, ...ownerEntityIds]);
  }

  const operations: Operation[] = [];
  const managedOutputSet = new Set(managedIndex.managedOutputPaths.map((entry) => normalizeRelativePath(entry)));

  for (const [artifactPath, artifact] of [...desiredByPath.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const absolutePath = path.join(paths.root, artifactPath);
    const existingText = await readTextIfExists(absolutePath);

    if (existingText === null) {
      operations.push({
        type: "create",
        path: artifactPath,
        provider: artifact.provider,
        reason: "generated artifact missing",
      });
      continue;
    }

    if (!managedOutputSet.has(artifactPath)) {
      diagnostics.push({
        code: "OUTPUT_COLLISION_UNMANAGED",
        severity: "error",
        message: `Target '${artifactPath}' already exists but is not managed by harness`,
        path: artifactPath,
        provider: artifact.provider,
        hint: "Move or remove the file before running apply (v1 does not import/adopt existing files).",
      });
      continue;
    }

    if (existingText === artifact.content) {
      operations.push({
        type: "noop",
        path: artifactPath,
        provider: artifact.provider,
        reason: "already up to date",
      });
    } else {
      operations.push({
        type: "update",
        path: artifactPath,
        provider: artifact.provider,
        reason: "content drift or source changed",
      });
    }
  }

  const desiredPaths = new Set(desiredByPath.keys());
  for (const stalePath of [...managedOutputSet].sort((left, right) => left.localeCompare(right))) {
    if (!desiredPaths.has(stalePath)) {
      operations.push({
        type: "delete",
        path: stalePath,
        reason: "stale managed artifact",
      });
    }
  }

  const manifestFingerprint = sha256(JSON.stringify(loaded.manifest));
  const entityRecords = [
    ...(loaded.prompt
      ? [
          {
            id: loaded.prompt.entity.id,
            type: loaded.prompt.entity.type,
            sourceSha256: loaded.prompt.sourceSha256,
            overrideSha256ByProvider: loaded.prompt.overrideShaByProvider,
          },
        ]
      : []),
    ...loaded.skills.map((skill) => ({
      id: skill.entity.id,
      type: skill.entity.type,
      sourceSha256: skill.sourceSha256,
      overrideSha256ByProvider: skill.overrideShaByProvider,
    })),
    ...loaded.mcps.map((mcp) => ({
      id: mcp.entity.id,
      type: mcp.entity.type,
      sourceSha256: mcp.sourceSha256,
      overrideSha256ByProvider: mcp.overrideShaByProvider,
    })),
  ].sort((left, right) => left.id.localeCompare(right.id));

  const outputRecords = [...desiredByPath.values()]
    .map((artifact) => ({
      path: artifact.path,
      provider: artifact.provider,
      contentSha256: sha256(artifact.content),
      ownerEntityIds: artifact.ownerEntityIds,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const semanticLockPayload = {
    version: 1 as const,
    manifestFingerprint,
    entities: entityRecords,
    outputs: outputRecords,
  };

  const previousSemanticPayload =
    previousLock === null
      ? null
      : {
          version: previousLock.version,
          manifestFingerprint: previousLock.manifestFingerprint,
          entities: previousLock.entities,
          outputs: previousLock.outputs,
        };

  const nextLock =
    previousLock !== null && deepEqual(previousSemanticPayload, semanticLockPayload)
      ? previousLock
      : {
          ...semanticLockPayload,
          generatedAt: nowIso(),
        };

  const nextManagedIndex: ManagedIndex = {
    version: 1,
    managedSourcePaths: collectManagedSourcePaths(loaded.manifest),
    managedOutputPaths: [...desiredByPath.keys()].sort((left, right) => left.localeCompare(right)),
  };

  return {
    operations: operations.sort((left, right) => left.path.localeCompare(right.path)),
    diagnostics,
    nextLock,
    artifactsByPath: new Map(
      [...desiredByPath.entries()].map(([artifactPath, artifact]) => [
        artifactPath,
        {
          content: artifact.content,
          provider: artifact.provider,
          ownerEntityIds: artifact.ownerEntityIds,
        },
      ]),
    ),
    nextManagedIndex,
  };
}
