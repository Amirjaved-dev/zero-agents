import { EventEmitter } from 'node:events';
import { EvolutionEngine, type EvolutionEvent } from './evolution-engine.js';
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
}

export interface AgentConfig {
  name: string;
  description?: string;
  axlPort?: number;
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

  private readonly registry: ToolRegistry;
  private readonly sandbox: ToolSandbox;
  private readonly evolutionEngine: EvolutionEngine;
  private readonly state: AgentState;
  private readonly identity?: AgentIdentityProvider;
  private readonly axlClient: AXLClient;
  private readonly axlReady: Promise<void>;

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

    if ('zeroGPrivateKey' in config) {
      process.env.ZERO_G_PRIVATE_KEY = config.zeroGPrivateKey;
    }

    if ('openAiKey' in config && config.openAiKey) {
      process.env.OPENAI_API_KEY = config.openAiKey;
    }

    this.registry = new ToolRegistry();
    this.sandbox = new ToolSandbox();
    this.evolutionEngine = new EvolutionEngine(undefined, this.sandbox, undefined, this.registry);
    this.axlClient = new AXLClient({ axlPort: config.axlPort });
    this.evolutionEngine.on('step', (event) => this.emitStep(event));
    this.axlReady = this.initializeAXL();
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
      console.log('Searching for existing tool...');
      this.emitStep({ type: 'search', message: 'Searching for existing tool...', data: { task } });

      const tools = await this.registry.searchTools(task.description);
      let tool = this.findBestTool(tools);
      let wasGenerated = false;

      if (!tool || tool.successRate <= 0.5) {
        console.log('No tool found. Generating new tool...');
        this.emitStep({ type: 'miss', message: 'No tool found. Generating new tool...', data: { task } });
        tool = await this.evolutionEngine.evolve(task.description, task.params ?? {});
        wasGenerated = true;
      }

      this.emitStep({ type: 'executing', message: `Executing tool ${tool.name}...`, data: { tool } });
      const sandboxResult = await this.sandbox.run(tool.code, task.params ?? {});

      if (!sandboxResult.success) {
        throw new Error(sandboxResult.error ?? 'Tool execution failed');
      }

      await this.recordToolResult(tool, true);

      const result: TaskResult = {
        output: sandboxResult.output,
        toolUsed: tool.name,
        wasGenerated,
        executionTimeMs: Date.now() - startedAt
      };

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

      const coordinator = new AgentCoordinator({
        agent: this,
        registry: this.registry,
        axlClient: this.axlClient
      });
      await coordinator.start();
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
  }

  private emitStep(event: AgentStepEvent | EvolutionEvent): void {
    this.emit('step', event);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export default SelfEvolvingAgent;
