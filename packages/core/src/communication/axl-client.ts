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
    const data = await this.fetchJsonFromFirstAvailable(['/info', '/topology']);
    const peerId = this.extractPeerId(data);

    if (!peerId) {
      throw new AXLError('AXL peer info response did not include a peer ID');
    }

    return peerId;
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
      const response = await this.fetchFromFirstAvailable(['/messages', '/recv']);
      if (!response.ok) return;

      const rawMessage = await response.text();
      const parsedMessages = this.parseReceivedMessages(rawMessage, response.headers.get('X-From-Peer-Id') ?? '');

      for (const parsedMessage of parsedMessages) {
        const messageKey = this.createMessageKey(parsedMessage);
        if (this.seenMessageKeys.has(messageKey)) continue;

        this.rememberMessageKey(messageKey);
        this.resolvePendingTask(parsedMessage.message);

        for (const listener of this.listeners) {
          listener(parsedMessage.message, parsedMessage.fromPeerId);
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

  private async fetchJsonFromFirstAvailable(paths: string[]): Promise<unknown> {
    const response = await this.fetchFromFirstAvailable(paths);
    return response.json() as Promise<unknown>;
  }

  private async fetchFromFirstAvailable(paths: string[]): Promise<Response> {
    let lastStatus = 0;

    for (const path of paths) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`);
        if (response.ok || response.status !== 404) {
          return response;
        }
        lastStatus = response.status;
      } catch (error) {
        if (path === paths[paths.length - 1]) {
          throw error;
        }
      }
    }

    throw new AXLError(`AXL endpoints unavailable; last status ${lastStatus}`);
  }

  private extractPeerId(data: unknown): string | null {
    if (!this.isRecord(data)) return null;

    const candidates = [data.peerId, data.peer_id, data.publicKey, data.public_key, data.our_public_key];
    const peerId = candidates.find((value) => typeof value === 'string' && value.length > 0);
    return typeof peerId === 'string' ? peerId : null;
  }

  private parseReceivedMessages(rawMessage: string, fromPeerId: string): ParsedInboxMessage[] {
    const parsedData = this.safeJsonParse(rawMessage);

    if (this.isAgentMessage(parsedData)) {
      return [{ message: parsedData, fromPeerId }];
    }

    if (Array.isArray(parsedData)) {
      return parsedData.flatMap((item) => this.parseInboxItem(item, fromPeerId));
    }

    if (this.isRecord(parsedData) && Array.isArray(parsedData.messages)) {
      return parsedData.messages.flatMap((item) => this.parseInboxItem(item, fromPeerId));
    }

    return [];
  }

  private parseInboxItem(value: unknown, fallbackPeerId: string): ParsedInboxMessage[] {
    if (this.isAgentMessage(value)) {
      return [{ message: value, fromPeerId: fallbackPeerId }];
    }

    if (!this.isRecord(value)) return [];

    const payload = value.message ?? value.payload;
    if (!this.isAgentMessage(payload)) return [];

    const fromPeerId = typeof value.fromPeerId === 'string'
      ? value.fromPeerId
      : typeof value.from_peer_id === 'string'
        ? value.from_peer_id
        : fallbackPeerId;

    return [{ message: payload, fromPeerId }];
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
