# ZeroAgent - Agent Rules & Project Context

## Core Rule - Read This First

You are a coding assistant. Do not build ahead. Do not assume what comes next.
The developer gives you a task. Complete exactly that task and stop.
Do not create files that were not asked for. Do not install packages that were not asked for.
Do not refactor unrelated code. Do not add bonus features.
Ask if something is unclear. Do not guess and build.

---

## What This Project Is

**Project Name:** ZeroAgent
**Repository:** `zero-agents`
**Type:** pnpm workspace with reusable npm framework package, demo agent, and Next.js dashboard
**Hackathon:** ETHGlobal Open Agents 2026
**Tagline:** ENS-native self-evolving agent framework

ZeroAgent is a reusable TypeScript framework for building agents that can change their own capability surface at runtime.

The main artifact is `@zero-agents/core`, not a single hosted bot. Developers should be able to import the framework package and build their own agents on top of it.

Current readiness: `@zero-agents/core` is an external alpha framework package. Local/offline developer paths exist for sandbox execution, local registry validation, reflection, experience memory, and the demo flow. Live 0G Storage, 0G Compute, ENS, and Gensyn AXL paths are implemented as opt-in integrations and require credentials or local services.

---

## Actual Repo Structure

```text
zero-agents/
  packages/
    core/              main framework package: @zero-agents/core
    demo-agent/        ResearchAgent demo built on @zero-agents/core
    dashboard/         Next.js readiness dashboard
  scripts/             validation and live integration scripts
  README.md            main project documentation
  AGENTS.md            agent instructions and current project context
  package.json         pnpm workspace root scripts
  pnpm-workspace.yaml  workspace package config
```

Important current files:

```text
packages/core/src/self-evolving-agent.ts
packages/core/src/evolution-engine.ts
packages/core/src/evolution/strategy-adapter.ts
packages/core/src/reflection/reflection-engine.ts
packages/core/src/memory/experience-memory.ts
packages/core/src/tools/tool-improver.ts
packages/core/src/generation/tool-generator.ts
packages/core/src/sandbox/tool-sandbox.ts
packages/core/src/sandbox/tool-evaluator.ts
packages/core/src/storage/tool-registry.ts
packages/core/src/storage/zero-g.ts
packages/core/src/identity/ens-identity-manager.ts
packages/core/src/communication/axl-client.ts
packages/core/src/communication/agent-coordinator.ts
packages/demo-agent/src/index.ts
packages/demo-agent/scripts/run-demo.ts
packages/dashboard/src/app/page.tsx
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript + Node.js 20+ |
| Package manager | pnpm workspace |
| Module format | ESM |
| Framework package | `@zero-agents/core` |
| Storage / tool memory | 0G Storage via `@0gfoundation/0g-ts-sdk` |
| Inference / compute | 0G Compute via `@0glabs/0g-serving-broker`, OpenAI fallback |
| Agent identity | ENS via `viem` |
| Agent communication | Gensyn AXL local HTTP API |
| Tool sandbox | `isolated-vm` by default, explicit unsafe Node `vm` fallback |
| Dashboard | Next.js 14 + React 18 |

---

## Implemented Core Package

Package: `packages/core`

Manifest status:

- Name: `@zero-agents/core`
- Version: `0.1.0`
- Runtime: Node.js `>=20`
- Main export: `@zero-agents/core`
- Secondary export: `@zero-agents/core/storage/zero-g`
- License: MIT
- Maturity: alpha

Primary exports from `packages/core/src/index.ts`:

- `SelfEvolvingAgent`
- `EvolutionEngine`
- `StrategyAdapter`
- `ToolRegistry`
- `ExperienceMemory`
- `ToolGenerator`
- `ToolImprover`
- `ToolSandbox`
- `ToolEvaluator`
- `ReflectionEngine`
- `ENSIdentityManager`
- `AXLClient`
- `AgentCoordinator`
- framework error classes and public types

Example developer usage:

```ts
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'research-agent.eth',
  description: 'Research agent that learns reusable tools',
  capabilities: ['research', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,
  axlEnabled: false,
});

agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

const result = await agent.handleTask({
  description: 'Fetch the current ETH price and return it as a number',
});
```

The agent also supports `run(task: string | TaskRequest)`.

---

## Implemented Agent Loop

Current base flow in `SelfEvolvingAgent`:

```text
TaskRequest
-> ToolRegistry.searchTools()
-> ExperienceMemory.findSimilarExperiences()
-> StrategyAdapter.selectStrategy()
-> reuse existing tool OR generate new tool OR improve failed tool OR reject
-> ToolSandbox.run()
-> ReflectionEngine.reflect()
-> ExperienceMemory.saveExperience()
-> TaskResult
```

When no reusable tool exists, `EvolutionEngine` handles:

```text
generate tool
-> sandbox smoke run
-> evaluate
-> retry with feedback up to maxGenerationAttempts
-> save passing tool
```

Current event types emitted through `agent.on('step', ...)`:

```text
search
miss
strategy
generating
sandboxing
evaluating
saving
executing
reflecting
done
error
```

---

## Core Concepts In Code

### Tool

Tools are persisted executable capabilities with metadata. The tool model lives in `packages/core/src/storage/tool-registry.ts`.

Expected shape:

```ts
interface Tool {
  id: string;
  name: string;
  description: string;
  code: string;
  schema: { input: object; output: object };
  tags: string[];
  successRate: number;
  usageCount: number;
  createdAt: number;
  rootHash?: string;
}
```

### Experience Memory

`ExperienceMemory` stores task outcomes separately from tools.

Default persistence path: `.zero-agent-experiences.json`.

Experience records include task, strategy, tool used, result summary, quality score, reflection, metadata, and optional storage hash.

### Strategy Adapter

`StrategyAdapter` deterministically selects one of:

- `reuse_existing_tool`
- `generate_new_tool`
- `improve_existing_tool`
- `ask_another_agent`
- `reject_task`

### Reflection Engine

`ReflectionEngine` produces deterministic post-task learning data without an external API.

It records whether the task succeeded, quality score, what worked, what failed, whether improvement is needed, a memory note, and recommended future strategy.

### Tool Improver

`ToolImprover` can create an improved tool candidate from a failed existing tool. The base agent only saves improved tools after sandboxing and evaluation pass.

---

## Sponsor Integrations

### 0G Storage

- Implemented through `ToolRegistry` and `storage/zero-g.ts`.
- Stores generated and improved tools as JSON blobs.
- Default testnet RPC: `https://evmrpc-testnet.0g.ai`.
- Default indexer: `https://indexer-storage-testnet-turbo.0g.ai`.
- Local pointer file: `.zero-agent-index.json`.
- Requires `ZERO_G_PRIVATE_KEY` for live uploads.

### 0G Compute

- Implemented in `ToolGenerator`.
- First attempts 0G Compute through `@0glabs/0g-serving-broker`.
- Falls back to OpenAI `gpt-4o-mini` if `OPENAI_API_KEY` is configured.
- Without 0G or OpenAI credentials, the base framework cannot generate new tools.

### ENS Identity

- Implemented in `ENSIdentityManager`.
- Uses ENS text records on Sepolia.
- Reads and writes description, capabilities, `zeroagent.toolRegistry`, `zeroagent.axlPeerId`, and URL.
- ENS writes require a wallet that controls the ENS name and has Sepolia ETH.

### Gensyn AXL

- Implemented through `AXLClient` and `AgentCoordinator`.
- Default local port: `9002`.
- Supports task requests, task results, tool sharing, and ping messages.
- Real P2P requires a local AXL node. The demo agent can simulate fallback transport when AXL is unavailable.

---

## Demo Agent

Package: `packages/demo-agent`

The demo exports `ResearchAgent`, a concrete agent built on `SelfEvolvingAgent`.

It demonstrates:

- first-run tool creation through real LLM generation when keys exist
- offline fallback tool when keys are missing
- sandbox testing and evaluation
- offline demo storage with deterministic `offline-0g-...` hashes when no 0G key exists
- tool reuse on later runs
- experience memory and strategy selection
- reflection metadata in task results
- simulated AXL fallback when no local AXL node is running

Run the demo:

```bash
pnpm --filter @zero-agents/demo-agent demo
```

Expected demo behavior:

- First matching task selects `generate_new_tool`.
- Later matching task selects `reuse_existing_tool`.
- Results include strategy metadata, reflection, and experience IDs.
- AXL is real only if local AXL and peer identity are configured; otherwise it is explicitly simulated.

---

## Dashboard

Package: `packages/dashboard`

The dashboard is currently a static/minimal readiness console, not a live event stream yet.

Current UI states shown in `packages/dashboard/src/app/page.tsx`:

- framework maturity: Alpha
- reusable package focus: Core
- default developer mode: Local
- build checks for core package, offline agent integration, sponsor paths, sandboxing, and dashboard limitations
- loading, empty, and error states for a future event stream

---

## Environment Variables

Current `.env.example` variables:

```env
ZERO_G_PRIVATE_KEY=your_private_key_here
OPENAI_API_KEY=your_openai_key_here
ENS_PRIVATE_KEY=your_ens_owner_private_key_here
ENS_NAME=my-agent.eth
SEPOLIA_RPC_URL=https://sepolia.drpc.org
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Core source directly reads:

- `ZERO_G_PRIVATE_KEY`
- `OPENAI_API_KEY`

ENS-specific values are used by scripts/demo setup or passed explicitly into `ENSIdentityManager`.

Never commit real secrets from `.env`.

---

## Root Commands

From repository root:

```bash
pnpm build
pnpm dev
pnpm validate:framework
pnpm test:evolution
pnpm test:unit
pnpm test:agent
pnpm test:storage
pnpm test:live
```

Command meanings:

- `pnpm build` builds core, demo-agent, and dashboard.
- `pnpm validate:framework` validates the built core package install path.
- `pnpm test:evolution` runs local evolution module checks.
- `pnpm test:unit` runs the core unit test files.
- `pnpm test:agent` builds core and runs the agent test script.
- `pnpm test:storage` runs live 0G storage upload/download checks.
- `pnpm test:live` runs storage, ENS, and live two-run agent checklist with credentials.

Core package commands:

```bash
pnpm --filter @zero-agents/core build
pnpm --filter @zero-agents/core validate:install
pnpm --filter @zero-agents/core test:unit
```

Demo package commands:

```bash
pnpm --filter @zero-agents/demo-agent build
pnpm --filter @zero-agents/demo-agent demo
```

Dashboard commands:

```bash
pnpm --filter @zero-agents/dashboard dev
pnpm --filter @zero-agents/dashboard build
```

---

## Current Status

**Project phase:** Implemented alpha, not Day 0.

Completed or present in the codebase:

- pnpm monorepo is set up.
- `@zero-agents/core` exists and builds from TypeScript into `dist`.
- Core agent orchestration exists through `SelfEvolvingAgent`.
- Tool registry, 0G storage wrapper, 0G/OpenAI tool generation, sandbox, evaluator, reflection, experience memory, strategy adapter, tool improver, ENS identity manager, AXL client, and coordinator are implemented.
- Demo `ResearchAgent` exists with offline fallback behavior for reliable local demos.
- Next.js dashboard package exists as a readiness console.
- Validation and integration scripts exist under `scripts/`.

Known limitations:

- APIs are alpha and may change.
- Full live tool generation needs 0G Compute or OpenAI credentials.
- Real permanent tool persistence needs `ZERO_G_PRIVATE_KEY` and 0G testnet access.
- Real ENS writes need Sepolia gas and control of the ENS name.
- Real AXL collaboration needs a local AXL node and peer identity setup.
- Dashboard is not yet wired to a live event stream.
- Demo offline fallback is for reliability; it is not proof of live 0G persistence or live LLM generation.
- Node `vm` fallback is unsafe for hostile code and must stay opt-in.

---

## Rules For This Project

1. Wait for the task. Do not start building something until explicitly told to.
2. One task at a time. Complete the given task fully, then stop.
3. No extra files unless the task requires them.
4. No extra packages unless the task requires them.
5. No unrelated refactors.
6. No assumptions about next steps.
7. Ask before guessing if a task is ambiguous.
8. Keep TypeScript strict and avoid `any` unless necessary.
9. Any test or demo script you touch must actually run without errors.
10. Keep code commit-ready.
11. Do not claim sponsor integrations are live unless the relevant live command was run successfully with credentials.
12. Preserve local/offline fallback labeling; do not present simulated 0G, ENS, or AXL behavior as real network behavior.

---

## Next Task

Waiting for developer instruction.
