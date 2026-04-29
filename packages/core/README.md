# @zero-agents/core

ENS-native self-evolving agent framework with persistent tool memory.

`@zero-agents/core` is the reusable TypeScript framework package for building agents that can discover existing tools, generate new tools, test generated code, store approved tools, remember task outcomes, publish identity metadata, and coordinate with other agents.

This README documents the core package only.

## Status

- Package version: `0.1.0`
- Runtime: Node.js `>=20`
- Module format: ESM only
- Main entry: `@zero-agents/core`
- Secondary entry: `@zero-agents/core/storage/zero-g`
- Maturity: alpha; APIs may change before a stable release

## Alpha Readiness

The package is ready for external alpha developers. The zero-wallet path includes `ToolSandbox`, local-mode `ToolRegistry`, deterministic reflection, experience memory, and local validation.

The full self-evolving agent path requires at least one LLM provider for new tool generation: 0G Compute through `ZERO_G_PRIVATE_KEY` or OpenAI fallback through `OPENAI_API_KEY`. Real permanent tool persistence requires 0G Storage credentials. ENS publishing and AXL collaboration are opt-in live integrations that must be validated in the developer's environment.

Repository validation command:

```bash
pnpm validate:framework
```

Core-package validation command:

```bash
pnpm --filter @zero-agents/core validate:install
```

## Install

```bash
npm install @zero-agents/core
```

`isolated-vm` is a native dependency. If a prebuilt binary is unavailable for your environment, Node native build tooling is required.

## Package Exports

Root import:

```ts
import {
  SelfEvolvingAgent,
  ToolRegistry,
  ToolSandbox,
  ToolEvaluator,
  ToolGenerator,
  EvolutionEngine,
  ExperienceMemory,
  StrategyAdapter,
  ReflectionEngine,
  ToolImprover,
  ENSIdentityManager,
  AXLClient,
  AgentCoordinator,
} from '@zero-agents/core';
```

Default export:

```ts
import SelfEvolvingAgent from '@zero-agents/core';
```

0G Storage subpath:

```ts
import { uploadToZeroG, downloadFromZeroG } from '@zero-agents/core/storage/zero-g';
```

## Main Flow

`SelfEvolvingAgent` is the reference composition for the framework.

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

When no reusable tool exists, the agent uses `EvolutionEngine`:

```text
generate tool
-> sandbox smoke run
-> evaluate
-> retry with feedback up to maxGenerationAttempts
-> save passing tool
```

## Quickstart

### Zero-Wallet Sandbox Smoke Test

This does not require 0G, ENS, AXL, or an LLM key.

```ts
import { ToolSandbox } from '@zero-agents/core';

const sandbox = new ToolSandbox({ allowUnsafeNodeVmFallback: true });

const result = await sandbox.run(
  `async function execute(params) {
    return { sum: params.a + params.b };
  }`,
  { a: 2, b: 3 }
);

if (!result.success) {
  throw new Error(result.error);
}

console.log(result.output); // { sum: 5 }
```

`allowUnsafeNodeVmFallback` is only for development. Node's `vm` module is not a hard security boundary.

To validate both the built package import and local registry behavior from this repository, run `pnpm validate:framework`.

### Agent With Tool Evolution

This example requires 0G Compute or OpenAI fallback for first-time tool generation. It also requires `ZERO_G_PRIVATE_KEY` for real 0G Storage persistence. Without those credentials, use the zero-wallet smoke test or the demo agent's offline fallback.

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

console.log(result.output);
console.log(result.toolUsed);
console.log(result.wasGenerated);
console.log(result.strategy);
console.log(result.reflection?.memoryNote);

agent.dispose();
```

You can also call `run()` with either a string or a full task object:

```ts
await agent.run('Fetch the current ETH price and return it as a number');
await agent.run({ description: 'Fetch ETH price', params: { symbol: 'ETH' } });
```

## Environment Variables Used By Core

Core source code reads only these environment variables directly:

| Variable | Used by | Purpose |
|---|---|---|
| `ZERO_G_PRIVATE_KEY` | `ToolRegistry`, `ToolGenerator`, `uploadToZeroG` | 0G Storage uploads and 0G Compute broker wallet |
| `OPENAI_API_KEY` | `ToolGenerator`, `ToolEvaluator` | OpenAI `gpt-4o-mini` fallback for tool generation and test-case generation |

Core does not directly read `ENS_PRIVATE_KEY`, `ENS_NAME`, or `SEPOLIA_RPC_URL`. Pass ENS values explicitly to `ENSIdentityManager`.

## Core Agent API

### `SelfEvolvingAgent`

```ts
new SelfEvolvingAgent(config: SelfEvolvingAgentConfig | AgentConfig)
```

Full config with 0G and optional identity/AXL:

```ts
interface SelfEvolvingAgentConfig {
  name: string;
  description?: string;
  capabilities?: string[];
  identity?: AgentIdentityProvider;
  zeroGPrivateKey: string;
  openAiKey?: string;
  axlPort?: number;
  registryPath?: string;
  axlEnabled?: boolean;
  maxGenerationAttempts?: number;
  evolutionTimeoutMs?: number;
  axlPollIntervalMs?: number;
  testCaseTimeoutMs?: number;
  allowUnsafeNodeVmFallback?: boolean;
  zeroGBlockchainRpc?: string;
  zeroGIndexerRpc?: string;
  indexCacheTtlMs?: number;
  experienceMemoryPath?: string;
}
```

Minimal/offline config:

```ts
interface AgentConfig {
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

Defaults:

| Option | Default |
|---|---|
| `axlPort` | `9002` |
| `axlEnabled` | `false` |
| `maxGenerationAttempts` | `3` |
| `evolutionTimeoutMs` | `120000` |
| `axlPollIntervalMs` | `500` |
| `testCaseTimeoutMs` | `30000` |
| `allowUnsafeNodeVmFallback` | `false` |
| `indexCacheTtlMs` | `60000` |
| `experienceMemoryPath` | `.zero-agent-experiences.json` in the current working directory |

Methods:

```ts
agent.getName(): string
agent.getDescription(): string
agent.getState(): AgentState
agent.evolve(): Promise<void>
agent.publishProfile(toolRegistryHash?: string): Promise<void>
agent.handleTask(task: TaskRequest): Promise<TaskResult>
agent.run(task: string | TaskRequest): Promise<TaskResult>
agent.collaborateWith(otherAgentEnsName: string, task: TaskRequest): Promise<TaskResult>
agent.getRegistry(): ToolRegistry
agent.getEvolutionEngine(): EvolutionEngine
agent.getExperienceMemory(): ExperienceMemory
agent.getStrategyAdapter(): StrategyAdapter
agent.getToolImprover(): ToolImprover
agent.getCoordinator(): AgentCoordinator | null
agent.dispose(): void
```

Events:

```ts
agent.on('step', (event: AgentStepEvent) => {
  console.log(event.type, event.message, event.data);
});
```

Step event types:

- `search`
- `miss`
- `strategy`
- `generating`
- `sandboxing`
- `evaluating`
- `saving`
- `executing`
- `reflecting`
- `done`
- `error`

### Task Types

```ts
interface TaskRequest {
  description: string;
  params?: object;
  context?: string;
}

interface TaskResult {
  output: unknown;
  toolUsed: string;
  wasGenerated: boolean;
  executionTimeMs: number;
  strategy?: StrategyName;
  strategyReason?: string;
  confidence?: number;
  reflection?: ReflectionResult;
  experienceId?: string;
  wasImproved?: boolean;
}
```

## Tools

Generated and imported tools use this shape:

```ts
interface Tool {
  id: string;
  name: string;
  description: string;
  code: string;
  schema: {
    input: object;
    output: object;
  };
  tags: string[];
  successRate: number;
  usageCount: number;
  createdAt: number;
  rootHash?: string;
}
```

`code` must be an async JavaScript function expression or declaration named/usable as `execute`, for example:

```ts
async function execute(params) {
  return { ok: true, input: params };
}
```

## Tool Registry

`ToolRegistry` stores tools and a metadata index.

```ts
new ToolRegistry(options?: ToolRegistryOptions)
new ToolRegistry(indexPointerPath?: string)
```

Options:

```ts
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

Storage mode behavior:

- `auto` uses 0G when a private key is available, otherwise local JSON.
- `zero-g` requires `zeroGPrivateKey` or `ZERO_G_PRIVATE_KEY`.
- `local` stores JSON blobs locally.
- Passing a string constructor argument is treated as an index pointer path and uses local storage.

Default files:

- `.zero-agent-index.json` stores the current index root hash pointer.
- `.zero-agent-tools.json` stores local JSON blobs when local mode is active.
- Local blob root hashes are deterministic SHA-256 strings prefixed with `local-`.

Methods:

```ts
registry.saveTool(tool: Tool): Promise<string>
registry.getTool(rootHash: string): Promise<Tool>
registry.getToolByName(name: string): Promise<Tool | null>
registry.getIndexRootHash(): Promise<string | null>
registry.getToolHistory(name: string): Promise<ToolHistory>
registry.searchTools(query: string): Promise<Tool[]>
registry.exportTools(): Promise<Tool[]>
registry.importTool(tool: Tool): Promise<string>
registry.updateIndex(tool: Tool): Promise<string>
registry.updateToolStats(tool: Tool): Promise<string>
registry.loadIndex(): Promise<Map<string, string>>
```

Search behavior:

- Searches name, description, and tags.
- Uses a cached metadata index before loading matched tool blobs.
- Filters weak matches below the internal threshold.
- Sorts by match score and then success rate.

Write behavior:

- Saves are serialized internally to avoid conflicting index writes.
- Tool stats updates require a `rootHash`.
- One previous root hash per tool name is preserved in index history.

## 0G Storage Helpers

Subpath:

```ts
import { uploadToZeroG, downloadFromZeroG } from '@zero-agents/core/storage/zero-g';
```

```ts
interface ZeroGStorageOptions {
  privateKey?: string;
  blockchainRpc?: string;
  indexerRpc?: string;
}
```

Functions:

```ts
uploadToZeroG(data: object, options?: ZeroGStorageOptions): Promise<string>
downloadFromZeroG(rootHash: string, options?: Pick<ZeroGStorageOptions, 'indexerRpc'>): Promise<object>
```

Defaults:

| Endpoint | Default |
|---|---|
| 0G EVM RPC | `https://evmrpc-testnet.0g.ai` |
| 0G indexer | `https://indexer-storage-testnet-turbo.0g.ai` |

Uploads and downloads retry up to three attempts with exponential backoff.

## Tool Generation

`ToolGenerator` creates tool objects from natural-language task descriptions.

```ts
new ToolGenerator(options?: ToolGeneratorOptions)
new ToolGenerator(fallbackToOpenAI?: boolean)

generator.generateTool(taskDescription: string): Promise<Tool>
```

Options:

```ts
interface ToolGeneratorOptions {
  fallbackToOpenAI?: boolean;
  zeroGPrivateKey?: string;
  openAiKey?: string;
  zeroGBlockchainRpc?: string;
}
```

Provider order:

1. 0G Compute through `@0glabs/0g-serving-broker` when a 0G private key is available.
2. OpenAI `gpt-4o-mini` when fallback is enabled and an OpenAI key is available.

The model must return JSON with:

- `name`
- `description`
- `code`
- `schema.input`
- `schema.output`
- `tags`

The returned tool has `successRate: 0`, `usageCount: 0`, and `createdAt` set. It is not saved by `ToolGenerator` itself.

## Evolution Engine

`EvolutionEngine` generates, tests, evaluates, retries, and saves tools.

```ts
new EvolutionEngine(
  generator?: ToolGenerator,
  sandbox?: ToolSandbox,
  evaluator?: ToolEvaluator,
  registry?: ToolRegistry,
  evolutionTimeoutMs?: number,
  maxGenerationAttempts?: number
)
```

Methods:

```ts
engine.evolve(taskDescription: string, sampleParams?: object): Promise<Tool>
engine.generateTool(taskDescription: string, sampleParams?: object): Promise<Tool>
```

Events:

- `generating`
- `sandboxing`
- `evaluating`
- `saving`

Defaults:

- `maxGenerationAttempts`: `3`
- `evolutionTimeoutMs`: `120000`
- evaluation pass threshold: `score >= 0.7`

If all attempts fail, `ToolGenerationError` is thrown with an `attempts` count.

## Sandbox

`ToolSandbox` executes generated JavaScript tools.

```ts
new ToolSandbox(options?: ToolSandboxOptions)

sandbox.run(toolCode: string, params: object, timeoutMs?: number): Promise<SandboxResult>
```

Options:

```ts
interface ToolSandboxOptions {
  allowUnsafeNodeVmFallback?: boolean;
  allowedFetchHostnames?: string[];
  maxFetchResponseBytes?: number;
}
```

Result:

```ts
interface SandboxResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionTimeMs: number;
}
```

Behavior:

- Prefers `isolated-vm` with a 16 MB isolate memory limit.
- Default execution timeout is `3000ms` unless overridden per run.
- Fails closed if `isolated-vm` is unavailable and `allowUnsafeNodeVmFallback` is not enabled.
- Provides `fetch` through a limited bridge.
- Supports optional hostname allowlisting for `fetch`.
- Limits fetched response bodies to `1 MiB` by default.
- Shadows dangerous globals such as `require`, `process`, `Function`, `eval`, `fs`, `child_process`, `net`, and `http`.

Security note: `allowUnsafeNodeVmFallback` uses Node's `vm` module and should not be treated as a production sandbox for hostile code.

## Tool Evaluation

`ToolEvaluator` scores a tool by running test cases through `ToolSandbox`.

```ts
new ToolEvaluator(sandbox?: ToolSandbox, openAiKey?: string, testCaseTimeoutMs?: number)

evaluator.evaluate(tool: Tool, testCases?: TestCase[]): Promise<EvalResult>
```

Types:

```ts
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

interface EvalResult {
  score: number;
  passed: boolean;
  testResults: TestCaseResult[];
  feedback: string;
}
```

Behavior:

- If test cases are provided, those are used directly.
- Otherwise, OpenAI `gpt-4o-mini` is used to generate two basic test cases when an OpenAI key is available.
- Without an OpenAI key, one schema-derived smoke test is used.
- If `expectedOutput` is present, output must exactly match by JSON serialization.
- If `expectedOutput` is absent, output must match the declared output schema.
- Empty output schemas do not pass without explicit expected output.
- Pass threshold is `score >= 0.7`.

## Experience Memory

`ExperienceMemory` stores task outcomes separately from executable tools.

```ts
new ExperienceMemory(options?: ExperienceMemoryOptions)
```

Options:

```ts
interface ExperienceMemoryOptions {
  filePath?: string;
  zeroG?: ZeroGStorageOptions;
  persistToZeroG?: boolean;
}
```

Record shape:

```ts
interface ExperienceRecord {
  id: string;
  agentName: string;
  task: string;
  strategy: string;
  toolUsed?: string;
  resultSummary?: string;
  success: boolean;
  qualityScore: number;
  reflection?: ReflectionResult;
  createdAt: number;
  storageHash?: string;
  metadata?: Record<string, unknown>;
}
```

Methods:

```ts
memory.saveExperience(experience): Promise<ExperienceRecord>
memory.listExperiences(agentName?: string): Promise<ExperienceRecord[]>
memory.findSimilarExperiences(task: string, limit?: number): Promise<ExperienceRecord[]>
memory.clearExperiences(): Promise<void>
```

Defaults and behavior:

- Default file: `.zero-agent-experiences.json` in the current working directory.
- Similarity is deterministic term matching.
- `qualityScore` is clamped to `0..100`.
- 0G persistence is opt-in with `persistToZeroG`; `SelfEvolvingAgent` uses local JSON by default.

## Strategy Adapter

`StrategyAdapter` chooses what the agent should try before execution.

```ts
new StrategyAdapter()

strategy.selectStrategy(input: StrategyAdapterInput): StrategyDecision
```

Strategies:

- `reuse_existing_tool`
- `generate_new_tool`
- `improve_existing_tool`
- `ask_another_agent`
- `reject_task`

Input and output:

```ts
interface StrategyAdapterInput {
  task: string;
  agentName?: string;
  availableTools?: Tool[];
  similarExperiences?: ExperienceRecord[];
}

interface StrategyDecision {
  strategy: StrategyName;
  confidence: number;
  reason: string;
  selectedToolName?: string;
  selectedToolId?: string;
}
```

Current deterministic behavior:

- High-quality similar success with a tool prefers reuse.
- Relevant existing tool prefers reuse.
- Similar failure with the same relevant tool prefers improvement.
- No useful tool or experience prefers generation.

The strategy type includes `ask_another_agent` and `reject_task`, but the current adapter does not actively select them.

## Reflection Engine

`ReflectionEngine` creates post-task learning data without an external API call.

```ts
new ReflectionEngine()

reflection.reflect(input: ReflectionInput): ReflectionResult
```

Result:

```ts
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

Scoring behavior:

- Failed result: `0`
- Successful result: starts at `80`
- Adds `10` when a tool was used
- Adds `5` when execution time is `<= 5000ms`
- Caps at `100`

## Tool Improver

`ToolImprover` asks a configured generator to produce an improved candidate for a failed or low-quality tool.

```ts
new ToolImprover(options?: ToolImproverOptions)

improver.improveTool(input: ToolImproverInput): Promise<ImprovedToolCandidate>
```

Important behavior:

- Requires a generator with `generateTool(taskDescription)`.
- Does not save or evaluate by itself.
- `SelfEvolvingAgent` evaluates and saves an improved tool only when the improved candidate passes evaluation.
- Version bumps patch versions like `1.0.0 -> 1.0.1`; unknown versions become `<version>.1`.

## ENS Identity

`ENSIdentityManager` implements `AgentIdentityProvider` with Sepolia ENS text records.

```ts
new ENSIdentityManager({
  ensName?: string,
  privateKey: string,
  rpcUrl?: string,
})
```

Default RPC:

```text
https://sepolia.drpc.org
```

Text records:

- `description`
- `capabilities`
- `zeroagent.toolRegistry`
- `zeroagent.axlPeerId`
- `url`

Methods:

```ts
ENSIdentityManager.autoDetect(privateKey: string, rpcUrl?: string): Promise<ENSIdentityManager | null>
identity.detectPrimaryName(): Promise<string | null>
identity.resolveAllNames(): Promise<string[]>
identity.getWalletAddress(): string
identity.hasEnsNameConfigured(): boolean
identity.resolveAddress(): Promise<string | null>
identity.getCapabilities(): Promise<string[]>
identity.getToolRegistryHash(): Promise<string | null>
identity.getAXLPeerId(): Promise<string | null>
identity.getAXLPeerIdForName(ensName: string): Promise<string | null>
identity.getProfile(): Promise<AgentProfile | null>
identity.setProfile(profile: AgentProfile): Promise<void>
identity.setToolRegistryHash(rootHash: string): Promise<void>
identity.setAXLPeerId(peerId: string): Promise<void>
identity.setAgentProfile(profile: AgentProfile): Promise<void>
identity.discoverAgentsByCapability(capability: string, knownAgentNames: string[]): Promise<string[]>
```

`SelfEvolvingAgent` can auto-detect an ENS identity when no identity provider is passed and a 0G private key is available. This uses reverse ENS lookup for the wallet's primary name.

ENS writes require:

- A private key for the wallet that controls the ENS resolver.
- Sepolia ETH for gas.
- A resolver configured for the ENS name.

## AXL Communication

`AXLClient` talks to a local Gensyn AXL HTTP node.

```ts
new AXLClient(config?: AXLClientConfig)
```

Options:

```ts
interface AXLClientConfig {
  axlPort?: number;
  taskTimeoutMs?: number;
  pollIntervalMs?: number;
}
```

Defaults:

- Base URL: `http://localhost:9002`
- Task timeout: `30000ms`
- Poll interval: `500ms`

Methods:

```ts
axl.getPeerId(): Promise<string>
axl.sendMessage(toPeerId: string, message: AgentMessage): Promise<void>
axl.startListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): Promise<void>
axl.stopListening(onMessage): void
axl.stop(): void
axl.sendTask(toPeerId: string, task: TaskRequest): Promise<TaskResult>
```

Endpoint behavior:

- Peer lookup tries `/info`, then `/topology`.
- Polling tries `/messages`, then `/recv`.
- Sending uses `POST /send` with `X-Destination-Peer-Id`.

Message types:

```ts
interface AgentMessage {
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping';
  requestId: string;
  payload: unknown;
  fromAgent?: string;
  timestamp: number;
}
```

`AgentCoordinator` routes AXL messages to a local agent.

```ts
new AgentCoordinator({ agent, registry, axlClient? })

coordinator.start(): Promise<void>
coordinator.stop(): void
coordinator.shareToolLibrary(toPeerId: string): Promise<void>
```

Inbound behavior:

- `task_request` calls local `agent.handleTask()` and sends a `task_result`.
- `tool_share` validates the payload and imports the tool into the registry.
- Tool-share import rejects code with dangerous patterns such as `require`, `process`, `eval`, dynamic `import`, `new Function`, `Proxy`, `Reflect`, `__proto__`, and prototype mutation helpers.

`SelfEvolvingAgent` starts AXL only when `axlEnabled: true`. If AXL initialization fails, it emits an `error` step and continues without P2P.

## Custom Identity Providers

You can provide your own identity backend by implementing `AgentIdentityProvider`.

```ts
interface AgentIdentityProvider {
  getProfile(): Promise<AgentProfile | null>;
  setProfile(profile: AgentProfile): Promise<void>;
  getToolRegistryHash(): Promise<string | null>;
  setToolRegistryHash(rootHash: string): Promise<void>;
  setAXLPeerId?(peerId: string): Promise<void>;
  getAXLPeerIdForName?(ensName: string): Promise<string | null>;
}

interface AgentProfile {
  description: string;
  capabilities: string[];
  toolRegistryHash: string;
  axlPeerId?: string;
  url?: string;
}
```

## Errors

Custom error classes exported by the package:

```ts
class ZeroAgentError extends Error {
  readonly code: string;
}

class ToolGenerationError extends ZeroAgentError {
  readonly attempts: number;
}

class SandboxError extends ZeroAgentError {}
class EvaluationError extends ZeroAgentError {}
class StorageError extends ZeroAgentError {}
class AXLError extends ZeroAgentError {}
```

Codes:

| Error | Code |
|---|---|
| `ToolGenerationError` | `TOOL_GENERATION_ERROR` |
| `SandboxError` | `SANDBOX_ERROR` |
| `EvaluationError` | `EVALUATION_ERROR` |
| `StorageError` | `STORAGE_ERROR` |
| `AXLError` | `AXL_ERROR` |

Not every thrown error is currently a custom `ZeroAgentError`. Some validation, ENS, and orchestration failures throw plain `Error`.

## Type Exports

Agent types:

- `SelfEvolvingAgentConfig`
- `AgentConfig`
- `AgentState`
- `AgentStepEvent`
- `TaskRequest`
- `TaskResult`

Tool and storage types:

- `Tool`
- `ToolHistory`
- `ToolRegistryOptions`
- `ZeroGStorageOptions`

Generation, sandbox, and evaluation types:

- `ToolGeneratorOptions`
- `ToolSandboxOptions`
- `SandboxResult`
- `EvalResult`
- `TestCase`
- `TestCaseResult`

Memory, strategy, reflection, and improvement types:

- `ExperienceRecord`
- `StrategyAdapterInput`
- `StrategyDecision`
- `StrategyName`
- `ReflectionInput`
- `ReflectionResult`
- `RecommendedStrategy`
- `ImprovedToolCandidate`
- `OriginalToolForImprovement`
- `ToolImproverInput`
- `ToolImproverOptions`

Identity and communication types:

- `AgentIdentityProvider`
- `AgentProfile`
- `ENSIdentityManagerConfig`
- `AgentMessage`
- `AXLClientConfig`
- `AgentCoordinatorConfig`

## Local Development Notes

The package is designed to work without live sponsor infrastructure for local framework development.

- No 0G key: `ToolRegistry` can use local JSON storage.
- No OpenAI key: `ToolEvaluator` uses schema-derived smoke tests.
- No ENS identity: `publishProfile()` is a no-op unless an identity provider is configured or auto-detected.
- No AXL node: AXL is not started unless `axlEnabled: true`; failed AXL initialization does not stop the agent.

Minimal local agent example:

```ts
const agent = new SelfEvolvingAgent({
  name: 'local-agent',
  allowUnsafeNodeVmFallback: true,
  axlEnabled: false,
});
```

This can reuse locally stored tools, but it cannot generate new tools unless 0G Compute or OpenAI credentials are available.

## Important Limitations

- Tools are stored as 0G Storage blobs or local JSON blobs, not as Ethereum contract state.
- Experience memory is local JSON by default; 0G experience persistence is opt-in only when using `ExperienceMemory` directly.
- `ask_another_agent` and `reject_task` exist in the strategy type, but the current deterministic adapter does not actively select them.
- AXL delegation through `collaborateWith()` requires an identity provider that can resolve `zeroagent.axlPeerId` for the target name.
- `ToolGenerator` depends on 0G Compute or OpenAI availability and model output quality.
- `ToolEvaluator` is a basic approval gate, not a formal verifier.
- `isolated-vm` is the intended sandbox path; Node `vm` fallback is development-only.
- For production use with hostile generated code, add process/container isolation and strict network policy around tool execution.
- ENS auto-detection depends on reverse ENS lookup and a Sepolia-compatible RPC.

## Build From Source

```bash
pnpm --filter @zero-agents/core build
pnpm --filter @zero-agents/core test:unit
```

## Published Files

The npm package publishes:

- `dist/`
- `README.md`
- `LICENSE`

Tests and TypeScript source files are not included in the published package.

## Repository

https://github.com/Amirjaved-dev/zero-agents

## License

MIT
