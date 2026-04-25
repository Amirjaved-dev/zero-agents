import { randomUUID } from 'node:crypto';
import type { TaskRequest, TaskResult } from '../self-evolving-agent.js';

export interface AXLClientConfig {
  axlPort?: number;
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
  private readonly listeners = new Set<(msg: AgentMessage, fromPeerId: string) => void>();
  private readonly pendingTaskRequests = new Map<string, PendingTaskRequest>();
  private readonly seenMessageKeys = new Set<string>();
  private pollTimer?: ReturnType<typeof setInterval>;
  private isPolling = false;

  constructor(config: AXLClientConfig = {}) {
    this.axlPort = config.axlPort ?? 9002;
    this.baseUrl = `http://localhost:${this.axlPort}`;
  }

  async getPeerId(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/info`);
    if (!response.ok) {
      throw new Error(`AXL /info failed with status ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!this.isRecord(data) || typeof data.peerId !== 'string' || data.peerId.length === 0) {
      throw new Error('AXL /info response did not include peerId');
    }

    return data.peerId;
  }

  async sendMessage(toPeerId: string, message: AgentMessage): Promise<void> {
    const response = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        to: toPeerId,
        data: JSON.stringify(message)
      })
    });

    if (!response.ok) {
      throw new Error(`AXL /send failed with status ${response.status}`);
    }
  }

  async startListening(onMessage: (msg: AgentMessage, fromPeerId: string) => void): Promise<void> {
    this.listeners.add(onMessage);
    this.ensurePolling();
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
        reject(new Error(`AXL task request ${requestId} timed out after 30000ms`));
      }, 30_000);

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
    }, 500);

    void this.pollMessages();
  }

  private async pollMessages(): Promise<void> {
    if (this.isPolling) return;

    this.isPolling = true;
    try {
      const response = await fetch(`${this.baseUrl}/messages`);
      if (!response.ok) return;

      const rawMessages: unknown = await response.json();
      for (const inboxMessage of this.parseInbox(rawMessages)) {
        const messageKey = this.createMessageKey(inboxMessage);
        if (this.seenMessageKeys.has(messageKey)) continue;

        this.rememberMessageKey(messageKey);
        this.resolvePendingTask(inboxMessage.message);

        for (const listener of this.listeners) {
          listener(inboxMessage.message, inboxMessage.fromPeerId);
        }
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

  private parseInbox(rawMessages: unknown): ParsedInboxMessage[] {
    const messageList = Array.isArray(rawMessages)
      ? rawMessages
      : this.isRecord(rawMessages) && Array.isArray(rawMessages.messages)
        ? rawMessages.messages
        : [];

    return messageList.flatMap((rawMessage) => {
      const parsed = this.parseInboxMessage(rawMessage);
      return parsed ? [parsed] : [];
    });
  }

  private parseInboxMessage(rawMessage: unknown): ParsedInboxMessage | null {
    if (!this.isRecord(rawMessage)) return null;

    const fromPeerId = this.getPeerIdFromInboxMessage(rawMessage);
    const rawData = rawMessage.data ?? rawMessage.message;
    const parsedData = typeof rawData === 'string' ? this.safeJsonParse(rawData) : rawData;

    if (!this.isAgentMessage(parsedData)) return null;

    return {
      message: parsedData,
      fromPeerId
    };
  }

  private getPeerIdFromInboxMessage(rawMessage: Record<string, unknown>): string {
    const from = rawMessage.from ?? rawMessage.fromPeerId ?? rawMessage.peerId;
    return typeof from === 'string' ? from : '';
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

    if (this.seenMessageKeys.size <= 1_000) return;

    const oldestKey = this.seenMessageKeys.values().next().value;
    if (typeof oldestKey === 'string') {
      this.seenMessageKeys.delete(oldestKey);
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
}
