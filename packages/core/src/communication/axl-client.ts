import { randomUUID } from 'node:crypto';
import type { TaskRequest, TaskResult } from '../self-evolving-agent.js';
import { AXLError } from '../errors.js';

export interface AXLClientConfig {
  axlPort?: number;
  /** How long (ms) to wait for a task_result before rejecting. Default 30 000. */
  taskTimeoutMs?: number;
  /** How often (ms) to poll the AXL /recv endpoint for new messages. Default 500. */
  pollIntervalMs?: number;
}

export interface AgentMessage {
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping';
  requestId: string;
  payload: any;
  fromAgent?: string;
  timestamp: number;
}

interface PendingTaskRequest {
  resolve: (result: TaskResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ParsedInboxMessage {
  message: AgentMessage;
  fromPeerId: string;
}

export class AXLClient {
  private readonly axlPort: number;
  private readonly baseUrl: string;
  private readonly taskTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly listeners = new Set<(msg: AgentMessage, fromPeerId: string) => void>();
  private readonly pendingTaskRequests = new Map<string, PendingTaskRequest>();
  private readonly seenMessageKeys = new Set<string>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private isPolling = false;

  constructor(config: AXLClientConfig = {}) {
    this.axlPort = config.axlPort ?? 9002;
    this.baseUrl = `http://localhost:${this.axlPort}`;
    this.taskTimeoutMs = config.taskTimeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 500;
  }

  async getPeerId(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/topology`);
    if (!response.ok) {
      throw new AXLError(`AXL /topology failed with status ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!this.isRecord(data) || typeof data.our_public_key !== 'string' || data.our_public_key.length === 0) {
      throw new AXLError('AXL /topology response did not include our_public_key');
    }

    return data.our_public_key;
  }

  async sendMessage(toPeerId: string, message: AgentMessage): Promise<void> {
    const response = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Destination-Peer-Id': toPeerId
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      throw new AXLError(`AXL /send failed with status ${response.status}`);
    }
  }

  async startListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): Promise<void> {
    this.listeners.add(onMessage);
    this.ensurePolling();
  }

  stopListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): void {
    this.listeners.delete(onMessage);

    if (this.listeners.size === 0 && this.pendingTaskRequests.size === 0) {
      this.stop();
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }

    for (const [requestId, pending] of this.pendingTaskRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new AXLError(`AXL task request ${requestId} was cancelled`));
    }

    this.pendingTaskRequests.clear();
    this.listeners.clear();
  }

  async sendTask(toPeerId: string, task: TaskRequest): Promise<TaskResult> {
    this.ensurePolling();

    const requestId = randomUUID();
    const message: AgentMessage = {
      type: 'task_request',
      requestId,
      payload: task,
      timestamp: Date.now()
    };

    const resultPromise = new Promise<TaskResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTaskRequests.delete(requestId);
        reject(new AXLError(`AXL task request ${requestId} timed out after ${this.taskTimeoutMs}ms`));
      }, this.taskTimeoutMs);

      this.pendingTaskRequests.set(requestId, { resolve, reject, timeout });
    });

    try {
      await this.sendMessage(toPeerId, message);
    } catch (error) {
      const pending = this.pendingTaskRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingTaskRequests.delete(requestId);
      }

      throw error;
    }

    return resultPromise;
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;

    this.pollTimer = setInterval(() => {
      void this.pollMessages();
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();

    void this.pollMessages();
  }

  private async pollMessages(): Promise<void> {
    if (this.isPolling) return;

    this.isPolling = true;
    try {
      const response = await fetch(`${this.baseUrl}/recv`);
      if (!response.ok) return;

      const rawMessage = await response.text();
      const parsedMessage = this.parseReceivedMessage(rawMessage, response.headers.get('X-From-Peer-Id') ?? '');
      if (!parsedMessage) return;

      const messageKey = this.createMessageKey(parsedMessage);
      if (this.seenMessageKeys.has(messageKey)) return;

      this.rememberMessageKey(messageKey);
      this.resolvePendingTask(parsedMessage.message);

      for (const listener of this.listeners) {
        listener(parsedMessage.message, parsedMessage.fromPeerId);
      }
    } catch {
      return;
    } finally {
      this.isPolling = false;
    }
  }

  private resolvePendingTask(message: AgentMessage): void {
    if (message.type !== 'task_result') return;

    const pending = this.pendingTaskRequests.get(message.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingTaskRequests.delete(message.requestId);
    pending.resolve(message.payload as TaskResult);
  }

  private parseReceivedMessage(rawMessage: string, fromPeerId: string): ParsedInboxMessage | null {
    const parsedData = this.safeJsonParse(rawMessage);

    if (!this.isAgentMessage(parsedData)) return null;

    return {
      message: parsedData,
      fromPeerId
    };
  }

  private safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private isAgentMessage(value: unknown): value is AgentMessage {
    if (!this.isRecord(value)) return false;

    return (
      (value.type === 'task_request' || value.type === 'task_result' || value.type === 'tool_share' || value.type === 'ping') &&
      typeof value.requestId === 'string' &&
      typeof value.timestamp === 'number' &&
      'payload' in value &&
      (typeof value.fromAgent === 'string' || value.fromAgent === undefined)
    );
  }

  private createMessageKey(inboxMessage: ParsedInboxMessage): string {
    const { message, fromPeerId } = inboxMessage;
    return `${fromPeerId}:${message.type}:${message.requestId}:${message.timestamp}`;
  }

  private rememberMessageKey(messageKey: string): void {
    this.seenMessageKeys.add(messageKey);

    if (this.seenMessageKeys.size < 1_000) return;

    const oldestKey = this.seenMessageKeys.values().next().value;
    if (typeof oldestKey === 'string') {
      this.seenMessageKeys.delete(oldestKey);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
