import { type BehaviorMap, parseBehaviorMap } from "@madebywild/agent-harness-manifest";
import {
  BEHAVIOR_CONFIG_RELATIVE_PATH,
  BEHAVIOR_MAP_RELATIVE_PATH,
  type LoadedBehavior,
  loadBehavior,
} from "../behavior.js";
import type { HarnessPaths } from "../paths.js";
import { ensureHarnessGitignore } from "../repository.js";
import { readTextIfExists, writeFileAtomic } from "../utils.js";

export interface BehaviorSetResult {
  key: string;
  value: string;
  message: string;
}

async function readBehaviorMapOrThrow(paths: HarnessPaths): Promise<BehaviorMap> {
  const mapText = await readTextIfExists(paths.behaviorMapFile);
  if (mapText === null) {
    throw new Error(
      `No behavior map found at '${BEHAVIOR_MAP_RELATIVE_PATH}'. Create it to define the allowed behavior keys and values.`,
    );
  }

  const YAML = await import("yaml");
  try {
    return parseBehaviorMap(YAML.parse(mapText));
  } catch (error) {
    throw new Error(
      `Invalid behavior map '${BEHAVIOR_MAP_RELATIVE_PATH}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Validate `key`/`value` against the behavior map and persist the choice into
 * `.harness/behavior.yaml`, preserving any hand-written comments and formatting.
 */
export async function setBehaviorValue(paths: HarnessPaths, key: string, value: string): Promise<BehaviorSetResult> {
  const map = await readBehaviorMapOrThrow(paths);

  const entry = map.keys[key];
  if (!entry) {
    const known = Object.keys(map.keys);
    throw new Error(
      `Behavior key '${key}' is not defined in '${BEHAVIOR_MAP_RELATIVE_PATH}'.${known.length > 0 ? ` Known keys: ${known.join(", ")}` : ""}`,
    );
  }

  if (!(value in entry.values)) {
    throw new Error(
      `Behavior value '${value}' is not allowed for key '${key}'. Allowed values: ${Object.keys(entry.values).join(", ")}`,
    );
  }

  const YAML = await import("yaml");
  const configText = await readTextIfExists(paths.behaviorConfigFile);
  let document: InstanceType<typeof YAML.Document>;
  if (configText === null) {
    document = new YAML.Document({});
  } else {
    document = YAML.parseDocument(configText);
    if (document.errors.length > 0) {
      throw new Error(
        `Invalid behavior config '${BEHAVIOR_CONFIG_RELATIVE_PATH}': ${document.errors[0]?.message ?? "invalid YAML"}. Fix or delete the file (it only holds your local choices).`,
      );
    }
    const contents = document.toJS() as unknown;
    if (contents !== null && (typeof contents !== "object" || Array.isArray(contents))) {
      throw new Error(
        `Invalid behavior config '${BEHAVIOR_CONFIG_RELATIVE_PATH}': expected a YAML map of key: value. Fix or delete the file (it only holds your local choices).`,
      );
    }
  }

  document.set(key, value);
  // Workspaces created before .harness/.gitignore existed get it here, as the local config appears.
  await ensureHarnessGitignore(paths);
  await writeFileAtomic(paths.behaviorConfigFile, document.toString());

  return {
    key,
    value,
    message: `Set behavior '${key}' to '${value}' in ${BEHAVIOR_CONFIG_RELATIVE_PATH}.`,
  };
}

/** Resolve the current behavior state (map + config) for display. */
export async function showBehavior(paths: HarnessPaths): Promise<LoadedBehavior> {
  return loadBehavior(paths);
}
