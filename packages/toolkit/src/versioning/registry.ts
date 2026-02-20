import type { DocumentKind } from "@agent-harness/manifest-schema";

export interface MigrationStep {
  kind: DocumentKind;
  fromVersion: number;
  toVersion: number;
  migrate(input: unknown): unknown | Promise<unknown>;
}

export interface MigrationRegistry {
  readonly byKind: ReadonlyMap<DocumentKind, ReadonlyArray<MigrationStep>>;
}

export function createMigrationRegistry(steps: readonly MigrationStep[]): MigrationRegistry {
  const map = new Map<DocumentKind, MigrationStep[]>();

  for (const step of steps) {
    const existing = map.get(step.kind) ?? [];
    existing.push(step);
    map.set(step.kind, existing);
  }

  for (const [kind, kindSteps] of map.entries()) {
    map.set(
      kind,
      [...kindSteps].sort((left, right) => {
        const byFrom = left.fromVersion - right.fromVersion;
        if (byFrom !== 0) {
          return byFrom;
        }
        return left.toVersion - right.toVersion;
      }),
    );
  }

  return {
    byKind: map,
  };
}

export function resolveMigrationChain(
  registry: MigrationRegistry,
  kind: DocumentKind,
  fromVersion: number,
  toVersion: number,
): MigrationStep[] | null {
  if (fromVersion === toVersion) {
    return [];
  }

  if (fromVersion > toVersion) {
    return null;
  }

  const available = registry.byKind.get(kind) ?? [];
  const chain: MigrationStep[] = [];
  let current = fromVersion;

  while (current < toVersion) {
    const next = available.find((step) => step.fromVersion === current);
    if (!next) {
      return null;
    }

    chain.push(next);
    current = next.toVersion;
  }

  return chain;
}

export async function runMigrationChain(
  registry: MigrationRegistry,
  kind: DocumentKind,
  fromVersion: number,
  toVersion: number,
  input: unknown,
): Promise<{ output: unknown; appliedSteps: number }> {
  const chain = resolveMigrationChain(registry, kind, fromVersion, toVersion);
  if (chain === null) {
    throw new Error(`No migration chain available for ${kind} ${fromVersion} -> ${toVersion}`);
  }

  let output = input;
  for (const step of chain) {
    output = await step.migrate(output);
  }

  return {
    output,
    appliedSteps: chain.length,
  };
}

export const defaultMigrationRegistry = createMigrationRegistry([]);
