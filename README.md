# ZeroAgent

**A memory-driven TypeScript framework for self-evolving agents.**

ZeroAgent is built around a simple idea: an agent should not treat every task as new. It should remember what happened, choose a strategy from prior experience, reuse or improve tools when possible, and store what it learned for the next run.

Current core loop:

```text
Task
-> Experience Memory
-> Strategy Adapter
-> Tool Reuse / Generation / Improvement
-> Execution
-> Reflection
-> Store Learning
-> Adapt Future Behavior
```

This repository contains the reusable framework package, a demo research agent, and a minimal Next.js dashboard package.

---

## What is ZeroAgent?

ZeroAgent is a TypeScript framework for building agents that can change their own capability surface at runtime.

A `SelfEvolvingAgent` can:

- search for an existing tool
- inspect similar past task experiences
- select a task strategy before acting
- generate a new tool when no useful tool exists
- execute tools in a sandbox
- reflect on the result
- save a structured experience record
- attempt a lightweight tool improvement when an existing tool fails
- publish agent identity data through ENS
- communicate with other agents through Gensyn AXL when a local AXL node is available

ZeroAgent is not a hosted agent service and it is not a single demo bot. The main artifact is `@zero-agents/core`, a framework package intended to be embedded in other agent applications.

---

## Why static agents fail

Most agents ship with a fixed set of tools. That works until the task does not fit the tool list.

Then the agent usually does one of three things:

- fails outright
- hallucinates an answer without the right capability
- asks a developer to add another tool and redeploy

That model does not compound. A static agent can have memory of conversations, but not memory of operational experience: which strategy worked, which tool failed, what should be reused, and what should be improved.

ZeroAgent separates tool memory from experience memory. Tools are executable capabilities. Experiences are structured records of what happened when the agent tried to solve a task. The strategy layer uses both.

---

## Self-evolving loop

The implemented base agent flow is:

1. Receive a `TaskRequest` through `handleTask()` or `run()`.
2. Search `ToolRegistry` for candidate tools.
3. Search `ExperienceMemory` for similar prior tasks.
4. Call `StrategyAdapter.selectStrategy()`.
5. Act on the selected strategy:
   - `reuse_existing_tool`: prefer the selected existing tool.
   - `generate_new_tool`: use the existing `EvolutionEngine` generation path.
   - `improve_existing_tool`: currently falls back to generation before execution; failed existing tools can trigger `ToolImprover`.
   - `ask_another_agent`: currently falls back to generation if no AXL delegation path is available in that run.
   - `reject_task`: return a structured rejection result.
6. Execute the selected or generated tool.
7. If an existing tool fails, attempt a lightweight improvement path.
8. Reflect on the result with `ReflectionEngine`.
9. Save an `ExperienceRecord` locally through `ExperienceMemory`.
10. Return output plus metadata: strategy, confidence, reflection, experience ID, and whether improvement happened.

Normal reuse/generation behavior remains intact. The memory and strategy layers guide the flow but do not require every task to go through improvement.

---

## Architecture

```text
packages/core
  SelfEvolvingAgent
    |-- ToolRegistry          0G-backed tool index and tool storage
    |-- ExperienceMemory      local JSON task experience memory
    |-- StrategyAdapter       deterministic pre-task strategy selection
    |-- EvolutionEngine       generate -> sandbox -> evaluate -> save
    |-- ToolImprover          improve failed existing tools
    |-- ToolSandbox           isolated-vm with Node vm fallback
    |-- ToolEvaluator         sandbox-based scoring, optional OpenAI test cases
    |-- ReflectionEngine      deterministic post-task learning data
    |-- ENSIdentityManager    ENS text record identity
    |-- AXLClient             local Gensyn AXL HTTP client
    |-- AgentCoordinator      AXL message routing and tool sharing
```

The base `SelfEvolvingAgent` is the reference composition. Most modules are exported independently so framework users can replace or call them directly.

---

## ReflectionEngine

`ReflectionEngine` turns a completed or failed task attempt into structured learning data.

It is deterministic and does not call an external API.

Output includes:

- `success`
- `qualityScore` from `0` to `100`
- `whatWorked`
- `whatFailed`
- `improvementNeeded`
- `memoryNote`
- `recommendedStrategy`

Rules implemented today:

- result with no error means success
- any error means failure
- failed runs require improvement
- quality scoring is simple and deterministic

`SelfEvolvingAgent` uses this after task execution and also records failed runs before rethrowing or returning a graceful tool error.

---

## ExperienceMemory

`ExperienceMemory` stores task experiences separately from tools.

An `ExperienceRecord` includes:

- `id`
- `agentName`
- `task`
- `strategy`
- `toolUsed`
- `resultSummary`
- `success`
- `qualityScore`
- `reflection`
- `createdAt`
- `storageHash`
- `metadata`

Default persistence is a local JSON file, `.zero-agent-experiences.json`. That is intentional: the demo and local development should work without a funded wallet or live storage network.

Optional best-effort 0G upload support exists in the module, but the integrated agent path uses local JSON by default. Tool registry state is not mutated by experience memory.

Public methods:

```ts
saveExperience(experience)
listExperiences(agentName?)
findSimilarExperiences(task, limit?)
clearExperiences()
```

---

## StrategyAdapter

`StrategyAdapter` chooses a pre-task strategy from available tools and similar experiences.

It is deterministic and does not call external APIs.

Strategies:

- `reuse_existing_tool`
- `generate_new_tool`
- `improve_existing_tool`
- `ask_another_agent`
- `reject_task`

Current behavior:

- high-quality successful similar experience with a tool prefers reuse
- failed similar experience with the same tool prefers improvement
- no useful tool or experience prefers generation
- the base agent falls back safely when a selected strategy cannot be completed directly

`TaskResult` includes:

```ts
strategy?: StrategyName
strategyReason?: string
confidence?: number
```

---

## ToolImprover

`ToolImprover` creates an improved tool candidate from an existing failed tool.

It uses an injected `ToolGenerator`-compatible object. If no generator is configured, it throws a clear configuration error. The module does not save or evaluate by itself.

The base `SelfEvolvingAgent` now uses it lightly:

1. An existing tool fails during execution.
2. The agent logs `Improvement needed...`.
3. The agent calls `ToolImprover.improveTool()`.
4. The improved candidate is evaluated with `ToolEvaluator` and `ToolSandbox`.
5. If evaluation passes, the improved version is saved through `ToolRegistry`.
6. The improved tool is executed.
7. The result includes `wasImproved: true`.

If improvement generation, evaluation, saving, or execution fails, the agent keeps the original tool and returns a graceful structured error for that run. It does not silently replace tools with untested code.

The demo `ResearchAgent` has its own override for the showcase flow. The base framework improvement path is implemented in `SelfEvolvingAgent`.

---

## 0G integration

ZeroAgent uses 0G in two places.

### 0G Storage

`ToolRegistry` stores generated and improved tools as JSON blobs through `@0gfoundation/0g-ts-sdk`.

Implemented storage behavior:

- `saveTool(tool)` uploads the tool to 0G and updates a tool index
- `getTool(rootHash)` downloads a tool by root hash
- `searchTools(query)` searches cached index metadata and downloads matches
- `.zero-agent-index.json` stores the current index root hash pointer

Default testnet endpoints:

```text
0G EVM RPC: https://evmrpc-testnet.0g.ai
0G Indexer: https://indexer-storage-testnet-turbo.0g.ai
```

The demo agent has an offline storage fallback that creates deterministic `offline-0g-...` hashes when no `ZERO_G_PRIVATE_KEY` is present. That fallback is for local demo reliability; it is not real 0G persistence.

### 0G Compute

`ToolGenerator` first attempts to use `@0glabs/0g-serving-broker` to locate an available chatbot provider and call its OpenAI-compatible `/chat/completions` endpoint.

If 0G Compute is unavailable and `OPENAI_API_KEY` is configured, it falls back to OpenAI `gpt-4o-mini`.

If neither is configured, base framework tool generation cannot generate new tools. The demo agent has a built-in offline fallback tool for the showcase only.

---

## ENS identity

`ENSIdentityManager` implements agent identity through ENS text records on Sepolia.

It can read and write:

| Text record | Purpose |
|---|---|
| `description` | Human-readable agent description |
| `capabilities` | JSON array of capabilities |
| `zeroagent.toolRegistry` | 0G root hash for the agent's tool index |
| `zeroagent.axlPeerId` | Gensyn AXL peer ID |
| `url` | Project or service URL |

ENS is optional at runtime. `SelfEvolvingAgent` accepts any `AgentIdentityProvider`, so tests and demos can use an in-memory provider.

ENS writes require a wallet that controls the ENS name and has Sepolia ETH for gas.

---

## Gensyn AXL communication

ZeroAgent includes a local HTTP client for Gensyn AXL.

Implemented pieces:

- `AXLClient` talks to a local AXL HTTP API, default port `9002`
- `AgentCoordinator` polls for messages and routes task requests to `handleTask()`
- supported message types: `task_request`, `task_result`, `tool_share`, `ping`
- `collaborateWith(ensName, task)` resolves a peer ID through the configured identity provider and sends a task

AXL must be running locally for real P2P transport. The demo falls back to direct in-process simulation when AXL is unavailable, and it labels that mode explicitly.

---

## Installation

Requirements:

- Node.js 20+
- pnpm
- a funded wallet only for live 0G Storage or ENS writes

Clone and build:

```bash
git clone https://github.com/Amirjaved-dev/zero-agents.git
cd zero-agents
pnpm install
pnpm build
```

Package consumers can install the core package when published:

```bash
npm install @zero-agents/core
```

Native dependency note: `isolated-vm` is used when available. If it cannot load, `ToolSandbox` falls back to Node's `vm` module. The fallback is useful for development but should not be treated as a strong security boundary for hostile code.

---

## Quickstart

```ts
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'research-agent',
  description: 'Research agent that learns from task experience',
  capabilities: ['research', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,
  axlEnabled: false,
});

agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

const result = await agent.run({
  description: 'Fetch the current ETH price and return it as a number',
});

console.log(result.output);
console.log(result.strategy);
console.log(result.reflection?.memoryNote);
console.log(result.experienceId);
```

Expected metadata on a successful run:

```ts
result.strategy        // selected strategy
result.strategyReason  // why that strategy was selected
result.confidence      // 0 to 1
result.reflection      // structured learning data
result.experienceId    // local experience record id
result.wasGenerated    // true if a new tool was generated
result.wasImproved     // true if a failed existing tool was improved and used
```

For local checks that do not require 0G or LLM credentials:

```bash
pnpm test:evolution
```

---

## Example agent

The demo package contains `ResearchAgent`, a concrete agent used for the project demo.

It demonstrates:

- first-run tool creation through an offline fallback when no keys are configured
- sandbox testing and evaluation
- offline demo storage when no `ZERO_G_PRIVATE_KEY` exists
- experience memory and strategy selection
- reflection records in returned results
- simulated AXL fallback when no local AXL node is running

Run it:

```bash
pnpm --filter @zero-agents/demo-agent demo
```

Expected behavior:

- first run selects `generate_new_tool`
- second run selects `reuse_existing_tool`
- returned results include strategy metadata, reflection, and experience IDs
- AXL transport is real only if a local AXL node and peer identity are available; otherwise the demo uses simulation

---

## Environment variables

| Variable | Required | Used by |
|---|---|---|
| `ZERO_G_PRIVATE_KEY` | Required for live 0G Storage and 0G Compute | `ToolRegistry`, `ToolGenerator` |
| `OPENAI_API_KEY` | Optional fallback | `ToolGenerator`, `ToolEvaluator` test generation |
| `ENS_PRIVATE_KEY` | Required for ENS writes | `ENSIdentityManager`, demo real ENS mode |
| `ENS_NAME` | Optional | demo real ENS mode |
| `SEPOLIA_RPC_URL` | Optional | ENS manager custom RPC |
| `NEXT_PUBLIC_APP_URL` | Optional | demo identity URL text record |

Without `ZERO_G_PRIVATE_KEY`, the base framework cannot persist tools to 0G. The demo still runs through an offline storage path so reviewers can see the full control flow locally.

---

## Package structure

```text
zero-agents/
  packages/
    core/
      src/
        self-evolving-agent.ts
        evolution-engine.ts
        evolution/strategy-adapter.ts
        reflection/reflection-engine.ts
        memory/experience-memory.ts
        tools/tool-improver.ts
        generation/tool-generator.ts
        sandbox/tool-sandbox.ts
        sandbox/tool-evaluator.ts
        storage/tool-registry.ts
        storage/zero-g.ts
        identity/ens-identity-manager.ts
        communication/axl-client.ts
        communication/agent-coordinator.ts
    demo-agent/
      src/index.ts
      scripts/run-demo.ts
    dashboard/
      src/app/
  scripts/
    test-evolution-modules.ts
    test-agent.ts
    test-storage.ts
    test-ens-identity.ts
```

Root commands:

```bash
pnpm build
pnpm test:evolution
pnpm test:unit
pnpm test:agent      # live 0G path when credentials are present
pnpm test:storage    # live 0G upload/download
```

---

## Sponsor alignment

### 0G

0G Storage is the live persistence layer for generated and improved tools. 0G Compute is the first attempted LLM provider for tool generation before OpenAI fallback.

### ENS

ENS provides public agent identity: description, capabilities, tool registry pointer, AXL peer ID, and URL.

### Gensyn AXL

AXL is the P2P transport layer for task delegation and tool sharing when a local AXL node is running.

The implementation does not claim these networks are always available. The framework has explicit local/demo fallbacks where needed, and those fallbacks are labeled.

---

## Known limitations

- Tool generation depends on LLM quality and provider availability.
- `ToolEvaluator` uses simple sandbox execution and a `0.7` pass threshold; nuanced tasks may need custom tests.
- `ExperienceMemory` is local JSON by default. It is reliable for demos and local use, but not a multi-writer database.
- The improvement path is intentionally conservative. It only saves improved tools after evaluation passes.
- Node `vm` fallback is not a hard security boundary. Use process/container isolation for untrusted production workloads.
- Real AXL requires a local AXL node. The demo uses in-process simulation if AXL is unavailable.
- Real ENS writes require Sepolia gas and control of the target ENS name.
- Dashboard currently builds but is still minimal/static.
- The demo agent has an offline fallback tool for reliability; that is not the same as live LLM generation.

---

## Roadmap

Near term:

- richer dashboard event stream for strategy, reflection, and memory
- explicit tests for the improvement path in the repo test suite
- configurable strategy thresholds
- configurable evaluation test cases per agent domain
- stronger process-level sandbox option for production deployments

Framework direction:

- 0G-backed experience memory, not just local JSON
- first-class tool version history and rollback
- deeper ToolImprover integration for post-success low-quality reflections
- ENS-based agent discovery by capability
- real AXL multi-agent examples beyond local simulation
- CLI scaffold for new agents

---

## License

MIT

---

## Built for

ETHGlobal Open Agents 2026.

Sponsor integrations: 0G Storage + Compute, ENS identity, Gensyn AXL communication.
