import path from "node:path";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const PROVIDERS = ["codex", "claude", "copilot"] as const;

export const providerIdSchema = z.enum(PROVIDERS);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const entityTypes = ["prompt", "skill", "mcp_config"] as const;
export const entityTypeSchema = z.enum(entityTypes);
export type EntityType = z.infer<typeof entityTypeSchema>;

const relativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), "path must be relative")
  .refine((value) => !value.includes("\\"), "path must use POSIX separators")
  .refine((value) => !value.split("/").includes(".."), "path must not traverse parent")
  .refine((value) => path.posix.normalize(value) !== ".", "path must not resolve to current directory");

const providerRelativePathMapSchema = z
  .object({
    codex: relativePathSchema.optional(),
    claude: relativePathSchema.optional(),
    copilot: relativePathSchema.optional(),
  })
  .strict();

const providerOverrideSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean().optional(),
    targetPath: relativePathSchema.optional(),
    options: z.record(z.unknown()).optional(),
  })
  .strict();

const entityRefBaseSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9._-]+$/),
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

export const entityRefSchema = z.discriminatedUnion("type", [
  promptEntityRefSchema,
  skillEntityRefSchema,
  mcpEntityRefSchema,
]);

export const agentsManifestSchema = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        enabled: z.array(providerIdSchema).default([]),
      })
      .strict(),
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

export const manifestLockSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string().datetime(),
    manifestFingerprint: sha256Schema,
    entities: z.array(
      z
        .object({
          id: z.string().regex(/^[a-zA-Z0-9._-]+$/),
          type: entityTypeSchema,
          sourceSha256: sha256Schema,
          overrideSha256ByProvider: providerShaMapSchema,
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

export const managedIndexSchema = z
  .object({
    version: z.literal(1),
    managedSourcePaths: z.array(relativePathSchema),
    managedOutputPaths: z.array(relativePathSchema),
  })
  .strict();

export const schemas = {
  agentsManifestSchema,
  manifestLockSchema,
  managedIndexSchema,
  providerOverrideSchema,
  entityRefSchema,
  promptEntityRefSchema,
  skillEntityRefSchema,
  mcpEntityRefSchema,
};

export type ProviderOverride = z.infer<typeof providerOverrideSchema>;
export type EntityRef = z.infer<typeof entityRefSchema>;
export type PromptEntityRef = z.infer<typeof promptEntityRefSchema>;
export type SkillEntityRef = z.infer<typeof skillEntityRefSchema>;
export type McpEntityRef = z.infer<typeof mcpEntityRefSchema>;
export type AgentsManifest = z.infer<typeof agentsManifestSchema>;
export type ManifestLock = z.infer<typeof manifestLockSchema>;
export type ManagedIndex = z.infer<typeof managedIndexSchema>;

export function toJsonSchemas(): Record<string, object> {
  return {
    "agents-manifest.schema.json": zodToJsonSchema(agentsManifestSchema, {
      name: "AgentsManifest",
    }),
    "manifest-lock.schema.json": zodToJsonSchema(manifestLockSchema, {
      name: "ManifestLock",
    }),
    "managed-index.schema.json": zodToJsonSchema(managedIndexSchema, {
      name: "ManagedIndex",
    }),
    "provider-override.schema.json": zodToJsonSchema(providerOverrideSchema, {
      name: "ProviderOverride",
    }),
  };
}

export function parseManifest(input: unknown): AgentsManifest {
  return agentsManifestSchema.parse(input);
}

export function parseManifestLock(input: unknown): ManifestLock {
  return manifestLockSchema.parse(input);
}

export function parseManagedIndex(input: unknown): ManagedIndex {
  return managedIndexSchema.parse(input);
}

export function parseProviderOverride(input: unknown): ProviderOverride {
  return providerOverrideSchema.parse(input);
}
