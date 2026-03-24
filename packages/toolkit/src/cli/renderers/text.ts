import type { Diagnostic } from "../../types.js";
import type {
  ApplyOutput,
  CommandOutput,
  DoctorOutput,
  MigrateOutput,
  PlanOutput,
  PresetOutput,
  RegistryOutput,
  SkillsOutput,
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

function renderPresetOutput(output: PresetOutput, writeLine: (line: string) => void): void {
  switch (output.data.operation) {
    case "list": {
      for (const preset of output.data.presets) {
        const source = preset.registry ? `${preset.source}:${preset.registry}` : preset.source;
        const recommended = preset.recommended ? " (recommended)" : "";
        writeLine(`${preset.id}${recommended} - ${preset.name} [${source}]`);
      }
      return;
    }
    case "describe": {
      const preset = output.data.preset;
      const source = preset.registry ? `${preset.source}:${preset.registry}` : preset.source;
      writeLine(`${preset.definition.id} - ${preset.definition.name} [${source}]`);
      writeLine(preset.definition.description);
      writeLine("");
      writeLine("Operations:");
      for (const operation of preset.definition.operations) {
        let target = "";
        switch (operation.type) {
          case "register_registry":
            target = operation.registry;
            break;
          case "enable_provider":
          case "add_settings":
            target = operation.provider;
            break;
          case "add_prompt":
            target = "system";
            break;
          case "add_skill":
          case "add_mcp":
          case "add_subagent":
          case "add_hook":
          case "add_command":
            target = operation.id;
            break;
        }
        writeLine(`- ${operation.type}${target ? ` ${target}` : ""}`);
      }
      return;
    }
    case "apply": {
      writeLine(`Applied preset '${output.data.result.preset.id}'.`);
      for (const result of output.data.result.results) {
        writeLine(`${result.outcome.toUpperCase()} ${result.target} - ${result.message}`);
      }
      return;
    }
  }
}

function renderSkillsOutput(output: SkillsOutput, writeLine: (line: string) => void): void {
  if (output.data.operation === "find") {
    if (output.data.results.length === 0) {
      writeLine("No skill matches parsed from skills find output.");
      if (output.data.rawText.length > 0) {
        writeLine("");
        writeLine(output.data.rawText);
      }
      renderDiagnosticsSection(output.diagnostics, writeLine);
      return;
    }

    for (const result of output.data.results) {
      const installs = result.installs ? ` ${result.installs}` : "";
      const url = result.url ? ` ${result.url}` : "";
      writeLine(`${result.source}@${result.upstreamSkill}${installs}${url}`);
    }
    renderDiagnosticsSection(output.diagnostics, writeLine);
    return;
  }

  const result = output.data.result;
  const status = output.ok ? "Imported" : "Import blocked";
  const meta = result.metadataPath ? `metadata: ${result.metadataPath}` : "metadata: (not written)";
  writeLine(`${status} skill '${result.importedId}' (${result.fileCount} file(s), ${meta}).`);

  if (result.audit.audited) {
    const providerSummary = result.audit.providers
      .map((provider) => `${provider.provider}=${provider.raw} [${provider.outcome}]`)
      .join(", ");
    writeLine(`Audit: ${providerSummary}`);
  } else {
    writeLine("Audit: unavailable");
  }

  if (result.audit.detailsUrl) {
    writeLine(`Audit details: ${result.audit.detailsUrl}`);
  }

  renderDiagnosticsSection(output.diagnostics, writeLine);
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
    case "preset": {
      renderPresetOutput(output, writeLine);
      return;
    }
    case "skills": {
      renderSkillsOutput(output, writeLine);
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
