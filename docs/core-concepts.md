# Core Concepts

---

## Tool

A **Tool** is a self-contained async JavaScript function plus metadata. It is the atomic unit of agent capability.

```typescript
// packages/core/src/storage/tool-registry.ts
interface Tool {
  id: string;           // UUID
  name: string;         // Unique, slug-like (e.g. "fetch_hn_stories")
  description: string;  // Human-readable purpose
  code: string;         // Complete async execute(params) function as a string
  schema: {
    input: object;      // Schema-like input shape using type strings
    output: object;     // Schema-like output shape using type strings
  };
  tags: string[];       // Keywords for search matching
  successRate: number;  // 0–1, updated after each execution
  usageCount: number;   // Total times executed
  createdAt: number;    // Unix timestamp (ms)
  rootHash?: string;    // 0G Storage content address (set after upload)
}
```

### Tool Code Format

Generated and imported tool code must be a complete async JavaScript function string usable as `execute`. Example:

```javascript
// This is what `tool.code` contains:
async function execute(params) {
  const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
  const ids = await response.json();
  const top3 = ids.slice(0, params.limit ?? 3);
  const stories = await Promise.all(top3.map(async (id) => {
    const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
    return r.json();
  }));
  return { stories, summary: `Top ${stories.length}: ${stories.map((s) => s.title).join(', ')}` };
}
```

The sandbox calls `execute(params)`, where `params` is the `TaskRequest.params` object.

---

## Task

A **TaskRequest** describes work for the agent to perform:

```typescript
// packages/core/src/self-evolving-agent.ts
interface TaskRequest {
  description: string;  // Plain English description — used for tool search + LLM prompt
  params?: object;      // Runtime arguments injected into the tool's scope
  context?: string;     // Optional caller context for custom agent flows
}
```

A **TaskResult** is what `handleTask()` returns:

```typescript
interface TaskResult {
  output: unknown;               // The value returned by the tool function
  toolUsed: string;              // Tool name that produced the result
  wasGenerated: boolean;         // true if tool was created this run, false if from registry
  executionTimeMs: number;       // Wall time for the full handleTask() call
  strategy?: StrategyName;       // Strategy actually used for this task
  strategyReason?: string;       // Why that strategy was selected
  confidence?: number;           // Strategy confidence from 0 to 1
  reflection?: ReflectionResult; // Structured post-task learning data
  experienceId?: string;         // Saved local experience record id
  wasImproved?: boolean;         // true if a failed existing tool was improved and used
}
```

---

## SelfEvolvingAgent

`SelfEvolvingAgent` (source: `packages/core/src/self-evolving-agent.ts`) is the main class. It extends `EventEmitter` and composes all other components.

### Configuration

```typescript
interface SelfEvolvingAgentConfig {
  name: string;                    // Agent's ENS name or identifier
  description?: string;
  capabilities?: string[];         // Declared skill list for ENS + discovery
  identity?: AgentIdentityProvider; // ENS or custom identity backend
  zeroGPrivateKey: string;         // Ethereum private key for 0G transactions
  openAiKey?: string;              // Fallback LLM key
  axlPort?: number;                // AXL node port (default: 9002)
  registryPath?: string;           // Local index pointer path
  axlEnabled?: boolean;            // Default: false
  maxGenerationAttempts?: number;  // Default: 3
  evolutionTimeoutMs?: number;     // Default: 120000
  axlPollIntervalMs?: number;      // Default: 500
  testCaseTimeoutMs?: number;      // Default: 30000
  allowUnsafeNodeVmFallback?: boolean;
  zeroGBlockchainRpc?: string;
  zeroGIndexerRpc?: string;
  indexCacheTtlMs?: number;
  experienceMemoryPath?: string;
}
```

`AgentConfig` is the minimal offline/test config. It omits 0G and OpenAI keys and supports local registry, local experience memory, AXL options, and `allowUnsafeNodeVmFallback`.

### State

```typescript
interface AgentState {
  iteration: number;               // Incremented each time evolve() is called
  lastUpdate: number;              // Unix timestamp of last state change
  metadata: Record<string, unknown>; // Arbitrary metadata (includes axlPeerId)
}
```

---

## EvolutionEngine

Source: `packages/core/src/evolution-engine.ts`

The engine runs a **generate → sandbox → evaluate → retry** loop up to 3 times.

```typescript
class EvolutionEngine {
  async evolve(taskDescription: string, sampleParams?: object): Promise<Tool>
  async generateTool(taskDescription: string, sampleParams?: object): Promise<Tool>
}
```

**Loop logic:**

```
for attempt = 1 to 3:
  prompt = taskDescription + (previous failure feedback if attempt > 1)
  tool   = ToolGenerator.generateTool(prompt)         // LLM call
  result = ToolSandbox.run(tool.code, sampleParams)    // syntax/runtime check
  if result.success == false:
    feedback = sandbox error message
    continue
  eval   = ToolEvaluator.evaluate(tool)               // LLM generates test cases, runs them
  if eval.score >= 0.7:
    ToolRegistry.saveTool(tool)
    return tool
  feedback = eval.feedback
throw Error after 3 failed attempts
```

The feedback from each failed attempt is appended to the next LLM prompt, so the model sees exactly what broke.

---

## ToolSandbox

Source: `packages/core/src/sandbox/tool-sandbox.ts`

Executes tool code in isolation. It prefers `isolated-vm`; the Node.js `vm` fallback is only used when `isolated-vm` cannot load and the caller explicitly enables `allowUnsafeNodeVmFallback`.

| Strategy | When Used | Memory | Timeout | Globals |
|----------|-----------|--------|---------|---------|
| `isolated-vm` | Default | 16 MB | 3 s | Safe builtins plus limited `fetch` bridge |
| `Node.js vm` | Development fallback only | Host process | Caller timeout | Safe builtins plus limited `fetch` |

```typescript
interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionTimeMs: number;
}

class ToolSandbox {
  async run(code: string, params: object): Promise<SandboxResult>
}
```

**Security**: `require`, `process`, `fs`, `Function`, and `eval` are shadowed in the sandbox source. Tools that need HTTP use the provided limited `fetch` bridge. Node's `vm` fallback is not a production security boundary.

---

## ToolEvaluator

Source: `packages/core/src/sandbox/tool-evaluator.ts`

Generates test cases with an LLM and scores the tool against them.

```typescript
interface TestCase {
  input: object;      // Params to pass to the tool
  expectedOutput?: unknown; // Optional exact expected output for deterministic tests
  description: string;
}

interface TestCaseResult {
  testCase: TestCase;
  passed: boolean;
  result: SandboxResult;
}

interface EvalResult {
  score: number;         // 0–1 (passed test count / total test count)
  passed: boolean;       // true if score >= 0.7
  testResults: TestCaseResult[];
  feedback: string;      // Explanation of failures, fed back into next generation attempt
}

class ToolEvaluator {
  async evaluate(tool: Tool): Promise<EvalResult>
}
```

If `OPENAI_API_KEY` is not set, the evaluator falls back to a single smoke test using the tool's input schema to create sample params.

---

## ToolRegistry

Source: `packages/core/src/storage/tool-registry.ts`

Manages the tool index: a local pointer file (`.zero-agent-index.json`) that stores the current index root hash. In local mode, hashes are deterministic `local-...` SHA-256 values stored in `.zero-agent-tools.json`. In 0G mode, hashes point to 0G Storage blobs.

```typescript
class ToolRegistry {
  async saveTool(tool: Tool): Promise<string>         // Upload + index; returns rootHash
  async getTool(rootHash: string): Promise<Tool>      // Download by hash
  async getToolByName(name: string): Promise<Tool | null>
  async getToolHistory(name: string): Promise<ToolHistory>
  async searchTools(query: string): Promise<Tool[]>   // Fuzzy match by name/description/tags
  async exportTools(): Promise<Tool[]>                // All tools in the registry
  async importTool(tool: Tool): Promise<string>       // Add an externally sourced tool
  async updateToolStats(tool: Tool): Promise<string>
  async getIndexRootHash(): Promise<string | null>    // Current index root hash
  async loadIndex(): Promise<Map<string, string>>     // name → rootHash map
}
```

### Search Scoring

`searchTools(query)` ranks tools as follows:

1. **Score 1.0** — query is a substring of `name + description + tags` (exact match).
2. **Score 0–1** — proportion of query tokens found in the searchable text.
3. **Score 0** — excluded from results.

Ties are broken by `successRate` descending.

---

## AgentIdentityProvider

Source: `packages/core/src/identity/types.ts`

An interface — swap in any identity backend. ENS is the built-in implementation.

```typescript
interface AgentIdentityProvider {
  getProfile(): Promise<AgentProfile | null>
  setProfile(profile: AgentProfile): Promise<void>
  getToolRegistryHash(): Promise<string | null>
  setToolRegistryHash(rootHash: string): Promise<void>
  setAXLPeerId?(peerId: string): Promise<void>
  getAXLPeerIdForName?(ensName: string): Promise<string | null>
}

interface AgentProfile {
  description: string
  capabilities: string[]
  toolRegistryHash: string
  axlPeerId?: string
  url?: string
}
```

---

## AXLClient

Source: `packages/core/src/communication/axl-client.ts`

HTTP client for a locally running Gensyn AXL node. Default port: `9002`.

```typescript
interface AgentMessage {
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping';
  requestId: string;
  payload: any;
  fromAgent?: string;
  timestamp: number;
}

class AXLClient {
  async getPeerId(): Promise<string>
  async sendMessage(toPeerId: string, message: AgentMessage): Promise<void>
  async sendTask(toPeerId: string, task: TaskRequest): Promise<TaskResult>  // 30s timeout
  async startListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): Promise<void>
}
```

Deduplication: tracks up to 1,000 seen message keys (`fromPeerId:type:requestId:timestamp`) to prevent duplicate processing.

---

## AgentCoordinator

Source: `packages/core/src/communication/agent-coordinator.ts`

Wires together `AXLClient` and `SelfEvolvingAgent`. `SelfEvolvingAgent` starts it automatically only when `axlEnabled: true`; otherwise create and start it manually if you need raw AXL routing.

Message routing:

| Message Type | Action |
|---|---|
| `task_request` | Calls `agent.handleTask(payload)`, sends back `task_result` |
| `tool_share` | Calls `registry.importTool(payload)` |
| `ping` | No-op acknowledgement |
