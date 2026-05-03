<p align="center">
  <h1 align="center">ZeroAgent</h1>
  <p align="center"><strong>ENS-native self-evolving agent framework</strong></p>
  <p align="center">
    <em>Agents that start with zero tools, generate them on demand, store them permanently on-chain, and reuse them across tasks and networks.</em>
  </p>
</p>

<p align="center">
  <a href="#installation">Install</a> &bull;
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#sponsor-integrations">Sponsors</a> &bull;
  <a href="#license">License</a>
</p>

---

## The Problem

Most AI agents ship with a **fixed set of tools**. When a task doesn't fit the tool list, the agent either fails, hallucinates, or waits for a developer to redeploy. That model doesn't compound — it has no memory of *operational experience*.

## The Solution

**ZeroAgent** separates tool memory from experience memory. Tools are executable capabilities stored permanently on-chain via [0G Storage](#0g-storage). Experiences are structured records of what happened when the agent tried to solve a task. A deterministic strategy layer uses both to decide: *reuse*, *generate*, *improve*, *delegate*, or *reject* — before spending a single token.

```
Task → Search Tools → Recall Experience → Select Strategy → Execute → Reflect → Learn
```

The main artifact is **`@zero-agents/core`** — a reusable TypeScript framework package, not a hosted bot or single demo. Import it and build your own self-evolving agents.

---

## Quickstart

```bash
git clone https://github.com/Amirjaved-dev/zero-agents.git
cd zero-agents
pnpm install
pnpm build
```

### Run the Demo Agent

```bash
pnpm --filter @zero-agents/demo-agent demo
```

First run generates a new tool. Second run reuses it. No credentials required for the offline demo path.

### Use in Your Own Project

```ts
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'research-agent.eth',
  description: 'Research agent that learns reusable tools',
  capabilities: ['research', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY,
  openAiKey: process.env.OPENAI_API_KEY,
  axlEnabled: false,
});

agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

const result = await agent.handleTask({
  description: 'Fetch the current ETH price and return it as a number',
});

console.log(result.output);          // task output
console.log(result.strategy);        // which strategy was selected
console.log(result.reflection?.memoryNote);
console.log(result.experienceId);   // persisted experience record
```

---

## Architecture

```
packages/core/
├── SelfEvolvingAgent         Main orchestrator — wires everything together
├── EvolutionEngine            Generate → sandbox → evaluate → retry → save loop
├── StrategyAdapter            Deterministic pre-task strategy selection
├── ToolRegistry               0G-backed tool index and persistent storage
├── ExperienceMemory           Local JSON task experience memory
├── ToolGenerator              LLM-powered tool generation (0G Compute → OpenAI)
├── ToolImprover               Improve failed existing tools
├── ToolSandbox                isolated-vm execution (Node vm fallback)
├── ToolEvaluator              Sandbox-based scoring with LLM test cases
├── ReflectionEngine           Deterministic post-task learning data
├── ENSIdentityManager         ENS text record identity on Sepolia
├── AXLClient                  Gensyn AXL local HTTP client
└── AgentCoordinator           AXL message routing & tool sharing
```

All modules are exported independently — use `SelfEvolvingAgent` as the reference composition, or import individual modules and build your own stack.

### Agent Loop

| Step | Module | Action |
|------|--------|--------|
| 1 | `ToolRegistry` | Search for candidate tools matching the task |
| 2 | `ExperienceMemory` | Find similar past experiences |
| 3 | `StrategyAdapter` | Choose strategy: `reuse` / `generate` / `improve` / `delegate` / `reject` |
| 4 | `EvolutionEngine` | Generate new tool (or reuse/improve existing) |
| 5 | `ToolSandbox` | Execute tool in isolated environment |
| 6 | `ToolEvaluator` | Score tool output (pass threshold ≥ 0.7) |
| 7 | `ReflectionEngine` | Produce deterministic learning metadata |
| 8 | `ExperienceMemory` | Save structured experience record |
| 9 | Return | Output + strategy, confidence, reflection, experience ID |

### Strategy Adapter

Deterministic, no external API calls. Selects from:

| Strategy | When |
|----------|------|
| `reuse_existing_tool` | High-quality successful similar experience with a matching tool |
| `generate_new_tool` | No useful tool or experience found |
| `improve_existing_tool` | Failed similar experience with the same tool |
| `ask_another_agent` | Task delegation available via AXL |
| `reject_task` | Task cannot be handled |

---

## Core Modules

<details>
<summary><strong>ToolRegistry & 0G Storage</strong></summary>

Tools are persisted as JSON blobs on [0G Storage](https://0g.ai) via `@0gfoundation/0g-ts-sdk`. Each tool includes code, schema, tags, success rate, usage count, and an immutable root hash.

- `saveTool(tool)` — upload to 0G, update index
- `getTool(rootHash)` — download by hash
- `searchTools(query)` — search cached index metadata
- Local index pointer stored in `.zero-agent-index.json`

Offline fallback produces deterministic `offline-0g-...` hashes for local development without credentials.

</details>

<details>
<summary><strong>ExperienceMemory</strong></summary>

Stores task outcomes separately from tools. Each record includes: task, strategy, tool used, result summary, quality score (0–100), reflection, timestamps, and optional storage hash.

Persists to `.zero-agent-experiences.json` by default — works locally without any wallet or network connection.

```ts
experienceMemory.saveExperience(record);
experienceMemory.findSimilarExperiences(task, limit?);
experienceMemory.listExperiences(agentName?);
```

</details>

<details>
<summary><strong>ReflectionEngine</strong></summary>

Turns completed or failed tasks into structured learning data. Fully deterministic — no external API calls.

Output: `success`, `qualityScore` (0–100), `whatWorked`, `whatFailed`, `improvementNeeded`, `memoryNote`, `recommendedStrategy`.

</details>

<details>
<summary><strong>ToolImprover</strong></summary>

Creates improved tool candidates from failed existing tools. Uses an injected `ToolGenerator`-compatible object. The base agent only saves improved tools after they pass sandbox evaluation — never silently replaces tools with untested code.

Flow: existing tool fails → generate improvement candidate → sandbox evaluate → save if passing → execute improved version → return `wasImproved: true`.

</details>

<details>
<summary><strong>ToolSandbox & Evaluator</strong></summary>

- **Sandbox**: Executes generated JavaScript in `isolated-vm` (secure) with explicit opt-in `node:vm` fallback for development
- **Evaluator**: Generates LLM-driven test cases, runs them in the sandbox, scores pass/fail. Threshold ≥ 0.7 required to save a tool

</details>

---

## Sponsors

<p align="center">
  <img src="https://img.shields.io/badge/0G-Storage_%26_Compute-black?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNmZmYiLz48dGV4dCB4PSIxMiIgeT0iMTYiIGZvbnQtc2l6ZT0iMTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtd2VpZ2h0PSJib2xkIj4wRzwvdGV4dD48L3N2Zz4=" alt="0G" />
  <img src="https://img.shields.io/badge/ENS-Agent_Identity-1a1a1a?style=for-the-badge&logo=ethereum" alt="ENS" />
  <img src="https://img.shields.io/badge/Gensyn_AXL-P2P_Communication-6c5ce7?style=for-the-badge" alt="Gensyn" />
</p>

ZeroAgent is built on top of three foundational protocols — each solving a critical piece of the self-evolving agent puzzle.

---

### [0G](https://0g.ai) — On-Chain Storage & Decentralized Compute

> **The permanent memory layer for agent-generated tools.**

0G is the backbone of ZeroAgent's persistence strategy. Every tool an agent generates or improves is stored as an immutable blob on 0G Storage — retrievable by content hash, forever.

**What ZeroAgent uses:**

| Integration | How It Works |
|-------------|--------------|
| **0G Storage** | `ToolRegistry` persists every generated/improved tool as a JSON blob with an immutable root hash |
| **0G Compute** | `ToolGenerator` routes tool-generation prompts through `@0glabs/0g-serving-broker` before falling back to OpenAI |

**Why it matters:** Tools aren't lost when a process restarts. They survive across agents, across sessions, across networks. The tool registry becomes a shared, immutable capability graph.

**Default testnet endpoints:**
- RPC: `https://evmrpc-testnet.0g.ai`
- Indexer: `https://indexer-storage-testnet-turbo.0g.ai`

---

### [ENS](https://ens.domains) — Decentralized Agent Identity

> **Your agent's passport on the open web.**

Agents need identities that work across networks — not just internal IDs. ENS gives every ZeroAgent a human-readable name (`research-agent.eth`) and a public profile that any other agent or human can look up.

**What ZeroAgent stores on ENS:**

| Text Record | Purpose |
|-------------|---------|
| `description` | What this agent does |
| `capabilities` | JSON array of skills (e.g. `["research", "summarization"]`) |
| `zeroagent.toolRegistry` | Content hash pointing to the agent's 0G tool index |
| `zeroagent.axlPeerId` | Gensyn AXL peer identifier for P2P routing |
| `url` | Dashboard or service endpoint |

**Key features:**
- Auto-detects ENS name from wallet address (no manual name lookup required)
- Fully optional at runtime — swap in any `AgentIdentityProvider` for testing
- Reads are free; writes require Sepolia ETH and control of the ENS name

**Why it matters:** Agent discovery shouldn't require a central registry. With ENS, any agent can look up another agent's capabilities, tool registry, and communication endpoint by name.

---

### [Gensyn AXL](https://gensyn.io) — Peer-to-Peer Agent Communication

> **Agents collaborating without a middleman.**

AXL (Agent eXchange Layer) is Gensyn's P2P protocol for agent-to-agent communication. ZeroAgent uses it for task delegation, result sharing, and cross-agent tool library exchange.

**What ZeroAgent implements:**

| Component | Role |
|-----------|------|
| `AXLClient` | HTTP client for local AXL node (default port `9002`) |
| `AgentCoordinator` | Polls incoming messages, routes `task_request` → `handleTask()`, shares tools via `tool_share` |
| Message types | `task_request`, `task_result`, `tool_share`, `ping` |

**How collaboration works:**
1. Agent A receives a task it can't handle alone
2. `StrategyAdapter` selects `ask_another_agent`
3. `AgentCoordinator` resolves peer's ENS name → AXL peer ID
4. Task request sent via AXL; peer responds with `task_result`
5. Tools discovered during collaboration can be imported into local `ToolRegistry`

**Graceful degradation:** When no local AXL node is running, the framework falls back to in-process simulation — always labeled explicitly as non-P2P mode.

**Why it matters:** The future of AI agents isn't single-player. AXL enables multi-agent workflows where specialists delegate to each other, share discovered tools, and compose capabilities dynamically.

---

## Package Structure

```
zero-agents/
├── packages/
│   ├── core/                    @zero-agents/core — framework package
│   │   └── src/
│   │       ├── self-evolving-agent.ts
│   │       ├── evolution-engine.ts
│   │       ├── evolution/strategy-adapter.ts
│   │       ├── reflection/reflection-engine.ts
│   │       ├── memory/experience-memory.ts
│   │       ├── tools/tool-improver.ts
│   │       ├── generation/tool-generator.ts
│   │       ├── sandbox/tool-sandbox.ts
│   │       ├── sandbox/tool-evaluator.ts
│   │       ├── storage/tool-registry.ts
│   │       ├── storage/zero-g.ts
│   │       ├── identity/ens-identity-manager.ts
│   │       ├── communication/axl-client.ts
│   │       └── communication/agent-coordinator.ts
│   ├── demo-agent/              @zero-agents/demo-agent — example ResearchAgent
│   │   ├── src/index.ts
│   │   └── scripts/run-demo.ts
│   └── dashboard/               @zero-agents/dashboard — Next.js monitoring console
│       └── src/app/page.tsx
├── scripts/                     Validation & integration tests
├── package.json                 Workspace root + CLI commands
├── pnpm-workspace.yaml
└── AGENTS.md                    Full project context for AI coding agents
```

## Available Commands

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build core, demo-agent, and dashboard |
| `pnpm dev` | Start all packages in watch mode |
| `pnpm validate:framework` | Validate built core package install path |
| `pnpm test:evolution` | Run evolution module checks (no credentials needed) |
| `pnpm test:unit` | Run core unit test suite |
| `pnpm test:agent` | Build core and run agent integration test |
| `pnpm test:storage` | Live 0G upload/download check |
| `pnpm test:live` | Full sponsor checklist (storage + ENS + two-run agent) |

## Environment Variables

| Variable | Required | Used By |
|----------|----------|---------|
| `ZERO_G_PRIVATE_KEY` | For live 0G Storage/Compute | `ToolRegistry`, `ToolGenerator` |
| `OPENAI_API_KEY` | Optional fallback LLM | `ToolGenerator`, `ToolEvaluator` |
| `ENS_PRIVATE_KEY` | For ENS writes | `ENSIdentityManager` |
| `ENS_NAME` | Optional | Demo ENS mode |
| `SEPOLIA_RPC_URL` | Optional | Custom ENS RPC |
| `NEXT_PUBLIC_APP_URL` | Optional | Dashboard / identity URL |

All integrations have offline/demo fallbacks. The framework works locally without any credentials.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ESM), Node.js 20+ |
| Runtime | `isolated-vm` sandboxing |
| Package manager | pnpm workspace |
| Storage | 0G Storage (`@0gfoundation/0g-ts-sdk`) |
| Inference | 0G Compute (`@0glabs/0g-serving-broker`) / OpenAI |
| Identity | ENS on Sepolia (`viem`) |
| Communication | Gensyn AXL (local HTTP) |
| Dashboard | Next.js 14 + React 18 |

---

## Known Limitations

- Tool generation quality depends on LLM provider availability and prompt engineering
- `ExperienceMemory` defaults to local JSON — not a multi-writer database
- `ToolEvaluator` uses a 0.7 pass threshold; nuanced domains may need custom test cases
- Node `vm` fallback is **not** a security boundary — use process isolation for untrusted workloads
- Real AXL requires a running local AXL node; real ENS writes require Sepolia ETH
- Dashboard is currently a static readiness console (event stream pending)
- Demo offline fallback is for local reliability — not proof of live persistence or generation

---

## Roadmap

**Near term**
- Dashboard event stream (strategy, reflection, memory visualization)
- Configurable strategy thresholds and evaluation test cases per domain
- Process-level sandbox option for production deployments
- Explicit improvement-path test coverage

**Framework direction**
- 0G-backed experience memory (beyond local JSON)
- Tool version history and rollback
- Deeper `ToolImprover` integration for post-success quality tuning
- ENS-based agent discovery by capability
- Real multi-agent AXL examples beyond local simulation
- CLI scaffold for bootstrapping new agents

---

## License

[MIT](LICENSE)

---

<p align="center">
  <strong>Built for</strong> <a href="https://ethglobal.com/events/openagents2026">ETHGlobal Open Agents 2026</a>
</p>

<p align="center">
  <a href="https://0g.ai"><b>0G</b></a> &mdash; On-Chain Storage &amp; Compute &nbsp;&bull;&nbsp;
  <a href="https://ens.domains"><b>ENS</b></a> &mdash; Decentralized Identity &nbsp;&bull;&nbsp;
  <a href="https://gensyn.io"><b>Gensyn AXL</b></a> &mdash; P2P Agent Communication
</p>
