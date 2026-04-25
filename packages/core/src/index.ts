/**
 * ZeroAgent Framework
 * Self-evolving agents with distributed storage on 0G
 */

export { ToolRegistry } from './storage/tool-registry.js';
export { ToolGenerator } from './generation/tool-generator.js';
export { ToolSandbox } from './sandbox/tool-sandbox.js';
export { ToolEvaluator } from './sandbox/tool-evaluator.js';
export type { Tool } from './storage/tool-registry.js';
export type { SandboxResult } from './sandbox/tool-sandbox.js';
export type { EvalResult, TestCase, TestCaseResult } from './sandbox/tool-evaluator.js';

export interface AgentConfig {
  name: string;
  description?: string;
}

export interface AgentState {
  iteration: number;
  lastUpdate: number;
  metadata: Record<string, unknown>;
}

/**
 * SelfEvolvingAgent - Base class for agents that evolve through iterations
 * stored and retrieved from 0G distributed storage
 */
export class SelfEvolvingAgent {
  private name: string;
  private description: string;
  private state: AgentState;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.description = config.description || '';
    this.state = {
      iteration: 0,
      lastUpdate: Date.now(),
      metadata: {}
    };
  }

  getName(): string {
    return this.name;
  }

  getDescription(): string {
    return this.description;
  }

  getState(): AgentState {
    return this.state;
  }

  async evolve(): Promise<void> {
    this.state.iteration += 1;
    this.state.lastUpdate = Date.now();
  }
}

export default SelfEvolvingAgent;
