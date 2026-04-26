/**
 * ZeroAgent Framework
 * Self-evolving agents with distributed storage on 0G
 */

export { ToolRegistry } from './storage/tool-registry.js';
export { ToolGenerator } from './generation/tool-generator.js';
export { EvolutionEngine } from './evolution-engine.js';
export { ToolSandbox } from './sandbox/tool-sandbox.js';
export { ToolEvaluator } from './sandbox/tool-evaluator.js';
export { SelfEvolvingAgent } from './self-evolving-agent.js';
export { ENSIdentityManager } from './identity/ens-identity-manager.js';
export { AXLClient } from './communication/axl-client.js';
export { AgentCoordinator } from './communication/agent-coordinator.js';
export type { Tool, ToolHistory } from './storage/tool-registry.js';
export type { ToolRegistryOptions } from './storage/tool-registry.js';
export type { ZeroGStorageOptions } from './storage/zero-g.js';
export type { ToolGeneratorOptions } from './generation/tool-generator.js';
export type { SandboxResult } from './sandbox/tool-sandbox.js';
export type { EvalResult, TestCase, TestCaseResult } from './sandbox/tool-evaluator.js';
export type { AgentConfig, AgentState, AgentStepEvent, SelfEvolvingAgentConfig, TaskRequest, TaskResult } from './self-evolving-agent.js';
export type { EvolutionEvent } from './evolution-engine.js';
export type { AgentIdentityProvider, AgentProfile, ENSIdentityManagerConfig } from './identity/index.js';
export type { AgentMessage, AXLClientConfig } from './communication/axl-client.js';
export type { AgentCoordinatorConfig } from './communication/agent-coordinator.js';
export { SelfEvolvingAgent as default } from './self-evolving-agent.js';
