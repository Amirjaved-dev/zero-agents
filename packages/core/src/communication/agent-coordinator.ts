import { randomUUID } from 'node:crypto';
import type { TaskRequest, TaskResult } from '../self-evolving-agent.js';
import { ToolRegistry, type Tool } from '../storage/tool-registry.js';
import { AXLClient, type AgentMessage } from './axl-client.js';

interface TaskHandlingAgent {
  getName(): string;
  handleTask(task: TaskRequest): Promise<TaskResult>;
}

export interface AgentCoordinatorConfig {
  agent: TaskHandlingAgent;
  registry: ToolRegistry;
  axlClient?: AXLClient;
}

export class AgentCoordinator {
  private readonly agent: TaskHandlingAgent;
  private readonly registry: ToolRegistry;
  private readonly axlClient: AXLClient;
  private readonly messageListener: (message: AgentMessage, fromPeerId: string) => void;
  private started = false;

  constructor(config: AgentCoordinatorConfig) {
    this.agent = config.agent;
    this.registry = config.registry;
    this.axlClient = config.axlClient ?? new AXLClient();
    this.messageListener = (message, fromPeerId) => {
      void this.handleMessage(message, fromPeerId).catch((error) => {
        console.warn('Failed to handle AXL message:', error);
      });
    };
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.axlClient.startListening(this.messageListener);
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;

    this.axlClient.stopListening(this.messageListener);
    this.started = false;
  }

  async shareToolLibrary(toPeerId: string): Promise<void> {
    const tools = await this.registry.exportTools();

    for (const tool of tools) {
      await this.axlClient.sendMessage(toPeerId, {
        type: 'tool_share',
        requestId: randomUUID(),
        payload: tool,
        fromAgent: this.agent.getName(),
        timestamp: Date.now()
      });
    }
  }

  private async handleMessage(message: AgentMessage, fromPeerId: string): Promise<void> {
    if (message.type === 'task_request') {
      await this.handleTaskRequest(message, fromPeerId);
      return;
    }

    if (message.type === 'tool_share') {
      await this.handleToolShare(message);
    }
  }

  private async handleTaskRequest(message: AgentMessage, fromPeerId: string): Promise<void> {
    if (!this.isTaskRequest(message.payload)) return;

    let result: TaskResult;
    try {
      result = await this.agent.handleTask(message.payload);
    } catch (error) {
      result = {
        output: { error: error instanceof Error ? error.message : String(error) },
        toolUsed: '',
        wasGenerated: false,
        executionTimeMs: 0
      };
    }

    await this.axlClient.sendMessage(fromPeerId, {
      type: 'task_result',
      requestId: message.requestId,
      payload: result,
      fromAgent: this.agent.getName(),
      timestamp: Date.now()
    });
  }

  private async handleToolShare(message: AgentMessage): Promise<void> {
    if (!this.isTool(message.payload)) return;
    await this.registry.importTool(message.payload);
  }

  private isTaskRequest(value: unknown): value is TaskRequest {
    if (!this.isRecord(value)) return false;

    return (
      typeof value.description === 'string' &&
      (value.params === undefined || this.isRecord(value.params)) &&
      (value.context === undefined || typeof value.context === 'string')
    );
  }

  private isTool(value: unknown): value is Tool {
    if (!this.isRecord(value)) return false;

    return (
      typeof value.id === 'string' &&
      typeof value.name === 'string' &&
      typeof value.description === 'string' &&
      typeof value.code === 'string' &&
      this.isRecord(value.schema) &&
      this.isRecord(value.schema.input) &&
      this.isRecord(value.schema.output) &&
      Array.isArray(value.tags) &&
      value.tags.every((tag) => typeof tag === 'string') &&
      typeof value.successRate === 'number' &&
      typeof value.usageCount === 'number' &&
      typeof value.createdAt === 'number' &&
      (value.rootHash === undefined || typeof value.rootHash === 'string')
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
