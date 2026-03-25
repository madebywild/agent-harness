import type {
  ApplyResult,
  CliEntityType,
  Diagnostic,
  DoctorResult,
  MigrationResult,
  PlanResult,
  PresetApplyResult,
  PresetSummary,
  ProviderId,
  RegistryListEntry,
  RegistryPullResult,
  RegistryValidationResult,
  RemoveResult,
  ResolvedPreset,
  SkillDiscoveryResult,
  SkillImportResult,
  ValidationResult,
} from "../types.js";
import type { UHaulSummary } from "../u-haul.js";

export type CommandId =
  | "init"
  | "provider.enable"
  | "provider.disable"
  | "registry.list"
  | "registry.validate"
  | "registry.add"
  | "registry.remove"
  | "registry.default.show"
  | "registry.default.set"
  | "registry.pull"
  | "preset.list"
  | "preset.describe"
  | "preset.apply"
  | "skill.find"
  | "skill.import"
  | "add.prompt"
  | "add.skill"
  | "add.mcp"
  | "add.subagent"
  | "add.hook"
  | "add.settings"
  | "add.command"
  | "remove"
  | "validate"
  | "doctor"
  | "migrate"
  | "plan"
  | "apply"
  | "watch"
  | "default.plan";

export interface CommandInput {
  command: CommandId;
  args?: Record<string, string | undefined>;
  options?: Record<string, boolean | number | string | undefined>;
}

export interface CliExecutionContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  now?: () => number;
  isTty?: boolean;
  isCi?: boolean;
}

export interface CliResolvedContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => number;
  isTty: boolean;
  isCi: boolean;
}

interface CommandOutputBase<TFamily extends string, TData> {
  family: TFamily;
  command: CommandId;
  ok: boolean;
  data: TData;
  diagnostics: Diagnostic[];
  exitCode: number;
  runtime?: {
    blockUntilExit: Promise<unknown>;
  };
}

export interface InitOutput
  extends CommandOutputBase<
    "init",
    {
      force: boolean;
      preset?: string;
      delegateProvider?: ProviderId;
      uHaul?: UHaulSummary;
      message: string;
    }
  > {}

export type PresetOutputData =
  | {
      operation: "list";
      presets: PresetSummary[];
    }
  | {
      operation: "describe";
      preset: ResolvedPreset;
    }
  | {
      operation: "apply";
      result: PresetApplyResult;
    };

export interface PresetOutput extends CommandOutputBase<"preset", PresetOutputData> {}

export interface ProviderOutput
  extends CommandOutputBase<
    "provider",
    {
      action: "enable" | "disable";
      provider: ProviderId;
      message: string;
    }
  > {}

export type RegistryOutputData =
  | {
      operation: "list";
      registries: RegistryListEntry[];
    }
  | {
      operation: "validate";
      result: RegistryValidationResult;
    }
  | {
      operation: "add";
      name: string;
      message: string;
    }
  | {
      operation: "remove";
      name: string;
      message: string;
    }
  | {
      operation: "default.show";
      registry: string;
    }
  | {
      operation: "default.set";
      name: string;
      message: string;
    }
  | {
      operation: "pull";
      result: RegistryPullResult;
    };

export interface RegistryOutput extends CommandOutputBase<"registry", RegistryOutputData> {}

export type SkillsOutputData =
  | {
      operation: "find";
      query: string;
      results: SkillDiscoveryResult[];
      rawText: string;
    }
  | {
      operation: "import";
      result: SkillImportResult;
    };

export interface SkillsOutput extends CommandOutputBase<"skills", SkillsOutputData> {}

export interface EntityMutationOutput
  extends CommandOutputBase<
    "entity-mutation",
    {
      operation: "add" | "remove";
      entityType: CliEntityType;
      id: string;
      removed?: RemoveResult;
      message: string;
    }
  > {}

export interface ValidationOutput
  extends CommandOutputBase<
    "validation",
    {
      result: ValidationResult;
    }
  > {}

export interface PlanOutput
  extends CommandOutputBase<
    "plan",
    {
      result: PlanResult;
      defaultInvocation: boolean;
    }
  > {}

export interface ApplyOutput
  extends CommandOutputBase<
    "apply",
    {
      result: ApplyResult;
    }
  > {}

export interface DoctorOutput
  extends CommandOutputBase<
    "doctor",
    {
      result: DoctorResult;
    }
  > {}

export interface MigrateOutput
  extends CommandOutputBase<
    "migrate",
    {
      result: MigrationResult;
    }
  > {}

export interface WatchOutput
  extends CommandOutputBase<
    "watch",
    {
      debounceMs: number;
      started: true;
    }
  > {}

export type CommandOutput =
  | InitOutput
  | ProviderOutput
  | PresetOutput
  | RegistryOutput
  | SkillsOutput
  | EntityMutationOutput
  | ValidationOutput
  | PlanOutput
  | ApplyOutput
  | DoctorOutput
  | MigrateOutput
  | WatchOutput;

export interface CliEnvelope<TData> {
  schemaVersion: "1";
  ok: boolean;
  command: CommandId;
  data: TData;
  diagnostics: Diagnostic[];
  meta: {
    cwd: string;
    durationMs: number;
  };
}
