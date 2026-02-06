I need to write a detailed spec for this proejct "agent-harness", which will be a monorepo that contains both the "Agent Harness Manifest" and the "Agent Harness Toolkit".

The toolkit is a Node.js-script (to be published on NPM) that takes in certain _resources_ (agent skills, mcp server configs, system prompts, lifecycle-hooks, environment-configs, subagents config) and write them into the proejct. It's essentially a generator to abstract away the burden of having to deal with the same kind of resources (e.g. skills) but manually having to save and maintain them in each provider's folder (.github, .claude, ...). This is the purpose of the tool.

Before the tool can programmed though, I need to first plan, draft and publish a v1 of a manifest-file. The agent harness manifest will act like a package-lock file: it tracks which comonents have been configured by the user for the toolkit. This way, it becomes trivial and reliable to e.g. remove one skill as the manifest describes which providers are used and how the specific conventions for each are defined.

The overal spec I have currently thought about so far that makes the "agent harness":

- resources: as described, the specific components that make up the agent harness for agentic software engineering
- vendor: e.g. Claude, Codex, Github Copilot, ...
- processors: how resources are transformed during runtime, processers are vendor-specific and modules
- artifacts: the outputs, e.g. the specific skill-files that get generated, or the prompt files

Some resources (e.g. system prompt) lead to the same artificat even among different vendors. E.g. the AGENTS.md-file at root is generated both for Codex or Kimi Code. This is an apsect I have to consider when planning the relation/data model between resource <-> vendor/processors <-> artifacts.

---

Now I need to think deeply and thoroughly about the spec. I'll start with the manifest file and general project setup using Turborepo and `pnpm`. I won't create any code so far, in this phase I'm drafting and plannign spec proposals. I can search the web to gather further context.
