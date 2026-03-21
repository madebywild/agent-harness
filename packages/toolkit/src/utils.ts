import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeRelativePath(input: string): string {
  const posixInput = input.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/u.test(posixInput)) {
    throw new Error(`invalid relative path '${input}'`);
  }
  if (posixInput.split("/").includes("..")) {
    throw new Error(`invalid relative path '${input}'`);
  }

  const normalized = path.posix.normalize(posixInput);
  const withoutDot = normalized.startsWith("./") ? normalized.slice(2) : normalized;
  if (
    !withoutDot ||
    withoutDot === "." ||
    withoutDot === ".." ||
    withoutDot.startsWith("/") ||
    withoutDot.split("/").includes("..")
  ) {
    throw new Error(`invalid relative path '${input}'`);
  }
  return withoutDot;
}

export function toPosixRelative(fromAbs: string, rootAbs: string): string {
  const relative = path.relative(rootAbs, fromAbs).replace(/\\/g, "/");
  return normalizeRelativePath(relative);
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), undefined, 2)}\n`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sortedEntries = Object.entries(objectValue)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeFileAtomic(absPath: string, content: string): Promise<void> {
  await ensureParentDir(absPath);

  const tempPath = path.join(
    path.dirname(absPath),
    `.${path.basename(absPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  await fs.writeFile(tempPath, content, "utf8");

  try {
    await fs.rename(tempPath, absPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {
      // best effort cleanup for failed atomic writes
    });
    throw error;
  }
}

export async function copyToBackup(rootAbs: string, relPath: string, backupRootAbs: string): Promise<boolean> {
  const normalized = normalizeRelativePath(relPath);
  const sourceAbs = path.join(rootAbs, normalized);

  if (!(await exists(sourceAbs))) {
    return false;
  }

  const backupAbs = path.join(backupRootAbs, normalized);
  await ensureParentDir(backupAbs);
  await fs.copyFile(sourceAbs, backupAbs);
  return true;
}

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT"
  );
}

export function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

export function deepMergeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = uniqSorted([...Object.keys(base), ...Object.keys(overlay)]);

  for (const key of keys) {
    const hasBase = Object.hasOwn(base, key);
    const hasOverlay = Object.hasOwn(overlay, key);
    const baseValue = base[key];
    const overlayValue = overlay[key];

    if (hasBase && hasOverlay) {
      if (isPlainRecord(baseValue) && isPlainRecord(overlayValue)) {
        result[key] = deepMergeObjects(baseValue, overlayValue);
      } else {
        result[key] = cloneMergeValue(overlayValue);
      }
      continue;
    }

    if (hasOverlay) {
      result[key] = cloneMergeValue(overlayValue);
      continue;
    }

    result[key] = cloneMergeValue(baseValue);
  }

  return result;
}

export function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stripTrailingNewlines(value: string): string {
  return value.replace(/[\n\r]+$/g, "");
}

export function withSingleTrailingNewline(value: string): string {
  return `${stripTrailingNewlines(value)}\n`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneMergeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneMergeValue(entry));
  }

  if (isPlainRecord(value)) {
    return deepMergeObjects({}, value);
  }

  return value;
}
