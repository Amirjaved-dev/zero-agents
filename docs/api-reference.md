# API Reference

All exports are from `@zero-agents/core` (`packages/core/src/index.ts`).

---

## Classes

### `SelfEvolvingAgent`

> `packages/core/src/self-evolving-agent.ts`

```typescript
class SelfEvolvingAgent extends EventEmitter
```

#### Constructor

```typescript
new SelfEvolvingAgent(config: SelfEvolvingAgentConfig | AgentConfig)
```

**`SelfEvolvingAgentConfig`** — full config with 0G and optional ENS/AXL:

```typescript
{
  name: string;                     // Required. Agent name / ENS name.
  description?: string;             // Human-readable description.
  capabilities?: string[];          // Capability tags, e.g. ['web-search', 'data-extraction'].
  identity?: AgentIdentityProvider; // ENS or custom identity backend.
  zeroGPrivateKey: string;          // Ethereum private key (Sepolia) for 0G transactions.
  openAiKey?: string;               // Optional OpenAI fallback key.
  axlPort?: number;                 // AXL node port. Default: 9002.
  axlEnabled?: boolean;             // Default: true. Set false for local examples without AXL.
}
```

**`AgentConfig`** — minimal config (no 0G; for testing / offline use):

```typescript
{
  name: string;
  description?: string;
  axlPort?: number;
  axlEnabled?: boolean;
}
```

#### Methods

```typescript
// Run a task. Returns the result and metadata about tool used.
agent.handleTask(task: TaskRequest): Promise<TaskResult>

// Delegate a task to another agent over AXL (requires identity provider).
agent.collaborateWith(otherAgentEnsName: string, task: TaskRequest): Promise<TaskResult>

// Publish agent profile to the identity provider (e.g. ENS text records).
agent.publishProfile(toolRegistryHash?: string): Promise<void>

// Increment iteration counter.
agent.evolve(): Promise<void>

// Accessors
agent.getName(): string
agent.getDescription(): string
agent.getState(): AgentState
```

#### Events

```typescript
agent.on('step', (event: AgentStepEvent) => void)
```

```typescript
interface AgentStepEvent {
  type: 'search' | 'miss' | 'generating' | 'sandboxing' | 'evaluating' | 'saving' | 'executing' | 'done' | 'error';
  message: string;
  data?: any;
}
```

---

### `EvolutionEngine`

> `packages/core/src/evolution-engine.ts`

Orchestrates the generate → sandbox → evaluate retry loop. Used internally by `SelfEvolvingAgent`; expose directly if you want to generate tools outside an agent context.

```typescript
class EvolutionEngine extends EventEmitter

new EvolutionEngine(
  generator?: ToolGenerator,
  sandbox?: ToolSandbox,
  evaluator?: ToolEvaluator,
  registry?: ToolRegistry
)
```

All constructor arguments are optional — defaults are instantiated automatically.

```typescript
// Generate a tool and save it to the registry. Throws after 3 failed attempts.
engine.evolve(taskDescription: string, sampleParams?: object): Promise<Tool>

// Alias for evolve().
engine.generateTool(taskDescription: string, sampleParams?: object): Promise<Tool>
```

Events: `'step'` — emits `EvolutionEvent` at each phase:

```typescript
interface EvolutionEvent {
  type: 'generating' | 'sandboxing' | 'evaluating' | 'saving';
  message: string;
  data?: any;
}
```

---

### `ToolRegistry`

> `packages/core/src/storage/tool-registry.ts`

```typescript
class ToolRegistry

new ToolRegistry(indexPointerPath?: string)
// Default path: join(process.cwd(), '.zero-agent-index.json')
```

```typescript
// Upload tool to 0G, add to index. Returns the 0G root hash.
saveTool(tool: Tool): Promise<string>

// Download a tool by its 0G root hash.
getTool(rootHash: string): Promise<Tool>

// Look up a tool by name in the index, then download it.
getToolByName(name: string): Promise<Tool | null>

// Search registry by query string. Returns ranked list (best match first).
searchTools(query: string): Promise<Tool[]>

// Return all tools in the registry.
exportTools(): Promise<Tool[]>

// Add a tool from an external source (another agent's tool_share).
importTool(tool: Tool): Promise<string>

// Return the root hash of the current index blob.
getIndexRootHash(): Promise<string | null>

// Load the full name → rootHash index map from 0G.
loadIndex(): Promise<Map<string, string>>
```

---

### `ToolGenerator`

> `packages/core/src/generation/tool-generator.ts`

```typescript
class ToolGenerator

new ToolGenerator()
```

```typescript
// Generate a Tool from a plain-English prompt.
// Uses 0G Compute first; falls back to OpenAI gpt-4o-mini if unavailable.
generateTool(prompt: string): Promise<Tool>
```

The returned tool has `successRate: 0` and `usageCount: 0` and is not yet saved to the registry.

---

### `ToolSandbox`

> `packages/core/src/sandbox/tool-sandbox.ts`

```typescript
class ToolSandbox

new ToolSandbox()
```

```typescript
// Execute tool code string with params injected into scope.
// Returns SandboxResult whether or not execution succeeds.
run(code: string, params: object): Promise<SandboxResult>
```

```typescript
interface SandboxResult {
  success: boolean;
  output: any;
  error?: string;
  executionTimeMs: number;
}
```

Execution strategy is chosen automatically:
- **isolated-vm** (default) — 16 MB, 3 s timeout, no `require`/`process`/`fs`/`eval`.
- **Node.js vm** (fallback when code contains `fetch`) — host process memory, 10 s timeout, `fetch` allowed.

---

### `ToolEvaluator`

> `packages/core/src/sandbox/tool-evaluator.ts`

```typescript
class ToolEvaluator

new ToolEvaluator(sandbox?: ToolSandbox)
```

```typescript
// Generate test cases via LLM, run tool against them, return scored result.
evaluate(tool: Tool): Promise<EvalResult>
```

```typescript
interface EvalResult {
  score: number;         // 0–1
  passed: boolean;       // score >= 0.7
  testResults: TestCaseResult[];
  feedback: string;      // Failure descriptions for retry prompts
}

interface TestCase {
  input: object;
  expectedOutput: object;
}

interface TestCaseResult {
  testCase: TestCase;
  passed: boolean;
  actual?: any;
  error?: string;
}
```

---

### `ENSIdentityManager`

> `packages/core/src/identity/ens-identity-manager.ts`

```typescript
interface ENSIdentityManagerConfig {
  ensName: string;        // e.g. 'my-agent.eth'
  privateKey: string;     // Ethereum private key for signing ENS writes
}

class ENSIdentityManager implements AgentIdentityProvider

new ENSIdentityManager(config: ENSIdentityManagerConfig)
```

```typescript
// Read all text records for the ENS name.
getProfile(): Promise<AgentProfile | null>

// Write all text records for the ENS name (batched).
setProfile(profile: AgentProfile): Promise<void>

// Read only the tool registry hash text record.
getToolRegistryHash(): Promise<string | null>

// Write the tool registry hash text record.
setToolRegistryHash(rootHash: string): Promise<void>

// Write the AXL peer ID text record.
setAXLPeerId(peerId: string): Promise<void>

// Read another agent's AXL peer ID by ENS name.
getAXLPeerIdForName(ensName: string): Promise<string | null>

// Find agents that declare a specific capability.
discoverAgentsByCapability(capability: string, agentNames: string[]): Promise<string[]>
```

**Network:** Sepolia testnet. Resolver: `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`.

**Text records written:**

| Record Key | Value |
|---|---|
| `description` | `profile.description` |
| `capabilities` | `JSON.stringify(profile.capabilities)` |
| `zeroagent.toolRegistry` | 0G root hash of tool index |
| `zeroagent.axlPeerId` | Gensyn AXL peer ID |
| `url` | `profile.url` |

---

### `AXLClient`

> `packages/core/src/communication/axl-client.ts`

```typescript
interface AXLClientConfig {
  axlPort?: number;   // Default: 9002
}

class AXLClient

new AXLClient(config?: AXLClientConfig)
```

```typescript
// Get this node's public key (peer ID).
getPeerId(): Promise<string>

// Send a raw AgentMessage to another peer.
sendMessage(toPeerId: string, message: AgentMessage): Promise<void>

// Send a task and wait up to 30 s for the result.
sendTask(toPeerId: string, task: TaskRequest): Promise<TaskResult>

// Register a listener for inbound messages. Starts polling if not already running.
startListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): Promise<void>
```

```typescript
interface AgentMessage {
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping';
  requestId: string;    // UUID
  payload: any;
  fromAgent?: string;   // Sender's agent name
  timestamp: number;    // Unix ms
}
```

---

### `AgentCoordinator`

> `packages/core/src/communication/agent-coordinator.ts`

```typescript
interface AgentCoordinatorConfig {
  agent: SelfEvolvingAgent;
  registry: ToolRegistry;
  axlClient: AXLClient;
}

class AgentCoordinator

new AgentCoordinator(config: AgentCoordinatorConfig)
```

```typescript
// Start listening for AXL messages and routing them.
start(): Promise<void>

// Send all registry tools to another peer as tool_share messages.
shareToolLibrary(toPeerId: string): Promise<void>
```

---

## Types

```typescript
// All exported from @zero-agents/core

export type { Tool }                  // from storage/tool-registry
export type { SandboxResult }         // from sandbox/tool-sandbox
export type { EvalResult, TestCase, TestCaseResult }  // from sandbox/tool-evaluator
export type { AgentConfig, AgentState, AgentStepEvent, SelfEvolvingAgentConfig, TaskRequest, TaskResult }
export type { EvolutionEvent }        // from evolution-engine
export type { AgentIdentityProvider, AgentProfile, ENSIdentityManagerConfig }
export type { AgentMessage, AXLClientConfig }
export type { AgentCoordinatorConfig }
```

---

## 0G Storage Utilities

> `packages/core/src/storage/zero-g.ts`

Not exported from the main index, but used internally by `ToolRegistry`. Call directly if you need raw 0G access:

```typescript
import { uploadToZeroG, downloadFromZeroG } from '@zero-agents/core/storage/zero-g';

// Serialize `data` to JSON and upload. Returns root hash string.
uploadToZeroG(data: object): Promise<string>

// Download by root hash and deserialize. Returns plain object.
downloadFromZeroG(rootHash: string): Promise<object>
```

Requires `ZERO_G_PRIVATE_KEY` in environment.
