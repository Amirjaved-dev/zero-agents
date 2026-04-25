import { EventEmitter } from 'node:events';
import { EvolutionEngine, type EvolutionEvent } from './evolution-engine.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';

export interface SelfEvolvingAgentConfig {
  name: string;
  ensName?: string;
  description?: string;
  capabilities?: string[];
  zeroGPrivateKey: string;
  openAiKey?: string;
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
  readonly ensName?: string;
  readonly description: string;
  readonly capabilities: string[];

  private readonly registry: ToolRegistry;
  private readonly sandbox: ToolSandbox;
  private readonly evolutionEngine: EvolutionEngine;

  constructor(config: SelfEvolvingAgentConfig) {
    super();

    this.name = config.name;
    this.ensName = config.ensName;
    this.description = config.description ?? '';
    this.capabilities = config.capabilities ?? [];

    process.env.ZERO_G_PRIVATE_KEY = config.zeroGPrivateKey;
    if (config.openAiKey) {
      process.env.OPENAI_API_KEY = config.openAiKey;
    }

    this.registry = new ToolRegistry();
    this.sandbox = new ToolSandbox();
    this.evolutionEngine = new EvolutionEngine(undefined, this.sandbox, undefined, this.registry);
    this.evolutionEngine.on('step', (event) => this.emitStep(event));
  }

  override on(eventName: 'step', listener: (event: AgentStepEvent) => void): this;
  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
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

  private findBestTool(tools: Tool[]): Tool | null {
    if (tools.length === 0) {
      return null;
    }

    return [...tools].sort((a, b) => b.successRate - a.successRate || b.usageCount - a.usageCount)[0] ?? null;
  }

  private async recordToolResult(tool: Tool, succeeded: boolean): Promise<void> {
    const nextUsageCount = tool.usageCount + 1;
    const nextSuccesses = tool.successRate * tool.usageCount + (succeeded ? 1 : 0);

    tool.usageCount = nextUsageCount;
    tool.successRate = nextSuccesses / nextUsageCount;

    await this.registry.saveTool(tool);
  }

  private emitStep(event: AgentStepEvent | EvolutionEvent): void {
    this.emit('step', event);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export default SelfEvolvingAgent;
