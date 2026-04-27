/**
 * @module @zero-agents/core
 *
 * ZeroAgent — a TypeScript framework for self-evolving AI agents.
 *
 * Agents start with zero tools, generate them on demand via LLM (0G Compute
 * with OpenAI fallback), store them permanently on-chain (0G Storage), and
 * reuse them across tasks and agent networks (Gensyn AXL).
 *
 * ### Quickstart
 * ```ts
 * import SelfEvolvingAgent from '@zero-agents/core';
 *
 * const agent = new SelfEvolvingAgent({
 *   name: 'my-agent',
 *   zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
 *   openAiKey: process.env.OPENAI_API_KEY,
 * });
 *
 * agent.on('step', (event) => console.log(`[${event.type}] ${event.message}`));
 *
 * const result = await agent.handleTask({ description: 'Fetch top HN stories' });
 * console.log(result.output);
 * ```
 */

// ─── Core agent ──────────────────────────────────────────────────────────────

/** The main agent class. Orchestrates tool search, generation, sandboxing, evaluation, and storage. */
export { SelfEvolvingAgent } from './self-evolving-agent.js';

/** Drives the LLM retry loop that generates and validates new tools. */
export { EvolutionEngine } from './evolution-engine.js';

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * Multi-level tool cache backed by 0G Storage.
 * Supports search, save, import/export, and per-tool history.
 */
export { ToolRegistry } from './storage/tool-registry.js';

// ─── Memory ──────────────────────────────────────────────────────────────────

/** Stores task experiences locally with optional best-effort 0G persistence. */
export { ExperienceMemory } from './memory/experience-memory.js';

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Calls the 0G Compute broker (with OpenAI fallback) to generate JavaScript tool code
 * from a natural-language task description.
 */
export { ToolGenerator } from './generation/tool-generator.js';

// ─── Sandbox ─────────────────────────────────────────────────────────────────

/**
 * Executes generated tool code in an isolated environment.
 * Uses `isolated-vm` (secure) with `node:vm` as a fallback.
 */
export { ToolSandbox } from './sandbox/tool-sandbox.js';

/**
 * Generates LLM-driven test cases for a tool and scores it pass/fail.
 * A score ≥ 0.7 is required for a tool to be saved.
 */
export { ToolEvaluator } from './sandbox/tool-evaluator.js';

// ─── Reflection ──────────────────────────────────────────────────────────────

/** Produces deterministic post-task learning data without external API calls. */
export { ReflectionEngine } from './reflection/reflection-engine.js';

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * Reads and writes agent identity (description, capabilities, tool registry hash,
 * AXL peer ID) to ENS text records on Sepolia.
 */
export { ENSIdentityManager } from './identity/ens-identity-manager.js';

// ─── Communication ───────────────────────────────────────────────────────────

/**
 * HTTP client for the Gensyn AXL peer-to-peer network.
 * Polls `/recv` for incoming messages and POSTs to `/send`.
 */
export { AXLClient } from './communication/axl-client.js';

/**
 * Routes incoming AXL messages to the local agent's `handleTask()` method
 * and supports tool-library sharing between peers.
 */
export { AgentCoordinator } from './communication/agent-coordinator.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Base class for all ZeroAgent framework errors.
 * All errors have a machine-readable `code` property.
 */
export { ZeroAgentError } from './errors.js';

/** Thrown when tool generation fails after all retry attempts. Has an `attempts` count. */
export { ToolGenerationError } from './errors.js';

/** Thrown when a tool fails inside the sandbox. */
export { SandboxError } from './errors.js';

/** Thrown when LLM test-case generation or scoring fails. */
export { EvaluationError } from './errors.js';

/** Thrown when a 0G Storage upload or download fails. */
export { StorageError } from './errors.js';

/** Thrown when an AXL (Gensyn P2P) operation fails. */
export { AXLError } from './errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A persisted tool: code, schema, tags, success rate, and 0G root hash. */
export type { Tool, ToolHistory } from './storage/tool-registry.js';

/** Constructor options for {@link ToolRegistry}. */
export type { ToolRegistryOptions } from './storage/tool-registry.js';

/** A stored task experience with reflection and optional 0G storage hash. */
export type { ExperienceRecord } from './memory/experience-memory.js';

/** Options for `uploadToZeroG` / `downloadFromZeroG` (private key, RPC overrides). */
export type { ZeroGStorageOptions } from './storage/zero-g.js';

/** Constructor options for {@link ToolGenerator}. */
export type { ToolGeneratorOptions } from './generation/tool-generator.js';

/** Return value from `ToolSandbox.run()`. */
export type { SandboxResult } from './sandbox/tool-sandbox.js';

/** Return value from `ToolEvaluator.evaluate()`. */
export type { EvalResult, TestCase, TestCaseResult } from './sandbox/tool-evaluator.js';

/** Full config for {@link SelfEvolvingAgent} (with 0G credentials). */
export type { SelfEvolvingAgentConfig } from './self-evolving-agent.js';

/** Minimal config for {@link SelfEvolvingAgent} (offline / testing). */
export type { AgentConfig } from './self-evolving-agent.js';

/** Snapshot of agent metadata (iteration count, AXL peer ID, etc.). */
export type { AgentState } from './self-evolving-agent.js';

/** Event emitted on each step of the agent loop. Listen via `agent.on('step', ...)`. */
export type { AgentStepEvent } from './self-evolving-agent.js';

/** A task submitted to `agent.handleTask()`. */
export type { TaskRequest } from './self-evolving-agent.js';

/** The result returned by `agent.handleTask()`. */
export type { TaskResult } from './self-evolving-agent.js';

/** Event emitted by {@link EvolutionEngine} on each generation step. */
export type { EvolutionEvent } from './evolution-engine.js';

/** Input and output types for post-task reflection. */
export type { ReflectionInput, ReflectionResult, RecommendedStrategy } from './reflection/reflection-engine.js';

/** Interface for identity providers (ENS, mock, etc.). */
export type { AgentIdentityProvider, AgentProfile } from './identity/index.js';

/** Constructor options for {@link ENSIdentityManager}. */
export type { ENSIdentityManagerConfig } from './identity/index.js';

/** An AXL network message (task_request, task_result, tool_share, ping). */
export type { AgentMessage, AXLClientConfig } from './communication/axl-client.js';

/** Constructor options for {@link AgentCoordinator}. */
export type { AgentCoordinatorConfig } from './communication/agent-coordinator.js';

// ─── Default export ───────────────────────────────────────────────────────────

export { SelfEvolvingAgent as default } from './self-evolving-agent.js';
