# @madebywild/agent-harness-manifest

Zod-based schema definitions and validation for [Agent Harness](https://github.com/madebywild/agent-harness) manifest files — unified AI agent configuration management and shareable agent harness registries for Claude Code, GitHub Copilot, and OpenAI Codex.

This package provides the canonical TypeScript types and Zod schemas used by the Agent Harness framework to validate `.harness/` configuration documents (prompts, skills, MCP configs, subagents, and the manifest lock).

## Installation

```bash
pnpm add @madebywild/agent-harness-manifest
```

## Usage

```ts
import { manifestLockSchema, promptDocSchema } from "@madebywild/agent-harness-manifest";
```

## License

MIT
