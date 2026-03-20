#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Order matters: manifest must be published before framework (framework depends on manifest).
const PACKAGE_CONFIGS = [
  {
    expectedName: "@madebywild/agent-harness-manifest",
    packageJsonPath: "packages/manifest-schema/package.json",
  },
  {
    expectedName: "@madebywild/agent-harness-framework",
    packageJsonPath: "packages/toolkit/package.json",
  },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tagFlagIndex = args.indexOf("--tag");
const tagFlagValue = tagFlagIndex !== -1 ? args[tagFlagIndex + 1] : undefined;
const mode = args.find((a) => !a.startsWith("--") && (tagFlagIndex === -1 || a !== tagFlagValue)) ?? "prepublish";
const verifyMaxAttempts = parsePositiveInt(process.env.RELEASE_VERIFY_MAX_ATTEMPTS, 6);
const verifyRetryDelayMs = parsePositiveInt(process.env.RELEASE_VERIFY_RETRY_DELAY_MS, 5000);

if (mode !== "prepublish" && mode !== "publish" && mode !== "verify-published") {
  fail(`Unknown mode '${mode}'. Use 'prepublish', 'publish', or 'verify-published'.`);
}

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const packages = PACKAGE_CONFIGS.map(loadPackageManifest);
const targetVersion = validateLockstepVersions(packages);
const tagVersion = readTagVersionFromEnvironment();

if (tagVersion !== targetVersion) {
  fail(`Tag version '${tagVersion}' does not match package version '${targetVersion}'.`);
}

if (mode === "prepublish") {
  for (const pkg of packages) {
    assertPackageVersionNotBlocked(pkg.name, targetVersion);
  }

  log(`Prepublish checks passed for ${targetVersion}.`);
  process.exit(0);
}

if (mode === "publish") {
  for (const pkg of packages) {
    publishPackageIfMissing(pkg.name, targetVersion);
  }

  log(`Publish phase completed for ${targetVersion}.`);
  process.exit(0);
}

await verifyPublishedVersions(packages, targetVersion);

function loadPackageManifest(config) {
  const absolutePath = path.join(repoRoot, config.packageJsonPath);
  const payload = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (payload.name !== config.expectedName) {
    fail(
      `Package name mismatch in ${config.packageJsonPath}: expected '${config.expectedName}', got '${payload.name ?? "<missing>"}'.`,
    );
  }

  if (typeof payload.version !== "string" || payload.version.trim() === "") {
    fail(`Missing package version in ${config.packageJsonPath}.`);
  }

  return {
    name: payload.name,
    version: payload.version,
    packageJsonPath: config.packageJsonPath,
  };
}

function validateLockstepVersions(packagesWithVersion) {
  const uniqueVersions = [...new Set(packagesWithVersion.map((pkg) => pkg.version))];
  if (uniqueVersions.length !== 1) {
    const details = packagesWithVersion.map((pkg) => `${pkg.name}@${pkg.version} (${pkg.packageJsonPath})`).join(", ");
    fail(`All publishable packages must use the same version. Found: ${details}`);
  }

  return uniqueVersions[0];
}

function readTagVersionFromEnvironment() {
  const rawTag = (tagFlagValue ?? process.env.GITHUB_REF_NAME ?? "").trim();
  if (!rawTag) {
    fail("GITHUB_REF_NAME is required (expected format: vX.Y.Z). For local testing, use --tag vX.Y.Z.");
  }

  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(rawTag)) {
    fail(`Invalid tag format '${rawTag}'. Expected 'vX.Y.Z'.`);
  }

  return rawTag.slice(1);
}

function assertPackageVersionNotBlocked(packageName, version) {
  const state = inspectPackageVersion(packageName, version);
  if (state === "exists") {
    log(`Already published, will skip publish: ${packageName}@${version}`);
    return;
  }

  log(`Confirmed unpublished: ${packageName}@${version}`);
}

function publishPackageIfMissing(packageName, version) {
  const state = inspectPackageVersion(packageName, version);
  if (state === "exists") {
    log(`Skipping publish for existing version: ${packageName}@${version}`);
    return;
  }

  if (dryRun) {
    log(`[dry-run] Would publish ${packageName}@${version}`);
    return;
  }

  log(`Publishing ${packageName}@${version}`);
  const result = spawnSync("pnpm", ["--filter", packageName, "publish", "--access", "public", "--no-git-checks"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    fail(
      `Failed to publish ${packageName}@${version}. pnpm output:\n${`${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()}`,
    );
  }
}

function inspectPackageVersion(packageName, version) {
  const lookup = npmView(`${packageName}@${version}`, "version");
  if (lookup.ok) {
    return "exists";
  }

  const output = `${lookup.stdout}\n${lookup.stderr}`;
  if (/\bE401\b/.test(output) || /\bE403\b/.test(output)) {
    fail(
      `Registry auth failed while checking ${packageName}@${version}. Ensure NODE_AUTH_TOKEN/NPM_TOKEN has read access.`,
    );
  }

  if (/\bE404\b/.test(output) || /\b404\b/.test(output)) {
    return "missing";
  }

  fail(`Unable to verify existing version for ${packageName}@${version}. npm view output:\n${output.trim()}`);
}

async function verifyPublishedVersions(packagesToVerify, version) {
  for (const pkg of packagesToVerify) {
    await assertPackageVersionExists(pkg.name, version);
  }

  log(`Published version checks passed for ${version}.`);
  process.exit(0);
}

async function assertPackageVersionExists(packageName, version) {
  for (let attempt = 1; attempt <= verifyMaxAttempts; attempt += 1) {
    const lookup = npmView(`${packageName}@${version}`, "version");
    if (lookup.ok) {
      let publishedVersion;
      try {
        publishedVersion = JSON.parse(lookup.stdout);
      } catch (error) {
        fail(`Failed to parse npm view output for ${packageName}@${version}: ${String(error)}.`);
      }

      if (publishedVersion !== version) {
        fail(
          `Published version mismatch for ${packageName}. Expected '${version}', got '${String(publishedVersion)}'.`,
        );
      }

      log(`Confirmed published: ${packageName}@${version}`);
      return;
    }

    const output = `${lookup.stdout}\n${lookup.stderr}`.trim();
    const isAuthError = /\bE401\b/.test(output) || /\bE403\b/.test(output);
    const isNotFound = /\bE404\b/.test(output) || /\b404\b/.test(output);
    const hasAttemptsLeft = attempt < verifyMaxAttempts;

    if (isAuthError) {
      fail(
        `Registry auth failed while verifying ${packageName}@${version}. Ensure NODE_AUTH_TOKEN/NPM_TOKEN has read access.`,
      );
    }

    if (isNotFound && hasAttemptsLeft) {
      log(
        `Package not visible yet (${packageName}@${version}), retry ${attempt}/${verifyMaxAttempts} in ${verifyRetryDelayMs}ms.`,
      );
      await sleep(verifyRetryDelayMs);
      continue;
    }

    fail(`Failed to verify published version for ${packageName}@${version}. npm view output:\n${output}`);
  }
}

function parsePositiveInt(rawValue, fallback) {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function npmView(spec, field) {
  const result = spawnSync("npm", ["view", spec, field, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function log(message) {
  console.log(`[release-guard] ${message}`);
}

function fail(message) {
  console.error(`[release-guard] ${message}`);
  process.exit(1);
}
