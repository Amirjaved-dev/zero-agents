import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { EvolutionEngine, type EvolutionEvent } from './evolution-engine.js';
import { ToolGenerator } from './generation/tool-generator.js';
import { ToolEvaluator, type EvalResult } from './sandbox/tool-evaluator.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';
import type { AgentIdentityProvider, AgentProfile } from './identity/types.js';
import { AgentCoordinator } from './communication/agent-coordinator.js';
import { AXLClient } from './communication/axl-client.js';
import { ReflectionEngine, type ReflectionResult } from './reflection/reflection-engine.js';
import { ExperienceMemory } from './memory/experience-memory.js';
import { StrategyAdapter, type StrategyDecision, type StrategyName } from './evolution/strategy-adapter.js';
import { ToolImprover, type ImprovedToolCandidate } from './tools/tool-improver.js';

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
  /** Development-only fallback for environments where isolated-vm is unavailable. Default: false. */
  allowUnsafeNodeVmFallback?: boolean;
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
  /** Development-only fallback for environments where isolated-vm is unavailable. Default: false. */
  allowUnsafeNodeVmFallback?: boolean;
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
  strategy?: StrategyName;
  strategyReason?: string;
  confidence?: number;
  reflection?: ReflectionResult;
  experienceId?: string;
  wasImproved?: boolean;
}

export interface AgentStepEvent {
  type: 'search' | 'miss' | 'strategy' | 'generating' | 'sandboxing' | 'evaluating' | 'saving' | 'executing' | 'reflecting' | 'done' | 'error';
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
  protected readonly strategyAdapter: StrategyAdapter;
  protected readonly toolImprover: ToolImprover;
  protected readonly toolEvaluator: ToolEvaluator;
  private readonly state: AgentState;
  private readonly identity?: AgentIdentityProvider;
  private readonly axlClient: AXLClient;
  private readonly axlEnabled: boolean;
  private axlReady?: Promise<void>;
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
    const generator = new ToolGenerator({ zeroGPrivateKey, openAiKey, zeroGBlockchainRpc });
    this.sandbox = new ToolSandbox({ allowUnsafeNodeVmFallback: config.allowUnsafeNodeVmFallback });
    this.reflectionEngine = new ReflectionEngine();
    this.experienceMemory = new ExperienceMemory({ filePath: config.experienceMemoryPath });
    this.strategyAdapter = new StrategyAdapter();
    this.toolImprover = new ToolImprover({ generator });
    this.toolEvaluator = new ToolEvaluator(this.sandbox, openAiKey, testCaseTimeoutMs);
    this.evolutionEngine = new EvolutionEngine(
      generator,
      this.sandbox,
      this.toolEvaluator,
      this.registry,
      evolutionTimeoutMs,
      maxGenerationAttempts
    );
    this.axlClient = new AXLClient({ axlPort: config.axlPort, pollIntervalMs: axlPollIntervalMs });
    this.axlEnabled = config.axlEnabled ?? false;
    this.evolutionEngine.on('step', (event) => this.emitStep(event));
    if (this.axlEnabled) {
      this.axlReady = this.initializeAXL();
    }
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
    let strategy: StrategyName = 'reuse_existing_tool';
    let strategyDecision: StrategyDecision | undefined;

    try {
      this.emitStep({ type: 'search', message: 'Searching for existing tool...', data: { task } });

      const tools = await this.registry.searchTools(task.description);
      this.emitStep({ type: 'strategy', message: 'Checking past experience...', data: { task } });
      const similarExperiences = await this.experienceMemory.findSimilarExperiences(task.description);
      strategyDecision = this.strategyAdapter.selectStrategy({
        task: task.description,
        agentName: this.name,
        availableTools: tools,
        similarExperiences
      });
      strategy = strategyDecision.strategy;
      this.emitStep({ type: 'strategy', message: `Strategy selected: ${strategyDecision.strategy}`, data: strategyDecision });
      this.emitStep({ type: 'strategy', message: `Reason: ${strategyDecision.reason}`, data: strategyDecision });

      if (strategyDecision.strategy === 'reject_task') {
        const result = this.createRejectionResult(strategyDecision, startedAt);
        await this.reflectAndSaveExperience(task, result, strategyDecision.strategy);
        this.emitStep({ type: 'done', message: 'Task complete.', data: result });
        return result;
      }

      let tool = strategyDecision.strategy === 'reuse_existing_tool'
        ? this.findSelectedTool(tools, strategyDecision) ?? this.findBestTool(tools)
        : null;
      let wasGenerated = false;

      if (!tool || tool.successRate <= 0.5 || strategyDecision.strategy !== 'reuse_existing_tool') {
        this.emitStep({ type: 'miss', message: 'No tool found. Generating new tool...', data: { task } });
        strategy = !tool || tool.successRate <= 0.5 || strategyDecision.strategy === 'ask_another_agent'
          ? 'generate_new_tool'
          : strategyDecision.strategy;
        tool = await this.evolutionEngine.evolve(task.description, task.params ?? {});
        wasGenerated = true;
      }
      selectedToolName = tool.name;

      let result: TaskResult;
      try {
        result = await this.executeWithTool(tool, task, wasGenerated, startedAt);
      } catch (executionError) {
        if (wasGenerated) {
          throw executionError;
        }

        result = await this.tryImproveAndExecuteTool(tool, task, executionError, startedAt);
        this.applyStrategyMetadata(result, strategyDecision);
        await this.reflectAndSaveExperience(
          task,
          result,
          result.wasImproved ? 'improve_existing_tool' : strategy,
          this.isGracefulToolErrorResult(result) ? result.output.error : undefined
        );
        this.emitStep({ type: 'done', message: 'Task complete.', data: result });
        return result;
      }
      this.applyStrategyMetadata(result, strategyDecision);
      await this.reflectAndSaveExperience(task, result, strategy);

      if (result.reflection?.improvementNeeded && !wasGenerated) {
        await this.trySaveImprovedVersion(tool, task, undefined, result.reflection);
        result.wasImproved = true;
      }

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
    await this.ensureAXLReady();

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

  getStrategyAdapter(): StrategyAdapter {
    return this.strategyAdapter;
  }

  getToolImprover(): ToolImprover {
    return this.toolImprover;
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
      executionTimeMs: Date.now() - startedAt,
      wasImproved: false
    };
  }

  protected applyStrategyMetadata(result: TaskResult, decision: StrategyDecision): void {
    result.strategy = decision.strategy;
    result.strategyReason = decision.reason;
    result.confidence = decision.confidence;
  }

  protected createRejectionResult(decision: StrategyDecision, startedAt = Date.now()): TaskResult {
    return {
      output: {
        rejected: true,
        reason: decision.reason
      },
      toolUsed: '',
      wasGenerated: false,
      executionTimeMs: Date.now() - startedAt,
      strategy: decision.strategy,
      strategyReason: decision.reason,
      confidence: decision.confidence,
      wasImproved: false
    };
  }

  protected findSelectedTool(tools: Tool[], decision: StrategyDecision): Tool | null {
    if (decision.selectedToolId) {
      const byId = tools.find((tool) => tool.id === decision.selectedToolId);
      if (byId) return byId;
    }

    if (decision.selectedToolName) {
      return tools.find((tool) => tool.name === decision.selectedToolName) ?? null;
    }

    return null;
  }

  protected async tryImproveAndExecuteTool(
    originalTool: Tool,
    task: TaskRequest,
    failureReason: unknown,
    startedAt: number
  ): Promise<TaskResult> {
    try {
      const improvedTool = await this.trySaveImprovedVersion(originalTool, task, this.getErrorMessage(failureReason));
      if (!improvedTool) {
        return this.createGracefulToolErrorResult(originalTool, failureReason, startedAt, false);
      }

      const result = await this.executeWithTool(improvedTool, task, false, startedAt);
      result.wasImproved = true;
      return result;
    } catch (error) {
      return this.createGracefulToolErrorResult(originalTool, error, startedAt, false);
    }
  }

  protected async trySaveImprovedVersion(
    originalTool: Tool,
    task: TaskRequest,
    failureReason?: string,
    reflection?: ReflectionResult
  ): Promise<Tool | null> {
    this.emitStep({ type: 'evaluating', message: 'Improvement needed...', data: { toolName: originalTool.name } });
    this.emitStep({ type: 'generating', message: 'Generating improved tool version...', data: { toolName: originalTool.name } });

    let candidate: ImprovedToolCandidate;
    try {
      candidate = await this.toolImprover.improveTool({
        originalTool: {
          id: originalTool.id,
          name: originalTool.name,
          description: originalTool.description,
          code: originalTool.code,
          version: this.getToolVersion(originalTool)
        },
        task: task.description,
        failureReason,
        reflection
      });
    } catch (error) {
      this.emitStep({ type: 'error', message: `Tool improvement skipped: ${this.getErrorMessage(error)}`, data: { error } });
      return null;
    }

    const improvedTool = this.createImprovedTool(originalTool, candidate);
    let evaluation: EvalResult;
    try {
      evaluation = await this.toolEvaluator.evaluate(improvedTool, [
        { input: task.params ?? {}, description: 'Improved tool smoke test' }
      ]);
    } catch (error) {
      this.emitStep({ type: 'error', message: `Improved tool evaluation failed: ${this.getErrorMessage(error)}`, data: { error } });
      return null;
    }

    improvedTool.successRate = evaluation.score;
    this.emitStep({
      type: 'evaluating',
      message: 'Improved tool evaluated...',
      data: { toolName: improvedTool.name, score: evaluation.score, passed: evaluation.passed }
    });

    if (!evaluation.passed) {
      return null;
    }

    try {
      await this.registry.saveTool(improvedTool);
    } catch (error) {
      this.emitStep({ type: 'error', message: `Saving improved version failed: ${this.getErrorMessage(error)}`, data: { error } });
      return null;
    }
    this.emitStep({ type: 'saving', message: 'Saved improved version...', data: { toolName: improvedTool.name } });
    return improvedTool;
  }

  protected createGracefulToolErrorResult(
    tool: Tool,
    error: unknown,
    startedAt: number,
    wasImproved: boolean
  ): TaskResult {
    return {
      output: {
        error: this.getErrorMessage(error),
        recovered: false
      },
      toolUsed: tool.name,
      wasGenerated: false,
      executionTimeMs: Date.now() - startedAt,
      wasImproved
    };
  }

  protected createImprovedTool(originalTool: Tool, candidate: ImprovedToolCandidate): Tool {
    return {
      id: randomUUID(),
      name: candidate.name,
      description: candidate.description,
      code: candidate.code,
      schema: originalTool.schema,
      tags: [...new Set([...originalTool.tags, 'improved'])],
      successRate: 0,
      usageCount: 0,
      createdAt: candidate.createdAt
    };
  }

  protected isGracefulToolErrorResult(result: TaskResult): result is TaskResult & { output: { error: string } } {
    return (
      result.output !== null &&
      typeof result.output === 'object' &&
      !Array.isArray(result.output) &&
      typeof (result.output as Record<string, unknown>).error === 'string'
    );
  }

  private getToolVersion(tool: Tool): string | undefined {
    const value = (tool as Tool & { version?: unknown }).version;
    return typeof value === 'string' ? value : undefined;
  }

  protected async reflectAndSaveExperience(task: TaskRequest, result: TaskResult, strategy: string, error?: unknown): Promise<void> {
    this.emitStep({ type: 'reflecting', message: 'Reflecting on result...', data: { task } });
    const reflection = this.reflectionEngine.reflect({
      agentName: this.name,
      task: task.description,
      strategy,
      toolUsed: result.toolUsed,
      result: error === undefined ? result.output : undefined,
      error,
      executionTimeMs: result.executionTimeMs
    });

    result.reflection = reflection;

    try {
      const experience = await this.experienceMemory.saveExperience({
        agentName: this.name,
        task: task.description,
        strategy,
        toolUsed: result.toolUsed,
        resultSummary: error === undefined ? this.summarizeResult(result.output) : this.getErrorMessage(error),
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

  private async ensureAXLReady(): Promise<void> {
    this.axlReady ??= this.initializeAXL();
    await this.axlReady;
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

      await this.registry.updateToolStats(tool);

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
