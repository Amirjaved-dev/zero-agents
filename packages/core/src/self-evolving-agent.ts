import { EventEmitter } from 'node:events';
import { EvolutionEngine, type EvolutionEvent } from './evolution-engine.js';
import { ToolGenerator } from './generation/tool-generator.js';
import { ToolEvaluator } from './sandbox/tool-evaluator.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';
import type { AgentIdentityProvider, AgentProfile } from './identity/types.js';
import { AgentCoordinator } from './communication/agent-coordinator.js';
import { AXLClient } from './communication/axl-client.js';

export interface SelfEvolvingAgentConfig {
  name: string;
  description?: string;
  capabilities?: string[];
  identity?: AgentIdentityProvider;
  zeroGPrivateKey: string;
  openAiKey?: string;
  axlPort?: number;
  registryPath?: string;
  axlEnabled?: boolean;
}

export interface AgentConfig {
  name: string;
  description?: string;
  axlPort?: number;
  registryPath?: string;
  axlEnabled?: boolean;
}

export interface AgentState {
  iteration: number;
  lastUpdate: number;
  metadata: Record<string, unknown>;
}

export interface TaskRequest {
  description: string;
  params?: object;
  context?: string;
}

export interface TaskResult {
  output: any;
  toolUsed: string;
  wasGenerated: boolean;
  executionTimeMs: number;
}

export interface AgentStepEvent {
  type: 'search' | 'miss' | 'generating' | 'sandboxing' | 'evaluating' | 'saving' | 'executing' | 'done' | 'error';
  message: string;
  data?: any;
}

export class SelfEvolvingAgent extends EventEmitter {
  readonly name: string;
  readonly description: string;
  readonly capabilities: string[];

  protected readonly registry: ToolRegistry;
  protected readonly sandbox: ToolSandbox;
  protected readonly evolutionEngine: EvolutionEngine;
  private readonly state: AgentState;
  private readonly identity?: AgentIdentityProvider;
  private readonly axlClient: AXLClient;
  private readonly axlReady: Promise<void>;
  private readonly axlEnabled: boolean;
  private coordinator?: AgentCoordinator;
  // Serialises concurrent tool-stat writes so two parallel tasks can't both
  // read usageCount=N, both write N+1, and lose one increment.
  private toolWriteLock = Promise.resolve();

  constructor(config: SelfEvolvingAgentConfig | AgentConfig) {
    super();

    this.name = config.name;
    this.description = config.description ?? '';
    this.capabilities = 'capabilities' in config ? config.capabilities ?? [] : [];
    this.identity = 'identity' in config ? config.identity : undefined;
    this.state = {
      iteration: 0,
      lastUpdate: Date.now(),
      metadata: {}
    };

    const zeroGPrivateKey = 'zeroGPrivateKey' in config ? config.zeroGPrivateKey : undefined;
    const openAiKey = 'openAiKey' in config ? config.openAiKey : undefined;

    this.registry = new ToolRegistry({ indexPointerPath: config.registryPath, zeroGPrivateKey });
    this.sandbox = new ToolSandbox();
    this.evolutionEngine = new EvolutionEngine(
      new ToolGenerator({ zeroGPrivateKey, openAiKey }),
      this.sandbox,
      new ToolEvaluator(this.sandbox, openAiKey),
      this.registry
    );
    this.axlClient = new AXLClient({ axlPort: config.axlPort });
    this.axlEnabled = config.axlEnabled ?? true;
    this.evolutionEngine.on('step', (event) => this.emitStep(event));
    this.axlReady = this.axlEnabled ? this.initializeAXL() : Promise.resolve();
  }

  override on(eventName: 'step', listener: (event: AgentStepEvent) => void): this;
  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
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

  async publishProfile(toolRegistryHash = ''): Promise<void> {
    if (!this.identity) return;

    await this.identity.setProfile(this.createAgentProfile(toolRegistryHash));
  }

  async handleTask(task: TaskRequest): Promise<TaskResult> {
    const startedAt = Date.now();

    try {
      this.emitStep({ type: 'search', message: 'Searching for existing tool...', data: { task } });

      const tools = await this.registry.searchTools(task.description);
      let tool = this.findBestTool(tools);
      let wasGenerated = false;

      if (!tool || tool.successRate <= 0.5) {
        this.emitStep({ type: 'miss', message: 'No tool found. Generating new tool...', data: { task } });
        tool = await this.evolutionEngine.evolve(task.description, task.params ?? {});
        wasGenerated = true;
      }

      const result = await this.executeWithTool(tool, task, wasGenerated, startedAt);

      this.emitStep({ type: 'done', message: 'Task complete.', data: result });
      return result;
    } catch (error) {
      this.emitStep({ type: 'error', message: this.getErrorMessage(error), data: { error } });
      throw error;
    }
  }

  async collaborateWith(otherAgentEnsName: string, task: TaskRequest): Promise<TaskResult> {
    await this.axlReady;

    if (!this.identity?.getAXLPeerIdForName) {
      throw new Error('Agent identity provider cannot resolve AXL peer IDs');
    }

    const peerId = await this.identity.getAXLPeerIdForName(otherAgentEnsName);
    if (!peerId) {
      throw new Error(`Could not resolve AXL peer ID for ${otherAgentEnsName}`);
    }

    return this.axlClient.sendTask(peerId, task);
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getEvolutionEngine(): EvolutionEngine {
    return this.evolutionEngine;
  }

  getCoordinator(): AgentCoordinator | null {
    return this.coordinator ?? null;
  }

  dispose(): void {
    this.coordinator?.stop();
    this.axlClient.stop();
  }

  protected async executeWithTool(tool: Tool, task: TaskRequest, wasGenerated = false, startedAt = Date.now()): Promise<TaskResult> {
    this.emitStep({ type: 'executing', message: `Executing tool ${tool.name}...`, data: { tool } });
    const sandboxResult = await this.sandbox.run(tool.code, task.params ?? {});

    if (!sandboxResult.success) {
      throw new Error(sandboxResult.error ?? 'Tool execution failed');
    }

    await this.recordToolResult(tool, true);

    return {
      output: sandboxResult.output,
      toolUsed: tool.name,
      wasGenerated,
      executionTimeMs: Date.now() - startedAt
    };
  }

  private async initializeAXL(): Promise<void> {
    try {
      const peerId = await this.axlClient.getPeerId();
      this.state.metadata.axlPeerId = peerId;

      if (this.identity?.setAXLPeerId) {
        try {
          await this.identity.setAXLPeerId(peerId);
        } catch (error) {
          console.warn('Failed to sync axlPeerId to identity provider:', error);
        }
      }

      this.coordinator = new AgentCoordinator({
        agent: this,
        registry: this.registry,
        axlClient: this.axlClient
      });
      await this.coordinator.start();
    } catch {
      return;
    }
  }

  private findBestTool(tools: Tool[]): Tool | null {
    if (tools.length === 0) {
      return null;
    }

    return [...tools].sort((a, b) => b.successRate - a.successRate || b.usageCount - a.usageCount)[0] ?? null;
  }

  private createAgentProfile(toolRegistryHash: string): AgentProfile {
    return {
      description: this.description,
      capabilities: this.capabilities,
      toolRegistryHash
    };
  }

  private async recordToolResult(tool: Tool, succeeded: boolean): Promise<void> {
    // Acquire a per-agent write lock so concurrent task executions can't both
    // read the same usageCount, both increment to the same value, and lose one write.
    const prev = this.toolWriteLock;
    let release!: () => void;
    this.toolWriteLock = new Promise<void>((res) => { release = res; });

    await prev;
    try {
      const nextUsageCount = tool.usageCount + 1;
      const nextSuccesses = tool.successRate * tool.usageCount + (succeeded ? 1 : 0);

      tool.usageCount = nextUsageCount;
      tool.successRate = nextSuccesses / nextUsageCount;

      await this.registry.saveTool(tool);

      if (this.identity) {
        try {
          const indexRootHash = await this.registry.getIndexRootHash();
          if (indexRootHash) {
            await this.identity.setToolRegistryHash(indexRootHash);
          }
        } catch (error) {
          console.warn('Failed to sync toolRegistryHash to identity provider:', error);
        }
      }
    } finally {
      release();
    }
  }

  private emitStep(event: AgentStepEvent | EvolutionEvent): void {
    this.emit('step', event);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export default SelfEvolvingAgent;
