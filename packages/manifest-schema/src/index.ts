import path from "node:path";
import { toJSONSchema, z } from "zod";
import {
  assertLatestVersion,
  type DocumentKind,
  detectDocumentVersion,
  isLatestVersion,
  LATEST_SCHEMA_MAJOR,
  LATEST_VERSION_BY_KIND,
  type VersionDetectionResult,
  VersionError,
} from "./versioning.js";

export const PROVIDERS = ["codex", "claude", "copilot"] as const;

export const providerIdSchema = z.enum(PROVIDERS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const entityTypes = ["prompt", "skill", "mcp_config", "subagent", "hook"] as const;
export const entityTypeSchema = z.enum(entityTypes);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const DEFAULT_REGISTRY_ID = "local" as const;

export const registryIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9._-]+$/);
export type RegistryId = z.infer<typeof registryIdSchema>;

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), "path must be relative")
  .refine((value) => !value.includes("\\"), "path must use POSIX separators")
  .refine((value) => !/^[a-zA-Z]:/u.test(value), "path must not be Windows drive-prefixed")
  .refine((value) => !value.split("/").includes(".."), "path must not traverse parent")
  .refine((value) => path.posix.normalize(value) !== ".", "path must not resolve to current directory");

export const localRegistryDefinitionSchema = z
  .object({
    type: z.literal("local"),
  })
  .strict();

export const gitRegistryDefinitionSchema = z
  .object({
    type: z.literal("git"),
    url: z.string().min(1),
    ref: z.string().min(1),
    rootPath: relativePathSchema.optional(),
    tokenEnvVar: z.string().min(1).optional(),
  })
  .strict();

export const registryDefinitionSchema = z.discriminatedUnion("type", [
  localRegistryDefinitionSchema,
  gitRegistryDefinitionSchema,
]);
export type RegistryDefinition = z.infer<typeof registryDefinitionSchema>;

const registriesSchema = z
  .object({
    default: registryIdSchema.default(DEFAULT_REGISTRY_ID),
    entries: z.record(registryIdSchema, registryDefinitionSchema).default({ [DEFAULT_REGISTRY_ID]: { type: "local" } }),
  })
  .strict();

const providerRelativePathMapSchema = z
  .object({
    codex: relativePathSchema.optional(),
    claude: relativePathSchema.optional(),
    copilot: relativePathSchema.optional(),
  })
  .strict();

export const providerOverrideV1Schema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean().optional(),
    targetPath: relativePathSchema.optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const entityRefBaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/),
    type: entityTypeSchema,
    registry: registryIdSchema,
    sourcePath: relativePathSchema,
    overrides: providerRelativePathMapSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const promptEntityRefSchema = entityRefBaseSchema.extend({
  type: z.literal("prompt"),
});

export const skillEntityRefSchema = entityRefBaseSchema.extend({
  type: z.literal("skill"),
});

export const mcpEntityRefSchema = entityRefBaseSchema.extend({
  type: z.literal("mcp_config"),
});

export const subagentEntityRefSchema = entityRefBaseSchema.extend({
  type: z.literal("subagent"),
});

export const hookEntityRefSchema = entityRefBaseSchema.extend({
  type: z.literal("hook"),
});

export const entityRefSchema = z.discriminatedUnion("type", [
  promptEntityRefSchema,
  skillEntityRefSchema,
  mcpEntityRefSchema,
  subagentEntityRefSchema,
  hookEntityRefSchema,
]);

export const agentsManifestV1Schema = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        enabled: z.array(providerIdSchema).default([]),
      })
      .strict(),
    registries: registriesSchema,
    entities: z.array(entityRefSchema).default([]),
  })
  .strict();

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const providerShaMapSchema = z
  .object({
    codex: sha256Schema.optional(),
    claude: sha256Schema.optional(),
    copilot: sha256Schema.optional(),
  })
  .strict();

const registryRevisionSchema = z
  .object({
    kind: z.literal("git"),
    ref: z.string().min(1),
    commit: z.string().min(1),
  })
  .strict();
export type RegistryRevision = z.infer<typeof registryRevisionSchema>;

export const manifestLockV1Schema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    manifestFingerprint: sha256Schema,
    entities: z.array(
      z
        .object({
          id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
          type: entityTypeSchema,
          registry: registryIdSchema,
          sourceSha256: sha256Schema,
          overrideSha256ByProvider: providerShaMapSchema,
          importedSourceSha256: sha256Schema.optional(),
          registryRevision: registryRevisionSchema.optional(),
        })
        .strict(),
    ),
    outputs: z.array(
      z
        .object({
          path: relativePathSchema,
          provider: providerIdSchema,
          contentSha256: sha256Schema,
          ownerEntityIds: z.array(z.string().regex(/^[a-zA-Z0-9._-]+$/)),
        })
        .strict(),
    ),
  })
  .strict();

export const managedIndexV1Schema = z
  .object({
    version: z.literal(1),
    managedSourcePaths: z.array(relativePathSchema),
    managedOutputPaths: z.array(relativePathSchema),
  })
  .strict();

export const registryManifestSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1),
    description: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const agentsManifestSchema = agentsManifestV1Schema;
export const manifestLockSchema = manifestLockV1Schema;
export const managedIndexSchema = managedIndexV1Schema;
export const providerOverrideSchema = providerOverrideV1Schema;

export const schemas = {
  agentsManifestV1Schema,
  manifestLockV1Schema,
  managedIndexV1Schema,
  providerOverrideV1Schema,
  registryManifestSchema,
  localRegistryDefinitionSchema,
  gitRegistryDefinitionSchema,
  registryDefinitionSchema,
  agentsManifestSchema,
  manifestLockSchema,
  managedIndexSchema,
  providerOverrideSchema,
  entityRefSchema,
  promptEntityRefSchema,
  skillEntityRefSchema,
  mcpEntityRefSchema,
  subagentEntityRefSchema,
  hookEntityRefSchema,
};

export type ProviderOverride = z.infer<typeof providerOverrideSchema>;
export type EntityRef = z.infer<typeof entityRefSchema>;
export type PromptEntityRef = z.infer<typeof promptEntityRefSchema>;
export type SkillEntityRef = z.infer<typeof skillEntityRefSchema>;
export type McpEntityRef = z.infer<typeof mcpEntityRefSchema>;
export type SubagentEntityRef = z.infer<typeof subagentEntityRefSchema>;
export type HookEntityRef = z.infer<typeof hookEntityRefSchema>;
export type AgentsManifest = z.infer<typeof agentsManifestV1Schema>;
export type ManifestLock = z.infer<typeof manifestLockV1Schema>;
export type ManagedIndex = z.infer<typeof managedIndexV1Schema>;
export type RegistryManifest = z.infer<typeof registryManifestSchema>;

export function toJsonSchemas(): Record<string, object> {
  return {
    "agents-manifest.schema.json": toJSONSchema(agentsManifestSchema),
    "manifest-lock.schema.json": toJSONSchema(manifestLockSchema),
    "managed-index.schema.json": toJSONSchema(managedIndexSchema),
    "provider-override.schema.json": toJSONSchema(providerOverrideSchema),
    "registry-manifest.schema.json": toJSONSchema(registryManifestSchema),
  };
}

export function parseManifest(input: unknown): AgentsManifest {
  return parseVersionedDocument("manifest", input, agentsManifestV1Schema);
}

export function parseManifestLock(input: unknown): ManifestLock {
  return parseVersionedDocument("lock", input, manifestLockV1Schema);
}

export function parseManagedIndex(input: unknown): ManagedIndex {
  return parseVersionedDocument("managed-index", input, managedIndexV1Schema);
}

export function parseProviderOverride(input: unknown): ProviderOverride {
  return parseVersionedDocument("provider-override", input, providerOverrideV1Schema);
}

export function parseRegistryManifest(input: unknown): RegistryManifest {
  return registryManifestSchema.parse(input);
}

function parseVersionedDocument<TSchema extends z.ZodTypeAny>(
  kind: DocumentKind,
  input: unknown,
  schema: TSchema,
): z.infer<TSchema> {
  assertLatestVersion(kind, input);
  return schema.parse(input);
}

export type { DocumentKind, VersionDetectionResult };
export { detectDocumentVersion, isLatestVersion, LATEST_SCHEMA_MAJOR, LATEST_VERSION_BY_KIND, VersionError };
