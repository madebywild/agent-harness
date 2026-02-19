import type {
  LoadedSkillFile,
  ProviderAdapter,
  ProviderId,
  RenderedArtifact
} from "../types.js";

export type SkillFileIndex = ReadonlyMap<string, ReadonlyArray<LoadedSkillFile>>;

export interface ProviderDefaults {
  readonly promptTarget: string;
  readonly skillRoot: string;
  readonly mcpTarget: string;
}

export interface ProviderMcpRenderer {
  readonly format: RenderedArtifact["format"];
  render(servers: Record<string, unknown>): string;
}

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly defaults: ProviderDefaults;
  readonly mcpRenderer: ProviderMcpRenderer;
}

export type ProviderBuilder = (skillFilesByEntityId: SkillFileIndex) => ProviderAdapter;
