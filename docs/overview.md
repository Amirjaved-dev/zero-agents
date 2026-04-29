# ZeroAgent Framework — Overview

ZeroAgent is a TypeScript framework for building **self-evolving AI agents** — agents that generate their own tools on demand, store them on a decentralized network (0G Storage), and share them peer-to-peer with other agents (via Gensyn AXL).

---

## What It Solves

Traditional agents are static: they ship with a fixed tool set. ZeroAgent agents are dynamic:

1. Agent receives a task it has no tool for.
2. Agent calls an LLM (0G Compute or OpenAI) to generate a JS function for that task.
3. The function is executed in an isolated sandbox and evaluated against auto-generated test cases.
4. If it passes (score ≥ 0.7), it is uploaded to **0G Storage** and indexed.
5. On future identical (or similar) tasks, the tool is retrieved from the registry — no regeneration needed.
6. Other agents can discover and import the tool via **AXL** (Gensyn peer-to-peer network).
7. Each agent's identity, capabilities, and tool registry pointer live on-chain in **ENS** text records.

---

## Package Layout

```
packages/
  core/          # @zero-agents/core — the framework library
  demo-agent/    # @zero-agents/demo-agent — example implementation
  dashboard/     # Next.js UI for visualizing agent activity
scripts/         # Integration test runners
  local-axl/       # Optional local Gensyn AXL checkout, if present
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        SelfEvolvingAgent                         │
│                                                                  │
│  handleTask()                                                    │
│    │                                                             │
│    ├─ ToolRegistry.searchTools()  ──► local/0G tool index       │
│    ├─ ExperienceMemory.findSimilarExperiences()                 │
│    ├─ StrategyAdapter.selectStrategy()                          │
│    │                                                             │
│    ├─ [cache miss] EvolutionEngine.evolve()                      │
│    │     ├─ ToolGenerator   ──► 0G Compute / OpenAI             │
│    │     ├─ ToolSandbox     ──► isolated-vm / Node.js vm        │
│    │     ├─ ToolEvaluator   ──► OpenAI test cases / smoke test  │
│    │     └─ ToolRegistry.saveTool() ──► local/0G storage        │
│    │                                                             │
│    └─ ToolSandbox.run()  ──► returns output                     │
│          └─ ReflectionEngine + ExperienceMemory save learning   │
│                                                                  │
│  publishProfile()  ──► ENSIdentityManager ──► ENS text records  │
│  collaborateWith() ──► AXLClient ──► Gensyn AXL P2P             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `SelfEvolvingAgent` | `packages/core/src/self-evolving-agent.ts` | Main agent class, orchestrates everything |
| `EvolutionEngine` | `packages/core/src/evolution-engine.ts` | Retry loop: generate → sandbox → evaluate → save |
| `ToolGenerator` | `packages/core/src/generation/tool-generator.ts` | LLM prompt → Tool code |
| `ToolSandbox` | `packages/core/src/sandbox/tool-sandbox.ts` | Isolated execution of generated code |
| `ToolEvaluator` | `packages/core/src/sandbox/tool-evaluator.ts` | LLM test generation + scoring |
| `ToolRegistry` | `packages/core/src/storage/tool-registry.ts` | Local index + 0G Storage CRUD |
| `ExperienceMemory` | `packages/core/src/memory/experience-memory.ts` | Local task experience records |
| `StrategyAdapter` | `packages/core/src/evolution/strategy-adapter.ts` | Deterministic strategy selection before acting |
| `ReflectionEngine` | `packages/core/src/reflection/reflection-engine.ts` | Deterministic post-task learning summary |
| `ToolImprover` | `packages/core/src/tools/tool-improver.ts` | Generates improved tool candidates after failures |
| `ENSIdentityManager` | `packages/core/src/identity/ens-identity-manager.ts` | On-chain identity via ENS text records |
| `AXLClient` | `packages/core/src/communication/axl-client.ts` | P2P messaging over Gensyn AXL |
| `AgentCoordinator` | `packages/core/src/communication/agent-coordinator.ts` | Routes inbound AXL messages to handlers |

---

## Tool Lifecycle

```
Task Description
     │
     ▼
ToolRegistry.searchTools(query)
     │
     ├── [found, successRate > 0.5] ──► ToolSandbox.run(tool.code, params)
     │
     └── [not found or low quality]
           │
           ▼
     EvolutionEngine (up to 3 attempts)
           │
           ├── ToolGenerator.generateTool(prompt)  [LLM call]
           ├── ToolSandbox.run(code, sampleParams) [syntax/runtime check]
           ├── ToolEvaluator.evaluate(tool)        [score ≥ 0.7?]
           │     └── if failed: add error feedback to next prompt
           │
           └── ToolRegistry.saveTool(tool)
                 ├── uploadToZeroG(tool)     → rootHash
                 └── updateIndex()           → new index rootHash → .zero-agent-index.json
```

---

## Sponsor Integrations

| Sponsor | How Used |
|---------|----------|
| **0G Storage** | Tool bodies and the tool index are stored as content-addressed blobs. Local `.zero-agent-index.json` holds the current index root hash. |
| **0G Compute** | Primary LLM backend for tool generation. Discovers available "chatbot" providers via the serving broker and calls `/chat/completions`. Falls back to OpenAI if unavailable. |
| **ENS (Ethereum Name Service)** | Each agent has an ENS name (e.g. `my-agent.eth`). Text records store the agent's description, capabilities list, tool registry hash, and AXL peer ID. |
| **Gensyn AXL** | P2P messaging layer. Agents send `task_request`, `task_result`, `tool_share`, and `ping` messages to each other by peer ID. AXLClient polls `/messages` every 500ms, with `/recv` fallback for older local AXL builds. |

---

## Event Model

`SelfEvolvingAgent` extends `EventEmitter`. Subscribe to the `'step'` event to observe progress:

```typescript
agent.on('step', (event: AgentStepEvent) => {
  console.log(event.type, event.message);
});
```

Event types that may be emitted across reuse, cache-miss, improvement, rejection, and failure paths:

```
search     → looking up registry
miss       → no matching tool found
strategy   → selecting behavior from tools and experience memory
generating → ToolGenerator called
sandboxing → running generated code
evaluating → ToolEvaluator scoring
saving     → saving a tool, index, or experience
executing  → running final tool
reflecting → recording post-task learning data
done       → TaskResult ready
error      → something failed
```

Do not depend on a strict sequence for every task. A reuse hit, rejected task, failed tool, or improvement path emits a different subset.

---

## Read Next

- [Getting Started](./getting-started.md) — Installation and first agent
- [Core Concepts](./core-concepts.md) — Tools, Tasks, and the Evolution Engine
- [API Reference](./api-reference.md) — All classes and types
- [Integrations](./integrations.md) — 0G, ENS, and AXL in detail
- [Examples](./examples.md) — Runnable code examples
