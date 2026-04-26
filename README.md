# ZeroAgent

**A TypeScript framework for building self-evolving AI agents with persistent tool memory, ENS identity, and peer-to-peer coordination.**

> Agents that start with nothing, generate the tools they need, store them permanently on-chain, and reuse them across tasks and agent networks — without human intervention.

---

## The Problem

Every AI agent framework today ships agents with a fixed toolbox. If the task doesn't fit an existing tool, the agent fails, hallucinates, or asks for help. The only way to add capabilities is for a developer to write more code and redeploy.

This creates a ceiling: agents are only as capable as what was pre-built for them. They don't learn. They don't grow. They can't share what they discover.

There are three deeper problems:

**No persistent memory across deployments.** Tools generated at runtime vanish on restart. If an agent figures out how to call an API, that knowledge dies with the process.

**No portable identity.** Agents have no standard way to advertise capabilities, find each other, or establish provenance for the tools they share. They're anonymous and invisible to each other.

**No coordination layer.** Multi-agent systems require custom protocols. There's no standard for agent-to-agent task delegation, tool sharing, or capability discovery across network boundaries.

ZeroAgent addresses all three.

---

## What ZeroAgent Is

ZeroAgent is a framework — a set of composable primitives — for building agents that solve the three problems above.

At runtime, a ZeroAgent-powered agent:

1. Receives a task
2. Searches its tool registry for a matching tool
3. If none found: generates one using an LLM (0G Compute or OpenAI)
4. Runs the generated code in an isolated sandbox
5. Evaluates it against LLM-generated test cases (threshold: 0.7)
6. If it passes: stores it permanently on 0G Storage with a root hash
7. Executes the task with the new tool
8. On the next identical task: retrieves and reuses the stored tool — no generation required

The framework also handles:
- **ENS-backed agent identity** — each agent publishes its capabilities, tool registry hash, and AXL peer ID as ENS text records on Sepolia
- **Gensyn AXL peer-to-peer messaging** — agents send tasks and share tool libraries over the AXL P2P network
- **Cross-agent tool import** — agents can pull another agent's entire tool library by ENS name

This is not a single agent application. It's the infrastructure layer beneath agent applications.

---

## Demo

> Video walkthrough: *(link to demo video — add before submission)*

The demo runs a 12-step sequence showing an agent bootstrapping from zero tools to a working, reusable capability:

```
Step 1:  research-agent.eth created — empty tool library
Step 2:  Task arrives: "summarize trending AI agent news"
Step 3:  Registry search → MISS (no tools exist)
Step 4:  Tool generated: web_search_and_summarize
Step 5:  Sandbox test: code runs in isolated-vm
Step 6:  Evaluation: LLM test cases run, score >= 0.7
Step 7:  Tool saved → 0G Storage root hash recorded
Step 8:  Task executed → result returned (wasGenerated: true)

Step 9:  Same task arrives again
Step 10: Registry search → HIT (tool cached)
         Tool reused (wasGenerated: false) ← proof of learning

Step 11: planner-agent.eth created
         Imports tool library from research-agent.eth

Step 12: planner-agent.eth delegates task to research-agent.eth over AXL
         research-agent.eth executes and returns result
```

Run it:

```bash
cd packages/demo-agent
pnpm demo
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Application Layer                               │
│   Your Agent (extends SelfEvolvingAgent)                     │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│              SelfEvolvingAgent                               │
│  handleTask() → search → generate → sandbox → eval → store  │
│  publishProfile() → ENS text records                        │
│  collaborateWith() → AXL task delegation                    │
└──────┬──────────────────────────┬────────────────────────────┘
       │                          │
┌──────▼────────┐      ┌──────────▼──────────────────────────┐
│ Evolution     │      │ Communication                       │
│ Engine        │      │ AXLClient + AgentCoordinator        │
│               │      │ - Peer discovery (GET /topology)    │
│ ToolGenerator │      │ - Task routing (POST /send)         │
│ ToolSandbox   │      │ - Tool sharing (GET /recv polling)  │
│ ToolEvaluator │      └────────────────────────────────────┘
└──────┬────────┘
       │
┌──────▼────────────────────────────────────┐
│ Storage & Identity                        │
│                                           │
│ ToolRegistry ──→ 0G Storage               │
│   .zero-agent-index.json (local pointer)  │
│   Tool files (0G, addressed by root hash) │
│   Tool index (0G, addressed by root hash) │
│                                           │
│ ENSIdentityManager ──→ Sepolia ENS        │
│   description                             │
│   capabilities (JSON array)               │
│   zeroagent.toolRegistry (0G root hash)   │
│   zeroagent.axlPeerId                     │
│   url                                     │
└───────────────────────────────────────────┘
```

### Data flow

```
Task
 │
 ├─▶ ToolRegistry.searchTools()
 │       │
 │       ├─ HIT ──────────────────────────────────────▶ Execute
 │       │
 │       └─ MISS
 │               │
 │               ▼
 │         ToolGenerator.generateTool()
 │         (0G Compute broker → OpenAI fallback)
 │               │
 │               ▼
 │         ToolSandbox.run()  [syntax + runtime check]
 │               │
 │               ▼
 │         ToolEvaluator.evaluate()
 │         (LLM generates test cases → score threshold 0.7)
 │               │
 │               ├─ FAIL (retry ×3 with feedback)
 │               │
 │               └─ PASS
 │                       │
 │                       ▼
 │                 ToolRegistry.saveTool()
 │                 → uploadToZeroG() → root hash
 │                       │
 │                       ▼
 └──────────────────▶ Execute → TaskResult
```

---

## Core Features

### Self-evolution loop

The `EvolutionEngine` orchestrates tool creation with a retry loop. On failure, it feeds the sandbox error and eval score back to the generator. Up to 3 attempts per task, each with improved context.

### Isolated code execution

Generated tools run in [`isolated-vm`](https://github.com/laverdet/isolated-vm) with a 16MB memory cap and 3-second timeout. No access to `require`, `process`, `fs`, or `eval`. If the tool requires `fetch`, execution falls back to Node.js `vm.createContext()` with `fetch` explicitly allowed and everything else blocked.

### LLM-driven test generation

`ToolEvaluator` calls `gpt-4o-mini` to generate 2 test cases for each tool before running them. It doesn't assume the tool is correct — it independently assesses whether the output is reasonable. Score < 0.7 triggers a regeneration cycle.

### Persistent tool storage on 0G

Every approved tool is serialized to JSON and uploaded to 0G Storage on Sepolia testnet via `@0gfoundation/0g-ts-sdk`. The returned root hash is stored in a local index file (`.zero-agent-index.json`). On the next run, the agent fetches the tool from 0G by root hash. Tools survive process restarts.

### ENS as agent identity

`ENSIdentityManager` uses [viem](https://viem.sh/) to read and write ENS text records on Sepolia. Each agent owns an ENS name and stores its capabilities, tool registry hash, and AXL peer ID directly in those records. Other agents can discover it by resolving the ENS name.

### Gensyn AXL peer-to-peer messaging

`AXLClient` implements the official [Gensyn AXL](https://github.com/gensyn-ai/axl) HTTP API:
- `GET /topology` — get this node's stable peer ID
- `POST /send` with `X-Destination-Peer-Id` — send message to a peer
- `GET /recv` — poll for incoming messages (500ms interval)

`AgentCoordinator` routes incoming messages to the agent: `task_request` triggers `handleTask()`, `tool_share` triggers `registry.importTool()`.

### Pluggable identity provider

The `AgentIdentityProvider` interface decouples identity from ENS. Swap in any implementation — database-backed, mock for tests, or a different naming system — without touching agent logic.

---

## Sponsor Integration

### 0G Storage

ZeroAgent uses 0G Storage as the persistence layer for every generated tool and tool index.

| Operation | Implementation |
|---|---|
| Tool upload | `uploadToZeroG(tool)` → `Indexer.uploadFile()` → root hash |
| Tool download | `downloadFromZeroG(rootHash)` → `Indexer.downloadFile()` → parsed JSON |
| Index storage | Tool registry index uploaded as JSON blob |
| Cross-agent sharing | Agent B fetches tools from 0G by root hashes published in Agent A's ENS records |

Network: Sepolia testnet
- EVM RPC: `https://evmrpc-testnet.0g.ai`
- Indexer: `https://indexer-storage-testnet-turbo.0g.ai`

Without 0G, ZeroAgent has no persistence. Tool memory is the core product. 0G is the database.

### 0G Compute

`ToolGenerator` calls the 0G Compute broker as its first LLM source. It uses `@0glabs/0g-serving-broker` to list available services, locate a "chatbot" provider, and call `/chat/completions` with custom headers for billing. OpenAI `gpt-4o-mini` is the fallback if 0G Compute is unavailable or returns no providers.

### ENS

Each agent is an ENS name. `ENSIdentityManager` writes to Sepolia's Public Resolver (`0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`) using viem's `writeContract`. The text records it writes:

| Record | Value |
|---|---|
| `description` | Agent description |
| `capabilities` | JSON-encoded string array |
| `zeroagent.toolRegistry` | 0G root hash of tool index |
| `zeroagent.axlPeerId` | Gensyn AXL peer ID |
| `url` | Agent repository or endpoint |

Agents can discover each other with `discoverAgentsByCapability(capability, knownAgentNames[])` — it resolves each name's text records and filters by capability match.

ENS is not cosmetic here. It's the agent's public identity card, the pointer to its tool library, and the address book for the agent network.

### Gensyn AXL

ZeroAgent uses AXL as the transport for agent-to-agent task delegation and tool library sharing.

| Message type | Behavior |
|---|---|
| `task_request` | Routed to `agent.handleTask()`, response sent back as `task_result` |
| `tool_share` | Tool object extracted and saved via `registry.importTool()` |
| `ping` | Acknowledged (keepalive) |

The `AgentCoordinator` handles deduplication, timeout (30s per task), and error isolation. AXL peer IDs are published in ENS, so any agent can discover another agent's AXL address by ENS name lookup.

---

## Installation

### Prerequisites

- Node.js 18+
- pnpm 8+
- A funded Ethereum wallet on Sepolia (for 0G storage gas and ENS writes)

```bash
git clone https://github.com/your-org/zero-agents
cd zero-agents
pnpm install
```

Copy `.env.example` to `.env` and fill in the required keys:

```bash
cp .env.example .env
```

Build all packages:

```bash
pnpm build
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ZERO_G_PRIVATE_KEY` | Yes | Ethereum private key for 0G storage operations |
| `ENS_PRIVATE_KEY` | Optional | Ethereum private key controlling your agent's ENS name |
| `ENS_NAME` | Optional | ENS name your agent will use (e.g. `my-agent.eth`) |
| `OPENAI_API_KEY` | Optional | Fallback LLM if 0G Compute has no available providers |
| `SEPOLIA_RPC_URL` | Optional | Custom Sepolia RPC. Defaults to `https://sepolia.drpc.org` |

The minimum setup to run the demo is `ZERO_G_PRIVATE_KEY`. ENS writes require a wallet that controls the target `.eth` name. `OPENAI_API_KEY` enables tool generation if 0G Compute is unavailable.

---

## Quickstart

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'my-agent.eth',
  privateKey: process.env.ENS_PRIVATE_KEY!,
});

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A research agent',
  capabilities: ['web-search', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,
  identity,
});

// Subscribe to step events
agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

// Publish ENS profile
await agent.publishProfile();

// Run a task
const result = await agent.handleTask({
  description: 'Find and summarize the top 3 AI research papers from this week',
});

console.log(result.output);
console.log(`Tool used: ${result.toolUsed}`);
console.log(`Generated: ${result.wasGenerated}`);  // true on first run, false after
```

On the first call, the agent generates a tool and stores it on 0G. On every subsequent call with a matching task, it retrieves and reuses the stored tool.

---

## Building Your Own Agent

Extend `SelfEvolvingAgent` and implement `handleTask`:

```typescript
import { SelfEvolvingAgent, TaskRequest, TaskResult } from '@zero-agents/core';

export class MyAgent extends SelfEvolvingAgent {
  constructor(options: MyAgentOptions) {
    super({
      name: options.name,
      description: 'My custom agent',
      capabilities: ['my-capability'],
      zeroGPrivateKey: options.zeroGKey,
      identity: options.identity,
    });
  }

  async handleTask(task: TaskRequest): Promise<TaskResult> {
    // Check registry for an existing tool
    const existing = await this.registry.searchTools(task.description);
    if (existing.length > 0) {
      return this.executeWithTool(existing[0], task);
    }

    // Generate a new tool via the evolution engine
    const tool = await this.evolutionEngine.evolve(
      task.description,
      { query: task.description }
    );

    return this.executeWithTool(tool, task);
  }
}
```

The base class handles tool generation, sandboxing, evaluation, and storage. You control when and how they're invoked.

---

## Agent-to-Agent Coordination

```typescript
// Discover another agent by ENS name
const peerId = await identity.getAXLPeerIdForName('research-agent.eth');

// Delegate a task to it over AXL
const result = await agent.collaborateWith('research-agent.eth', {
  description: 'Summarize the latest Ethereum news',
});

// Share your entire tool library with another agent
const coordinator = agent.getCoordinator();
await coordinator.shareToolLibrary(peerId);
```

The receiving agent automatically imports shared tools into its registry. From that point, it can execute those tasks without generation.

---

## Demo Agent: ResearchAgent

`packages/demo-agent` contains `ResearchAgent`, a concrete implementation that demonstrates the full framework lifecycle:

- Extends `SelfEvolvingAgent`
- Generates `web_search_and_summarize` on first run (fetches Hacker News API, formats results)
- Caches the tool in 0G storage with root hash tracking
- Supports offline fallback (runs without `ZERO_G_PRIVATE_KEY` for local testing)
- Cross-agent tool import via `importToolsFrom(otherAgent)`
- AXL task simulation via `sendTaskOverAXL(agent, task)`

Run the 12-step demo:

```bash
cd packages/demo-agent
pnpm demo
```

Expected output:

```
[research-agent.eth] Profile published to ENS
[search] Searching registry for: summarize trending AI agents...
[miss] No tool found — starting evolution
[generate] Generating tool: web_search_and_summarize
[sandbox] Sandbox test passed
[eval] Score: 0.85 — PASS
[store] Saved to 0G: 0x8ec79d696b5cc362a...
[execute] Task complete (wasGenerated: true, 1243ms)

[search] Searching registry for: summarize trending AI agents...
[hit] Tool found: web_search_and_summarize
[execute] Task complete (wasGenerated: false, 312ms)

[planner-agent.eth] Imported 1 tool from research-agent.eth
[axl] Task delegated to research-agent.eth via AXL
[axl] Response received
```

---

## Package Structure

```
zero-agents/
├── packages/
│   ├── core/                         # @zero-agents/core
│   │   └── src/
│   │       ├── index.ts              # All exports
│   │       ├── self-evolving-agent.ts
│   │       ├── evolution-engine.ts
│   │       ├── generation/
│   │       │   └── tool-generator.ts # 0G Compute + OpenAI fallback
│   │       ├── sandbox/
│   │       │   ├── tool-sandbox.ts   # isolated-vm execution
│   │       │   └── tool-evaluator.ts # LLM test generation + scoring
│   │       ├── storage/
│   │       │   ├── zero-g.ts         # 0G upload/download
│   │       │   └── tool-registry.ts  # Index management
│   │       ├── identity/
│   │       │   ├── ens-identity-manager.ts
│   │       │   ├── types.ts
│   │       │   └── index.ts
│   │       └── communication/
│   │           ├── axl-client.ts     # AXL HTTP API client
│   │           └── agent-coordinator.ts
│   │
│   ├── demo-agent/                   # @zero-agents/demo-agent
│   │   ├── src/index.ts              # ResearchAgent class
│   │   └── scripts/run-demo.ts       # 12-step demo
│   │
│   └── dashboard/                    # @zero-agents/dashboard
│       └── src/app/                  # Next.js (UI in progress)
│
├── scripts/
│   ├── test-storage.ts               # 0G integration test
│   ├── test-agent.ts                 # Agent + evolution test
│   ├── test-ens-identity.ts          # ENS read/write tests (8 cases)
│   └── test-axl-local.ps1            # Local AXL P2P integration test
│
├── .zero-agent-index.json            # Pointer to current 0G tool index
├── .env.example
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## Development Commands

```bash
# Build all packages
pnpm build

# Watch mode (all packages)
pnpm dev

# Run the 12-step demo
cd packages/demo-agent && pnpm demo

# Test 0G upload/download (requires ZERO_G_PRIVATE_KEY)
pnpm test:storage

# Test agent + tool evolution (requires ZERO_G_PRIVATE_KEY)
pnpm test:agent

# Test ENS identity (reads from Sepolia, writes require ENS_PRIVATE_KEY + ENS_NAME)
tsx scripts/test-ens-identity.ts

# Test AXL local P2P integration (Windows, clones official AXL repo and builds it)
powershell -ExecutionPolicy Bypass -File scripts/test-axl-local.ps1

# Keep AXL nodes running after test
powershell -ExecutionPolicy Bypass -File scripts/test-axl-local.ps1 -KeepRunning
```

---

## Integration Tests

| Test | What it verifies | Requirement |
|---|---|---|
| `test-storage.ts` | Upload JSON to 0G, download by root hash, verify data integrity | `ZERO_G_PRIVATE_KEY` |
| `test-agent.ts` | Full evolution loop: generate tool, sandbox, eval, save; second run reuses tool | `ZERO_G_PRIVATE_KEY` |
| `test-ens-identity.ts` | 8 read tests (resolve address, get capabilities, get registry hash, get AXL peer ID, error handling); 3 write tests | Write tests require `ENS_PRIVATE_KEY` + `ENS_NAME` |
| `test-axl-local.ps1` | Clones official AXL repo, builds `node.exe`, starts 2 peered nodes, sends messages both directions | Windows + internet access |

---

## 0G Network Configuration

```
Blockchain RPC:   https://evmrpc-testnet.0g.ai
Indexer:          https://indexer-storage-testnet-turbo.0g.ai
```

Tool index pointer is stored in `.zero-agent-index.json`:

```json
{
  "rootHash": "0x8ec79d696b5cc362a48429b059528833a2dd129878451ebb2185a2bd12c7f9f2"
}
```

This hash points to the current tool index on 0G. When an agent is restarted, it reads this file and re-fetches its entire tool library from 0G by hash.

---

## ENS Configuration

Network: Sepolia testnet
Public Resolver: `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`

Text records ZeroAgent writes:

| Key | Purpose |
|---|---|
| `description` | Human-readable agent description |
| `capabilities` | JSON array of capability strings |
| `zeroagent.toolRegistry` | 0G root hash of this agent's tool index |
| `zeroagent.axlPeerId` | This agent's Gensyn AXL peer ID |
| `url` | Agent repository or API endpoint |

---

## AXL Node Configuration

Local AXL HTTP API (default: `http://localhost:9002`):

| Endpoint | Method | Description |
|---|---|---|
| `/topology` | GET | Returns `{ our_public_key }` — this node's peer ID |
| `/send` | POST | Sends raw bytes with `X-Destination-Peer-Id` header |
| `/recv` | GET | Polls for incoming messages with `X-From-Peer-Id` header |

Message format:

```typescript
{
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping',
  requestId: string,
  payload: unknown,
  fromAgent?: string,
  timestamp: number
}
```

---

## API Reference

### `SelfEvolvingAgent`

```typescript
class SelfEvolvingAgent extends EventEmitter {
  constructor(config: SelfEvolvingAgentConfig)

  handleTask(task: TaskRequest): Promise<TaskResult>
  publishProfile(toolRegistryHash?: string): Promise<void>
  collaborateWith(ensName: string, task: TaskRequest): Promise<TaskResult>
  evolve(): void

  on('step', (event: AgentStepEvent) => void): this
}
```

### `EvolutionEngine`

```typescript
class EvolutionEngine {
  constructor(generator, sandbox, evaluator, registry)

  evolve(taskDescription: string, sampleParams: object): Promise<Tool>
  generateTool(taskDescription: string, sampleParams: object): Promise<Tool>
}
```

### `ToolRegistry`

```typescript
class ToolRegistry {
  saveTool(tool: Tool): Promise<string>         // returns root hash
  getTool(rootHash: string): Promise<Tool>
  getToolByName(name: string): Promise<Tool | null>
  searchTools(query: string): Promise<Tool[]>
  importTool(tool: Tool): Promise<void>
  exportTools(): Tool[]
  getIndexRootHash(): Promise<string>
}
```

### `ENSIdentityManager`

```typescript
class ENSIdentityManager implements AgentIdentityProvider {
  constructor(config: ENSIdentityManagerConfig)

  resolveAddress(): Promise<string | null>
  getProfile(): Promise<AgentProfile | null>
  setProfile(profile: AgentProfile): Promise<void>
  getToolRegistryHash(): Promise<string | null>
  setToolRegistryHash(hash: string): Promise<void>
  getAXLPeerId(): Promise<string | null>
  setAXLPeerId(peerId: string): Promise<void>
  getAXLPeerIdForName(ensName: string): Promise<string | null>
  discoverAgentsByCapability(capability: string, knownAgentNames: string[]): Promise<string[]>
}
```

### `AXLClient`

```typescript
class AXLClient {
  constructor(config?: AXLClientConfig)   // default port: 9002

  getPeerId(): Promise<string>
  sendMessage(toPeerId: string, message: AgentMessage): Promise<void>
  sendTask(toPeerId: string, task: TaskRequest): Promise<TaskResult>
  startListening(onMessage: (msg: AgentMessage) => void): void
}
```

### `ToolSandbox`

```typescript
class ToolSandbox {
  run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult>
}
```

### `ToolEvaluator`

```typescript
class ToolEvaluator {
  evaluate(tool: Tool, testCases?: TestCase[]): Promise<EvalResult>
}
```

### `AgentIdentityProvider` (interface)

```typescript
interface AgentIdentityProvider {
  getProfile(): Promise<AgentProfile | null>
  setProfile(profile: AgentProfile): Promise<void>
  getToolRegistryHash(): Promise<string | null>
  setToolRegistryHash(rootHash: string): Promise<void>
  setAXLPeerId?(peerId: string): Promise<void>
  getAXLPeerIdForName?(ensName: string): Promise<string | null>
}
```

---

## Known Limitations

**Tool generation depends on LLM quality.** The generator targets `gpt-4o-mini` (via 0G Compute or OpenAI). Simple tools generate reliably. Complex multi-step tools may require multiple retry cycles before passing evaluation.

**Evaluation threshold is fixed at 0.7.** Two LLM-generated test cases determine pass/fail. For tasks with nuanced expected output (e.g. prose summarization), the evaluator may not have the right reference to judge correctness.

**AXL requires a locally running node.** The `AXLClient` connects to `localhost:9002`. There's no cloud fallback. Both agents must have AXL running to communicate. The demo uses simulated AXL messaging so the demo flow runs without the binary.

**0G Compute provider availability is not guaranteed.** The framework tries to find a "chatbot" service on the 0G Compute network. If none are registered on testnet at the time of the call, it falls back to OpenAI. There's no retry or queuing on the compute side.

**ENS writes require testnet ETH.** Setting text records costs gas. The demo uses a mock identity provider in memory. Real ENS integration requires a funded Sepolia wallet that controls the target `.eth` name.

**Dashboard is not yet implemented.** The `dashboard` package exists but renders a static placeholder. Real-time agent monitoring is on the roadmap.

**Tool index is a single local file.** `.zero-agent-index.json` is a flat map of tool names to 0G root hashes. It is not versioned, does not support concurrent writes from multiple processes, and does not merge with remote state automatically.

**No production mainnet deployment.** The framework runs on Sepolia testnet for 0G Storage and ENS. Mainnet deployment requires funded wallets on both networks and updated RPC/resolver configuration.

---

## Roadmap

**Near term**

- [ ] Dashboard with real-time agent event stream
- [ ] Tool versioning and rollback in the registry
- [ ] Cross-platform AXL setup script (macOS/Linux)
- [ ] Mainnet configuration for 0G and ENS
- [ ] Tool deprecation and garbage collection

**Framework evolution**

- [ ] Multi-agent capability negotiation via ENS discovery
- [ ] Tool composition — agents build new tools from existing ones
- [ ] Reputation layer — track tool reliability scores across agents over time
- [ ] Agent marketplace — publish and sell tool libraries to other agent networks
- [ ] Structured tool schemas — type-safe contracts between tool producer and consumer

**Developer experience**

- [ ] `create-zero-agent` CLI scaffold
- [ ] npm package publish (`@zero-agents/core`)
- [ ] Tool library browser UI
- [ ] Hosted demo on public testnet

---

## Why This Is Framework-Level Work

Most agent frameworks are application frameworks — they give you a pre-built agent loop that you configure. ZeroAgent is a primitive framework: it gives you the components to build an agent loop that can modify itself.

The key distinction: **ZeroAgent's agents change their own capability surface at runtime.** The developer doesn't write the tools. The agent writes, tests, stores, and reuses them. The developer writes the agent's decision logic and domain context.

This is analogous to how a database framework (Prisma, Drizzle) doesn't tell you what to store — it gives you the operations for storing and retrieving things reliably. ZeroAgent doesn't tell you what tools to build — it gives you the operations for generating, validating, and persisting tools reliably.

The components are independently useful:
- `ToolSandbox` can sandbox-test any generated code
- `ToolEvaluator` can score any callable function
- `ENSIdentityManager` is a general-purpose agent identity provider
- `AXLClient` is a standalone Gensyn AXL HTTP client
- `ToolRegistry` is a 0G-backed key-value store for code artifacts

Each of these is a reusable primitive. The `SelfEvolvingAgent` is one way to combine them. The interfaces are designed so you can replace any component with your own implementation.

---

## Contributing

The repository is a pnpm monorepo using TypeScript strict mode throughout.

```bash
git clone https://github.com/your-org/zero-agents
cd zero-agents
pnpm install
pnpm build
```

Code lives in `packages/core/src`. The test scripts in `scripts/` are the primary way to verify changes against real infrastructure.

TypeScript config enforces `strict: true`, `noUnusedLocals`, `noUnusedParameters`, and `noImplicitReturns`. All code must compile cleanly before a PR.

Open issues for:
- Bug reports (include error output and which script triggered it)
- Integration failures (0G / ENS / AXL — include network conditions)
- API design feedback

---

## License

MIT

---

## Built For

[ETHGlobal Open Agents](https://ethglobal.com/events/agents)

Sponsor integrations: **0G** (storage + compute) · **ENS** (agent identity) · **Gensyn** (P2P coordination)
