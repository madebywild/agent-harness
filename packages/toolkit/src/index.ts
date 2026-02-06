import { MANIFEST_SCHEMA_PACKAGE } from "@agent-harness/manifest-schema";

export const TOOLKIT_PACKAGE = "@agent-harness/toolkit";

export function getWorkspaceBootstrapInfo(): string {
  return `${TOOLKIT_PACKAGE} depends on ${MANIFEST_SCHEMA_PACKAGE}`;
}
