import { EventEmitter } from 'node:events';
import { EvolutionEngine, type EvolutionEvent } from './evolution-engine.js';
import { ToolGenerator } from './generation/tool-generator.js';
import { ToolEvaluator } from './sandbox/tool-evaluator.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';
import type { AgentIdentityProvider, AgentProfile } from './identity/types.js';
import { AgentCoordinator } from './communication/agent-coordinator.js';
import { AXLClient } from './communication/axl-client.js';
import { ReflectionEngine, type ReflectionResult } from './reflection/reflection-engine.js';
import { ExperienceMemory } from './memory/experience-memory.js';

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
  /** Maximum number of LLM generation attempts before giving up. Default: 3. */
  maxGenerationAttempts?: number;
  /** Total timeout (ms) for the entire tool evolution loop. Default: 120 000. */
  evolutionTimeoutMs?: number;
  /** Polling interval (ms) for the AXL /recv endpoint. Default: 500. */
  axlPollIntervalMs?: number;
  /** Timeout (ms) for LLM test-case generation per tool. Default: 30 000. */
  testCaseTimeoutMs?: number;
  /** Override the 0G EVM RPC endpoint. Defaults to the public 0G testnet. */
  zeroGBlockchainRpc?: string;
  /** Override the 0G Storage indexer endpoint. Defaults to the public 0G testnet indexer. */
  zeroGIndexerRpc?: string;
  /** How long (ms) to cache the downloaded tool index before re-fetching. Default: 60 000. */
  indexCacheTtlMs?: number;
  /** Local JSON path for task experience memory. Defaults to .zero-agent-experiences.json. */
  experienceMemoryPath?: string;
}

export interface AgentConfig {
  name: string;
  description?: string;
  axlPort?: number;
  registryPath?: string;
  axlEnabled?: boolean;
  /** Polling interval (ms) for the AXL /recv endpoint. Default: 500. */
  axlPollIntervalMs?: number;
  /** Local JSON path for task experience memory. Defaults to .zero-agent-experiences.json. */
  experienceMemoryPath?: string;
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
  reflection?: ReflectionResult;
  experienceId?: string;
}

export interface AgentStepEvent {
  type: 'search' | 'miss' | 'generating' | 'sandboxing' | 'evaluating' | 'saving' | 'executing' | 'reflecting' | 'done' | 'error';
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
  protected readonly reflectionEngine: ReflectionEngine;
  protected readonly experienceMemory: ExperienceMemory;
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
    const zeroGBlockchainRpc = 'zeroGBlockchainRpc' in config ? config.zeroGBlockchainRpc : undefined;
    const zeroGIndexerRpc = 'zeroGIndexerRpc' in config ? config.zeroGIndexerRpc : undefined;
    const indexCacheTtlMs = 'indexCacheTtlMs' in config ? config.indexCacheTtlMs : undefined;
    const maxGenerationAttempts = 'maxGenerationAttempts' in config ? config.maxGenerationAttempts : undefined;
    const evolutionTimeoutMs = 'evolutionTimeoutMs' in config ? config.evolutionTimeoutMs : undefined;
    const testCaseTimeoutMs = 'testCaseTimeoutMs' in config ? config.testCaseTimeoutMs : undefined;
    const axlPollIntervalMs = config.axlPollIntervalMs;

    this.registry = new ToolRegistry({
      indexPointerPath: config.registryPath,
      zeroGPrivateKey,
      indexCacheTtlMs,
      zeroGBlockchainRpc,
      zeroGIndexerRpc
    });
    this.sandbox = new ToolSandbox();
    this.reflectionEngine = new ReflectionEngine();
    this.experienceMemory = new ExperienceMemory({ filePath: config.experienceMemoryPath });
    this.evolutionEngine = new EvolutionEngine(
      new ToolGenerator({ zeroGPrivateKey, openAiKey, zeroGBlockchainRpc }),
      this.sandbox,
      new ToolEvaluator(this.sandbox, openAiKey, testCaseTimeoutMs),
      this.registry,
      evolutionTimeoutMs,
      maxGenerationAttempts
    );
    this.axlClient = new AXLClient({ axlPort: config.axlPort, pollIntervalMs: axlPollIntervalMs });
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
    let selectedToolName: string | undefined;
    let strategy = 'reuse_existing_tool';

    try {
      this.emitStep({ type: 'search', message: 'Searching for existing tool...', data: { task } });

      const tools = await this.registry.searchTools(task.description);
      let tool = this.findBestTool(tools);
      let wasGenerated = false;

      if (!tool || tool.successRate <= 0.5) {
        this.emitStep({ type: 'miss', message: 'No tool found. Generating new tool...', data: { task } });
        strategy = 'generate_new_tool';
        tool = await this.evolutionEngine.evolve(task.description, task.params ?? {});
        wasGenerated = true;
      }
      selectedToolName = tool.name;

      const result = await this.executeWithTool(tool, task, wasGenerated, startedAt);
      await this.reflectAndSaveExperience(task, result, strategy);

      this.emitStep({ type: 'done', message: 'Task complete.', data: result });
      return result;
    } catch (error) {
      await this.reflectAndSaveFailure(task, error, strategy, Date.now() - startedAt, selectedToolName);
      this.emitStep({ type: 'error', message: this.getErrorMessage(error), data: { error } });
      throw error;
    }
  }

  async run(task: string | TaskRequest): Promise<TaskResult> {
    return this.handleTask(typeof task === 'string' ? { description: task } : task);
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

  getExperienceMemory(): ExperienceMemory {
    return this.experienceMemory;
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

  protected async reflectAndSaveExperience(task: TaskRequest, result: TaskResult, strategy: string): Promise<void> {
    this.emitStep({ type: 'reflecting', message: 'Reflecting on result...', data: { task } });
    const reflection = this.reflectionEngine.reflect({
      agentName: this.name,
      task: task.description,
      strategy,
      toolUsed: result.toolUsed,
      result: result.output,
      executionTimeMs: result.executionTimeMs
    });

    result.reflection = reflection;

    try {
      const experience = await this.experienceMemory.saveExperience({
        agentName: this.name,
        task: task.description,
        strategy,
        toolUsed: result.toolUsed,
        resultSummary: this.summarizeResult(result.output),
        success: reflection.success,
        qualityScore: reflection.qualityScore,
        reflection
      });

      result.experienceId = experience.id;
      this.emitStep({ type: 'saving', message: 'Experience saved...', data: { experienceId: experience.id } });
    } catch (error) {
      this.emitStep({
        type: 'error',
        message: `Experience save failed (task result will still be returned): ${this.getErrorMessage(error)}`,
        data: { error }
      });
    }
  }

  protected async reflectAndSaveFailure(
    task: TaskRequest,
    error: unknown,
    strategy: string,
    executionTimeMs: number,
    toolUsed?: string
  ): Promise<void> {
    this.emitStep({ type: 'reflecting', message: 'Reflecting on result...', data: { task } });
    const reflection = this.reflectionEngine.reflect({
      agentName: this.name,
      task: task.description,
      strategy,
      toolUsed,
      error,
      executionTimeMs
    });

    try {
      const experience = await this.experienceMemory.saveExperience({
        agentName: this.name,
        task: task.description,
        strategy,
        toolUsed,
        resultSummary: this.getErrorMessage(error),
        success: false,
        qualityScore: reflection.qualityScore,
        reflection
      });

      this.emitStep({ type: 'saving', message: 'Experience saved...', data: { experienceId: experience.id } });
    } catch (saveError) {
      this.emitStep({
        type: 'error',
        message: `Experience save failed (original error will still be thrown): ${this.getErrorMessage(saveError)}`,
        data: { error: saveError }
      });
    }
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
    } catch (error) {
      // AXL is optional — agent continues without P2P if the node is unavailable.
      // Emit a visible step event so callers are not silently surprised.
      this.emitStep({
        type: 'error',
        message: `AXL initialization failed (agent will continue without P2P): ${this.getErrorMessage(error)}`,
        data: { error }
      });
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

  private summarizeResult(result: unknown): string {
    if (typeof result === 'string') {
      return result.slice(0, 500);
    }

    try {
      return JSON.stringify(result).slice(0, 500);
    } catch {
      return String(result).slice(0, 500);
    }
  }
}

export default SelfEvolvingAgent;
