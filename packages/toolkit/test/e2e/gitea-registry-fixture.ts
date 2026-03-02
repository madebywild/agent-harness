import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { GenericContainer } from "testcontainers";

const execFileAsync = promisify(execFile);

const DEFAULT_BRANCH = "main";
const API_TIMEOUT_MS = 60_000;
const API_POLL_INTERVAL_MS = 500;

export interface RegistryRepoFixture {
  readonly owner: string;
  readonly name: string;
  readonly defaultRef: string;
  readonly readOnlyUrl: string;
  readonly private: boolean;
  updateFile(relativePath: string, content: string, message: string): Promise<void>;
}

export class GiteaRegistryFixture {
  private readonly adminUser = "harness-admin";
  private readonly adminPassword = "harness-admin-password";
  private readonly adminEmail = "harness-admin@example.com";

  private container: Awaited<ReturnType<GenericContainer["start"]>> | undefined;
  private host = "";
  private port = 0;
  private repoCounter = 0;
  private readonly localRepos = new Set<string>();

  async start(): Promise<void> {
    try {
      this.container = await new GenericContainer("gitea/gitea:1.22.6")
        .withEnvironment({
          USER_UID: "1000",
          USER_GID: "1000",
          GITEA__database__DB_TYPE: "sqlite3",
          GITEA__security__INSTALL_LOCK: "true",
          GITEA__service__DISABLE_REGISTRATION: "true",
          GITEA__server__DOMAIN: "localhost",
          GITEA__server__HTTP_PORT: "3000",
          GITEA__server__SSH_DOMAIN: "localhost",
          GITEA__server__START_SSH_SERVER: "false",
          GITEA__log__LEVEL: "Warn",
        })
        .withExposedPorts(3000)
        .start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Container runtime unavailable for Testcontainers. Install/start a Docker-compatible runtime and retry. Original error: ${message}`,
      );
    }

    this.host = this.container.getHost();
    this.port = this.container.getMappedPort(3000);

    await this.waitForHealth();
    await this.createAdminUser();
    await this.waitForApi();
  }

  async stop(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = undefined;
    }

    await Promise.all(
      [...this.localRepos].map(async (repoPath) => {
        await fs.rm(repoPath, { recursive: true, force: true });
      }),
    );
    this.localRepos.clear();
  }

  getBasicAuthHeader(): string {
    return basicAuthHeader(this.adminUser, this.adminPassword);
  }

  async createRegistryRepo(options: {
    files: Record<string, string>;
    private?: boolean;
    namePrefix?: string;
  }): Promise<RegistryRepoFixture> {
    const repositoryName = `${options.namePrefix ?? "registry"}-${Date.now()}-${this.repoCounter}`;
    this.repoCounter += 1;

    const createResponse = await this.api("/api/v1/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: repositoryName,
        private: options.private === true,
        auto_init: false,
      }),
    });

    if (createResponse.status !== 201) {
      throw new Error(`Failed to create gitea repository '${repositoryName}' (status ${createResponse.status}).`);
    }

    const owner = this.adminUser;
    const readOnlyUrl = `${this.baseHttpUrl()}/${owner}/${repositoryName}.git`;
    const pushUrl = `${this.baseHttpUrl().replace("http://", `http://${this.adminUser}:${this.adminPassword}@`)}/${owner}/${repositoryName}.git`;

    const localRepo = await fs.mkdtemp(path.join(os.tmpdir(), "agent-harness-e2e-registry-repo-"));
    this.localRepos.add(localRepo);
    await writeFiles(localRepo, options.files);
    await initializeGitRepo(localRepo);
    await execFileAsync("git", ["remote", "add", "origin", pushUrl], { cwd: localRepo });
    await execFileAsync("git", ["push", "-u", "origin", DEFAULT_BRANCH], { cwd: localRepo });

    return {
      owner,
      name: repositoryName,
      defaultRef: DEFAULT_BRANCH,
      readOnlyUrl,
      private: options.private === true,
      updateFile: async (relativePath: string, content: string, message: string): Promise<void> => {
        const absolutePath = path.join(localRepo, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, "utf8");
        await execFileAsync("git", ["add", relativePath], { cwd: localRepo });
        await execFileAsync("git", ["commit", "-m", message], { cwd: localRepo });
        await execFileAsync("git", ["push", "origin", DEFAULT_BRANCH], { cwd: localRepo });
      },
    };
  }

  private async waitForHealth(): Promise<void> {
    await waitUntil(
      async () => {
        const response = await fetch(`${this.baseHttpUrl()}/api/healthz`).catch(() => undefined);
        return response?.ok === true;
      },
      API_TIMEOUT_MS,
      API_POLL_INTERVAL_MS,
      "Timed out waiting for gitea health endpoint.",
    );
  }

  private async waitForApi(): Promise<void> {
    await waitUntil(
      async () => {
        const response = await fetch(`${this.baseHttpUrl()}/api/v1/version`, {
          headers: {
            Authorization: this.getBasicAuthHeader(),
          },
        }).catch(() => undefined);
        return response?.ok === true;
      },
      API_TIMEOUT_MS,
      API_POLL_INTERVAL_MS,
      "Timed out waiting for gitea API readiness.",
    );
  }

  private async createAdminUser(): Promise<void> {
    if (!this.container) {
      throw new Error("Container is not running");
    }

    const result = await this.container.exec(
      [
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        this.adminUser,
        "--password",
        this.adminPassword,
        "--email",
        this.adminEmail,
        "--admin",
        "--must-change-password=false",
      ],
      {
        // Gitea rejects admin commands when invoked as root.
        user: "1000:1000",
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to provision gitea admin user (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    }
  }

  private async api(relativePath: string, init: RequestInit): Promise<Response> {
    return fetch(`${this.baseHttpUrl()}${relativePath}`, {
      ...init,
      headers: {
        Authorization: this.getBasicAuthHeader(),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  private baseHttpUrl(): string {
    if (!this.container) {
      throw new Error("Container is not running");
    }

    return `http://${this.host}:${this.port}`;
  }
}

export function basicAuthHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function initializeGitRepo(repoPath: string): Promise<void> {
  await execFileAsync("git", ["init", "-b", DEFAULT_BRANCH], { cwd: repoPath }).catch(async () => {
    await execFileAsync("git", ["init"], { cwd: repoPath });
    await execFileAsync("git", ["checkout", "-b", DEFAULT_BRANCH], { cwd: repoPath }).catch(() => {
      // No-op when default branch is already main.
    });
  });

  await execFileAsync("git", ["config", "user.name", "Harness E2E"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.email", "harness-e2e@example.com"], { cwd: repoPath });
  await execFileAsync("git", ["add", "."], { cwd: repoPath });
  await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: repoPath });
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, "utf8");
  }
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  timeoutMessage: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(timeoutMessage);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
