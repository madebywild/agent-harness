import type { Diagnostic } from "../../types.js";
import type {
  ApplyOutput,
  CommandOutput,
  DoctorOutput,
  MigrateOutput,
  PlanOutput,
  RegistryOutput,
  ValidationOutput,
} from "../contracts.js";

function renderDiagnostic(diagnostic: Diagnostic): string {
  const location = diagnostic.path ? ` (${diagnostic.path})` : "";
  return `[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}${location}`;
}

function renderPlanLikeOperations(output: PlanOutput | ApplyOutput, writeLine: (line: string) => void): void {
  for (const operation of output.data.result.operations) {
    const provider = operation.provider ? ` [${operation.provider}]` : "";
    writeLine(`${operation.type.toUpperCase()}${provider} ${operation.path} - ${operation.reason}`);
  }
}

function renderDiagnosticsSection(diagnostics: Diagnostic[], writeLine: (line: string) => void): void {
  if (diagnostics.length > 0) {
    writeLine("");
    writeLine("Diagnostics:");
  }

  for (const diagnostic of diagnostics) {
    writeLine(renderDiagnostic(diagnostic));
  }
}

function renderRegistryOutput(output: RegistryOutput, writeLine: (line: string) => void): void {
  switch (output.data.operation) {
    case "list": {
      for (const entry of output.data.registries) {
        const marker = entry.isDefault ? " (default)" : "";
        if (entry.definition.type === "local") {
          writeLine(`${entry.id}${marker} - local`);
          continue;
        }

        const root = entry.definition.rootPath ? ` root=${entry.definition.rootPath}` : "";
        const token = entry.definition.tokenEnvVar ? ` tokenEnv=${entry.definition.tokenEnvVar}` : "";
        writeLine(`${entry.id}${marker} - git url=${entry.definition.url} ref=${entry.definition.ref}${root}${token}`);
      }
      return;
    }
    case "validate": {
      if (output.data.result.diagnostics.length === 0) {
        writeLine("Registry validation passed.");
      } else {
        for (const diagnostic of output.data.result.diagnostics) {
          writeLine(renderDiagnostic(diagnostic));
        }
      }
      return;
    }
    case "add":
    case "remove":
    case "default.set": {
      writeLine(output.data.message);
      return;
    }
    case "default.show": {
      writeLine(output.data.registry);
      return;
    }
    case "pull": {
      if (output.data.result.updatedEntities.length === 0) {
        writeLine("No imported entities matched pull criteria.");
        return;
      }

      for (const updated of output.data.result.updatedEntities) {
        writeLine(`Pulled ${updated.type} '${updated.id}'.`);
      }
      return;
    }
  }
}

function renderValidationOutput(output: ValidationOutput, writeLine: (line: string) => void): void {
  if (output.data.result.diagnostics.length === 0) {
    writeLine("Validation passed.");
    return;
  }

  for (const diagnostic of output.data.result.diagnostics) {
    writeLine(renderDiagnostic(diagnostic));
  }
}

function renderDoctorOutput(output: DoctorOutput, writeLine: (line: string) => void): void {
  for (const file of output.data.result.files) {
    const provider = file.provider ? ` [${file.provider}]` : "";
    const versionLabel = typeof file.version === "number" ? ` v${file.version}` : "";
    writeLine(`${file.status.toUpperCase()}${provider} ${file.path ?? "<unknown>"}${versionLabel} - ${file.message}`);
  }

  renderDiagnosticsSection(output.data.result.diagnostics, writeLine);
}

function renderMigrateOutput(output: MigrateOutput, writeLine: (line: string) => void): void {
  for (const action of output.data.result.actions) {
    writeLine(`${action.action.toUpperCase()} ${action.path} - ${action.details}`);
  }

  if (output.data.result.backupRoot) {
    writeLine(`Backup: ${output.data.result.backupRoot}`);
  }

  renderDiagnosticsSection(output.data.result.diagnostics, writeLine);
}

function renderPlanOutput(output: PlanOutput, writeLine: (line: string) => void): void {
  if (
    output.data.defaultInvocation &&
    output.data.result.operations.length === 0 &&
    output.data.result.diagnostics.length === 0
  ) {
    writeLine("No changes detected.");
    return;
  }

  renderPlanLikeOperations(output, writeLine);
  renderDiagnosticsSection(output.data.result.diagnostics, writeLine);
}

function renderApplyOutput(output: ApplyOutput, writeLine: (line: string) => void): void {
  for (const operation of output.data.result.operations) {
    if (operation.type === "noop") {
      continue;
    }

    const provider = operation.provider ? ` [${operation.provider}]` : "";
    writeLine(`${operation.type.toUpperCase()}${provider} ${operation.path} - ${operation.reason}`);
  }

  renderDiagnosticsSection(output.data.result.diagnostics, writeLine);
  writeLine("");
  writeLine(
    `Wrote ${output.data.result.writtenArtifacts.length} artifact(s), removed ${output.data.result.prunedArtifacts.length}.`,
  );
}

export function renderTextOutput(output: CommandOutput, writeLine: (line: string) => void): void {
  switch (output.family) {
    case "init":
    case "provider":
    case "entity-mutation": {
      if ("message" in output.data && typeof output.data.message === "string") {
        writeLine(output.data.message);
      }
      return;
    }
    case "registry": {
      renderRegistryOutput(output, writeLine);
      return;
    }
    case "validation": {
      renderValidationOutput(output, writeLine);
      return;
    }
    case "doctor": {
      renderDoctorOutput(output, writeLine);
      return;
    }
    case "migrate": {
      renderMigrateOutput(output, writeLine);
      return;
    }
    case "plan": {
      renderPlanOutput(output, writeLine);
      return;
    }
    case "apply": {
      renderApplyOutput(output, writeLine);
      return;
    }
    case "watch": {
      return;
    }
  }
}
