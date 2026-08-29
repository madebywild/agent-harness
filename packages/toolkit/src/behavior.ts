import {
  type BehaviorConfig,
  type BehaviorMap,
  parseBehaviorConfig,
  parseBehaviorMap,
} from "@madebywild/agent-harness-manifest";
import {
  pushUnresolvedEnvDiagnostics,
  type SubstitutionResult,
  substituteEnvVars,
  substitutePlaceholders,
} from "./env.js";
import type { HarnessPaths } from "./paths.js";
import type { Diagnostic } from "./types.js";
import { readTextIfExists } from "./utils.js";

export const BEHAVIOR_MAP_RELATIVE_PATH = ".harness/behavior.map.yaml";
export const BEHAVIOR_CONFIG_RELATIVE_PATH = ".harness/behavior.yaml";

export const BEHAVIOR_PLACEHOLDER_RE = /\{\{behavior\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export interface BehaviorChoice {
  value: string;
  source: "config" | "default";
  allowed: string[];
  instruction: string;
}

export interface LoadedBehavior {
  /** key -> resolved instruction text (config choice or map default, dereferenced through map values). */
  values: Map<string, string>;
  /** key -> resolution details, for `harness behavior show`. */
  choices: Map<string, BehaviorChoice>;
  diagnostics: Diagnostic[];
}

function emptyBehavior(diagnostics: Diagnostic[] = []): LoadedBehavior {
  return { values: new Map(), choices: new Map(), diagnostics };
}

/**
 * Load the behavior map (`.harness/behavior.map.yaml`, committed ruleset) and the
 * behavior config (`.harness/behavior.yaml`, per-developer choices) and resolve every
 * map key to its instruction text: the config value when set, else the map default.
 * Missing files are a no-op; a config without a map is a misconfiguration (error).
 */
export async function loadBehavior(paths: HarnessPaths): Promise<LoadedBehavior> {
  const diagnostics: Diagnostic[] = [];
  const [mapText, configText] = await Promise.all([
    readTextIfExists(paths.behaviorMapFile),
    readTextIfExists(paths.behaviorConfigFile),
  ]);

  if (mapText === null && configText === null) {
    return emptyBehavior();
  }

  if (mapText === null) {
    diagnostics.push({
      code: "BEHAVIOR_MAP_MISSING",
      severity: "error",
      message: `'${BEHAVIOR_CONFIG_RELATIVE_PATH}' is present but '${BEHAVIOR_MAP_RELATIVE_PATH}' is missing`,
      hint: `Create '${BEHAVIOR_MAP_RELATIVE_PATH}' defining the allowed keys and values, or remove '${BEHAVIOR_CONFIG_RELATIVE_PATH}'.`,
      path: BEHAVIOR_CONFIG_RELATIVE_PATH,
    });
    return emptyBehavior(diagnostics);
  }

  const YAML = await import("yaml");

  let map: BehaviorMap;
  try {
    map = parseBehaviorMap(YAML.parse(mapText));
  } catch (error) {
    diagnostics.push({
      code: "BEHAVIOR_MAP_INVALID",
      severity: "error",
      message: `Invalid behavior map '${BEHAVIOR_MAP_RELATIVE_PATH}': ${error instanceof Error ? error.message : String(error)}`,
      path: BEHAVIOR_MAP_RELATIVE_PATH,
    });
    return emptyBehavior(diagnostics);
  }

  let config: BehaviorConfig = {};
  if (configText !== null) {
    try {
      config = parseBehaviorConfig(YAML.parse(configText) ?? {});
    } catch (error) {
      diagnostics.push({
        code: "BEHAVIOR_CONFIG_INVALID",
        severity: "error",
        message: `Invalid behavior config '${BEHAVIOR_CONFIG_RELATIVE_PATH}': ${error instanceof Error ? error.message : String(error)}`,
        path: BEHAVIOR_CONFIG_RELATIVE_PATH,
      });
      return emptyBehavior(diagnostics);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    const entry = map.keys[key];
    if (!entry) {
      diagnostics.push({
        code: "BEHAVIOR_KEY_UNKNOWN",
        severity: "error",
        message: `Behavior config key '${key}' is not defined in '${BEHAVIOR_MAP_RELATIVE_PATH}'`,
        hint: `Define '${key}' in '${BEHAVIOR_MAP_RELATIVE_PATH}' or remove it from '${BEHAVIOR_CONFIG_RELATIVE_PATH}'.`,
        path: BEHAVIOR_CONFIG_RELATIVE_PATH,
      });
      continue;
    }
    if (!(value in entry.values)) {
      diagnostics.push({
        code: "BEHAVIOR_VALUE_INVALID",
        severity: "error",
        message: `Behavior config value '${value}' for key '${key}' is not among the allowed values: ${Object.keys(entry.values).join(", ")}`,
        hint: `Run 'harness behavior set ${key} <value>' with one of the allowed values.`,
        path: BEHAVIOR_CONFIG_RELATIVE_PATH,
      });
    }
  }

  const values = new Map<string, string>();
  const choices = new Map<string, BehaviorChoice>();
  for (const [key, entry] of Object.entries(map.keys)) {
    const configured = config[key];
    const useConfigured = configured !== undefined && configured in entry.values;
    const chosen = useConfigured ? configured : entry.default;
    const instruction = entry.values[chosen] ?? "";
    values.set(key, instruction);
    choices.set(key, {
      value: chosen,
      source: useConfigured ? "config" : "default",
      allowed: Object.keys(entry.values),
      instruction,
    });
  }

  return { values, choices, diagnostics };
}

/**
 * Replace {{behavior.<key>}} patterns in text with resolved instruction text.
 * Unresolved placeholders are left as-is and reported.
 */
export function substituteBehaviorPlaceholders(text: string, values: Map<string, string>): SubstitutionResult {
  return substitutePlaceholders(text, BEHAVIOR_PLACEHOLDER_RE, (key) => values.get(key));
}

/** Variable sources threaded through entity loading for placeholder substitution. */
export interface SubstitutionContext {
  envVars: Map<string, string>;
  behaviorValues: Map<string, string>;
}

/**
 * Run the env pass then the behavior pass on raw source text, pushing unresolved-placeholder
 * diagnostics for both. The two placeholder namespaces are disjoint ({{KEY}} forbids dots),
 * so the pass order carries no semantics.
 */
export function substituteSourceText(
  text: string,
  subs: SubstitutionContext,
  diagnostics: Diagnostic[],
  filePath: string,
  extra?: Partial<Diagnostic>,
): { result: string; unresolvedEnvKeys: string[]; unresolvedBehaviorKeys: string[] } {
  const envPass = substituteEnvVars(text, subs.envVars);
  pushUnresolvedEnvDiagnostics(envPass.unresolvedKeys, diagnostics, filePath, extra);
  const behaviorPass = substituteBehaviorPlaceholders(envPass.result, subs.behaviorValues);
  pushUnresolvedBehaviorDiagnostics(behaviorPass.unresolvedKeys, diagnostics, filePath, extra);
  return {
    result: behaviorPass.result,
    unresolvedEnvKeys: envPass.unresolvedKeys,
    unresolvedBehaviorKeys: behaviorPass.unresolvedKeys,
  };
}

/**
 * Push BEHAVIOR_PLACEHOLDER_UNRESOLVED warning diagnostics for each unresolved placeholder key.
 */
export function pushUnresolvedBehaviorDiagnostics(
  unresolvedKeys: string[],
  diagnostics: Diagnostic[],
  filePath: string,
  extra?: Partial<Diagnostic>,
): void {
  for (const key of unresolvedKeys) {
    diagnostics.push({
      code: "BEHAVIOR_PLACEHOLDER_UNRESOLVED",
      severity: "warning",
      message: `Unresolved behavior placeholder '{{behavior.${key}}}' in '${filePath}'`,
      hint: `Define '${key}' in '${BEHAVIOR_MAP_RELATIVE_PATH}'.`,
      path: filePath,
      ...extra,
    });
  }
}
