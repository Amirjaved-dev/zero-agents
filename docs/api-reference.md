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
  registryPath?: string;            // Local index pointer path.
  axlEnabled?: boolean;             // Default: false. Set true to start AXL eagerly.
  maxGenerationAttempts?: number;   // Default: 3.
  evolutionTimeoutMs?: number;      // Default: 120000.
  axlPollIntervalMs?: number;       // Default: 500.
  testCaseTimeoutMs?: number;       // Default: 30000.
  allowUnsafeNodeVmFallback?: boolean;
  zeroGBlockchainRpc?: string;
  zeroGIndexerRpc?: string;
  indexCacheTtlMs?: number;
  experienceMemoryPath?: string;
}
```

**`AgentConfig`** — minimal config (no 0G; for testing / offline use):

```typescript
{
  name: string;
  description?: string;
  axlPort?: number;
  registryPath?: string;
  axlEnabled?: boolean;
  axlPollIntervalMs?: number;
  experienceMemoryPath?: string;
  allowUnsafeNodeVmFallback?: boolean;
}
```

#### Methods

```typescript
// Run a task. Returns the result and metadata about tool used.
agent.handleTask(task: TaskRequest): Promise<TaskResult>

// Convenience wrapper around handleTask().
agent.run(task: string | TaskRequest): Promise<TaskResult>

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
agent.getRegistry(): ToolRegistry
agent.getEvolutionEngine(): EvolutionEngine
agent.getExperienceMemory(): ExperienceMemory
agent.getStrategyAdapter(): StrategyAdapter
agent.getToolImprover(): ToolImprover
agent.getCoordinator(): AgentCoordinator | null
agent.dispose(): void
```

#### Events

```typescript
agent.on('step', (event: AgentStepEvent) => void)
```

```typescript
interface AgentStepEvent {
  type: 'search' | 'miss' | 'strategy' | 'generating' | 'sandboxing' | 'evaluating' | 'saving' | 'executing' | 'reflecting' | 'done' | 'error';
  message: string;
  data?: unknown;
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
  registry?: ToolRegistry,
  evolutionTimeoutMs?: number,
  maxGenerationAttempts?: number
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
  data?: unknown;
}
```

---

### `ToolRegistry`

> `packages/core/src/storage/tool-registry.ts`

```typescript
class ToolRegistry

new ToolRegistry(indexPointerPath?: string)
new ToolRegistry(options?: ToolRegistryOptions)
// Default index pointer: join(process.cwd(), '.zero-agent-index.json')
// Default storage: 0G when ZERO_G_PRIVATE_KEY is configured, otherwise local JSON.
```

```typescript
interface ToolRegistryOptions {
  indexPointerPath?: string;
  zeroGPrivateKey?: string;
  storageMode?: 'auto' | 'zero-g' | 'local';
  localStorePath?: string;
  indexCacheTtlMs?: number;
  zeroGBlockchainRpc?: string;
  zeroGIndexerRpc?: string;
}
```

```typescript
// Save tool to the configured backend, add to index. Returns the root hash.
saveTool(tool: Tool): Promise<string>

// Load a tool by root hash.
getTool(rootHash: string): Promise<Tool>

// Look up a tool by name in the index, then download it.
getToolByName(name: string): Promise<Tool | null>

// Return current and previous root hashes for a named tool.
getToolHistory(name: string): Promise<ToolHistory>

// Search registry by query string. Returns ranked list (best match first).
searchTools(query: string): Promise<Tool[]>

// Return all tools in the registry.
exportTools(): Promise<Tool[]>

// Add a tool from an external source (another agent's tool_share).
importTool(tool: Tool): Promise<string>

// Update only usageCount/successRate metadata for an existing rootHash.
updateToolStats(tool: Tool): Promise<string>

// Return the root hash of the current index blob.
getIndexRootHash(): Promise<string | null>

// Load the full name → rootHash index map.
loadIndex(): Promise<Map<string, string>>
```

---

### `ExperienceMemory`

> `packages/core/src/memory/experience-memory.ts`

Stores task experience records in local JSON by default, with optional best-effort 0G persistence when configured directly.

```typescript
class ExperienceMemory

new ExperienceMemory(options?: ExperienceMemoryOptions)
```

```typescript
interface ExperienceMemoryOptions {
  filePath?: string;
  zeroG?: ZeroGStorageOptions;
  persistToZeroG?: boolean;
}
```

```typescript
saveExperience(experience: ExperienceInput): Promise<ExperienceRecord>
listExperiences(agentName?: string): Promise<ExperienceRecord[]>
findSimilarExperiences(task: string, limit?: number): Promise<ExperienceRecord[]>
clearExperiences(): Promise<void>
```

---

### `StrategyAdapter`

> `packages/core/src/evolution/strategy-adapter.ts`

Deterministically selects a pre-task strategy from the available tools and similar prior experiences.

```typescript
class StrategyAdapter

selectStrategy(input: StrategyAdapterInput): StrategyDecision
```

```typescript
type StrategyName =
  | 'reuse_existing_tool'
  | 'generate_new_tool'
  | 'improve_existing_tool'
  | 'ask_another_agent'
  | 'reject_task';

interface StrategyDecision {
  strategy: StrategyName;
  confidence: number;
  reason: string;
  selectedToolName?: string;
  selectedToolId?: string;
}
```

---

### `ReflectionEngine`

> `packages/core/src/reflection/reflection-engine.ts`

Produces deterministic post-task learning data. It does not call an external API.

```typescript
class ReflectionEngine

reflect(input: ReflectionInput): ReflectionResult
```

```typescript
interface ReflectionResult {
  success: boolean;
  qualityScore: number;
  whatWorked: string;
  whatFailed: string;
  improvementNeeded: boolean;
  memoryNote: string;
  recommendedStrategy: RecommendedStrategy;
}
```

---

### `ToolImprover`

> `packages/core/src/tools/tool-improver.ts`

Uses a configured generator to create an improved candidate for a failed or low-quality tool. It does not save or evaluate the candidate by itself.

```typescript
class ToolImprover

new ToolImprover(options?: ToolImproverOptions)
improveTool(input: ToolImproverInput): Promise<ImprovedToolCandidate>
```

---

### `ToolGenerator`

> `packages/core/src/generation/tool-generator.ts`

```typescript
class ToolGenerator

new ToolGenerator(options?: ToolGeneratorOptions | boolean)
```

```typescript
interface ToolGeneratorOptions {
  fallbackToOpenAI?: boolean;
  zeroGPrivateKey?: string;
  openAiKey?: string;
  zeroGBlockchainRpc?: string;
}
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

new ToolSandbox(options?: ToolSandboxOptions)
```

```typescript
interface ToolSandboxOptions {
  allowUnsafeNodeVmFallback?: boolean;
  allowedFetchHostnames?: string[];
  maxFetchResponseBytes?: number;
}
```

```typescript
// Execute an async execute(params) tool code string.
// Returns SandboxResult whether or not execution succeeds.
run(code: string, params: object, timeoutMs?: number): Promise<SandboxResult>
```

```typescript
interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionTimeMs: number;
}
```

Execution strategy:

- **isolated-vm** is preferred by default, with a 16 MB isolate memory limit and a 3 second default timeout.
- `fetch` is provided inside `isolated-vm` through a limited host bridge.
- **Node.js vm** is used only when `isolated-vm` cannot load and `allowUnsafeNodeVmFallback: true` is set. It is a development fallback, not a production security boundary.

---

### `ToolEvaluator`

> `packages/core/src/sandbox/tool-evaluator.ts`

```typescript
class ToolEvaluator

new ToolEvaluator(sandbox?: ToolSandbox, openAiKey?: string, testCaseTimeoutMs?: number)
```

```typescript
// Generate test cases via LLM, run tool against them, return scored result.
evaluate(tool: Tool, testCases?: TestCase[]): Promise<EvalResult>
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
  expectedOutput?: unknown;
  description: string;
}

interface TestCaseResult {
  testCase: TestCase;
  passed: boolean;
  result: SandboxResult;
}
```

---

### `ENSIdentityManager`

> `packages/core/src/identity/ens-identity-manager.ts`

```typescript
interface ENSIdentityManagerConfig {
  ensName?: string;       // e.g. 'my-agent.eth'; optional for auto-detect flow
  privateKey: string;     // Ethereum private key for signing ENS writes
  rpcUrl?: string;        // Defaults to https://sepolia.drpc.org
}

class ENSIdentityManager implements AgentIdentityProvider

new ENSIdentityManager(config: ENSIdentityManagerConfig)
ENSIdentityManager.autoDetect(privateKey: string, rpcUrl?: string): Promise<ENSIdentityManager | null>
```

```typescript
// Read all text records for the ENS name.
getProfile(): Promise<AgentProfile | null>

// Detect primary ENS name for the wallet.
detectPrimaryName(): Promise<string | null>

// Return configured wallet address.
getWalletAddress(): string

// True when an ENS name is configured.
hasEnsNameConfigured(): boolean

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

**Network:** Sepolia testnet. The manager resolves the ENS name's configured resolver before reading or writing text records.

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
  axlPort?: number;         // Default: 9002
  taskTimeoutMs?: number;   // Default: 30000
  pollIntervalMs?: number;  // Default: 500
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

// Remove a listener.
stopListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): void

// Stop polling and reject pending task requests.
stop(): void
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
  agent: { getName(): string; handleTask(task: TaskRequest): Promise<TaskResult> };
  registry: ToolRegistry;
  axlClient?: AXLClient;
}

class AgentCoordinator

new AgentCoordinator(config: AgentCoordinatorConfig)
```

```typescript
// Start listening for AXL messages and routing them.
start(): Promise<void>

// Stop listening for AXL messages.
stop(): void

// Send all registry tools to another peer as tool_share messages.
shareToolLibrary(toPeerId: string): Promise<void>
```

---

## Types

```typescript
// All exported from @zero-agents/core

export type { Tool }                  // from storage/tool-registry
export type { ToolRegistryOptions, ToolHistory }
export type { ExperienceRecord }      // from memory/experience-memory
export type { SandboxResult }         // from sandbox/tool-sandbox
export type { ToolSandboxOptions }
export type { EvalResult, TestCase, TestCaseResult }  // from sandbox/tool-evaluator
export type { ToolGeneratorOptions }
export type { ImprovedToolCandidate, OriginalToolForImprovement, ToolImproverInput, ToolImproverOptions }
export type { AgentConfig, AgentState, AgentStepEvent, SelfEvolvingAgentConfig, TaskRequest, TaskResult }
export type { EvolutionEvent }        // from evolution-engine
export type { StrategyAdapterInput, StrategyDecision, StrategyName }
export type { ReflectionInput, ReflectionResult, RecommendedStrategy }
export type { AgentIdentityProvider, AgentProfile, ENSIdentityManagerConfig }
export type { AgentMessage, AXLClientConfig }
export type { AgentCoordinatorConfig }
export type { ZeroGStorageOptions }
```

---

## 0G Storage Utilities

> `packages/core/src/storage/zero-g.ts`

Not exported from the main index, but used internally by `ToolRegistry`. Call directly if you need raw 0G access:

```typescript
import { uploadToZeroG, downloadFromZeroG } from '@zero-agents/core/storage/zero-g';

// Serialize `data` to JSON and upload. Returns root hash string.
uploadToZeroG(data: object, options?: ZeroGStorageOptions): Promise<string>

// Download by root hash and deserialize. Returns plain object.
downloadFromZeroG(rootHash: string, options?: Pick<ZeroGStorageOptions, 'indexerRpc'>): Promise<object>
```

Uploads require `ZERO_G_PRIVATE_KEY` or `options.privateKey`. Downloads only require a reachable indexer.
