# `packages/toolkit/src/behavior.ts`

## Purpose

Loads the behavior map (`.harness/behavior.map.yaml`, committed ruleset) and behavior config (`.harness/behavior.yaml`, per-developer choices), resolves every map key to instruction text, and substitutes `{{behavior.<key>}}` placeholders in entity source text.

See also: [Behavior Config Guide](./behavior-config.md)

## Exported APIs

- `loadBehavior(paths)`: loads and validates both files; resolves each map key to its instruction text (config choice or map default).
- `substituteBehaviorPlaceholders(text, values)`: replaces `{{behavior.<key>}}` patterns; unresolved placeholders are left as-is.
- `pushUnresolvedBehaviorDiagnostics(unresolvedKeys, diagnostics, filePath, extra?)`: emits one `BEHAVIOR_PLACEHOLDER_UNRESOLVED` warning per key.
- `substituteSourceText(text, subs, diagnostics, filePath, extra?)`: runs the env pass then the behavior pass on raw source text, pushing unresolved diagnostics for both; the shared entry point used by `loader.ts` and `repository.ts`.
- `SubstitutionContext`: `{ envVars: Map<string, string>; behaviorValues: Map<string, string> }`, threaded through all entity loaders.
- `BEHAVIOR_PLACEHOLDER_RE`: `/\{\{behavior\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g`.
- Types: `LoadedBehavior { values, choices, diagnostics }`, `BehaviorChoice { value, source, allowed, instruction }`.

## `loadBehavior`

1. Reads both files (`paths.behaviorMapFile`, `paths.behaviorConfigFile`). Neither present → empty no-op result.
2. Config present without a map → `BEHAVIOR_MAP_MISSING` (error).
3. Parses the map via YAML then `parseBehaviorMap` (manifest-schema; versioned document kind `behavior-map`). Failure → `BEHAVIOR_MAP_INVALID` (error).
4. Parses the config via YAML then `parseBehaviorConfig`. Failure → `BEHAVIOR_CONFIG_INVALID` (error).
5. Validates each config entry against the map: `BEHAVIOR_KEY_UNKNOWN` / `BEHAVIOR_VALUE_INVALID` (errors).
6. Resolves every map key: valid config value, else `default`; records the instruction text in `values` and the choice details in `choices`.

## Substitution semantics

- Behavior placeholders use a dotted namespace, so they can never collide with `{{ENV_VAR}}` placeholders (whose regex forbids dots) and never fall back to `process.env`.
- The env pass runs first, then the behavior pass; the namespaces are disjoint on raw source text so the order carries no semantics. Nested expansion is unsupported.
- Substitution happens on raw text before parsing, in all entity loaders and override sidecars (see `loader.ts` and `repository.ts` `readProviderOverrideFile`).
- SHA256 hashes are always computed on the raw (pre-substitution) text; changing a behavior value changes rendered artifacts (an `update` operation), never the lock's `sourceSha256`.
- In JSON sources, unresolved `{{behavior.<key>}}` placeholders in bare value positions are re-quoted by the shared JSON placeholder walker in `loader.ts` so the entity still parses.

## Engine and CLI surface

- `HarnessEngine.behaviorSet(key, value)` → `src/engine/behavior.ts` `setBehaviorValue`: validates against the map, then writes the config via the YAML Document API (preserving comments) and `writeFileAtomic`.
- `HarnessEngine.behaviorShow()` → `showBehavior`: returns `LoadedBehavior` for display.
- CLI: `harness behavior set <key> <value>` and `harness behavior show` (`cli/handlers/behavior.ts`, output family `behavior`).
- `engine.watch()` watches both behavior files and re-applies on change.

## Diagnostics produced

- `BEHAVIOR_MAP_MISSING`, `BEHAVIOR_MAP_INVALID`, `BEHAVIOR_CONFIG_INVALID`, `BEHAVIOR_KEY_UNKNOWN`, `BEHAVIOR_VALUE_INVALID` (errors; block apply).
- `BEHAVIOR_PLACEHOLDER_UNRESOLVED` (warning; placeholder left as-is).
- Doctor: `BEHAVIOR_MAP_VERSION_*` via document kind `behavior-map` (`versioning/doctor.ts`; absent map is skipped).
