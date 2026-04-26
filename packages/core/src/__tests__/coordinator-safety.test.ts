/**
 * Tests for AgentCoordinator's isToolCodeSafe() defence-in-depth filter.
 * We test behaviour indirectly: inject a tool_share message via the AXL
 * listener and check whether the mock registry received an importTool call.
 *
 * No external credentials needed.
 *
 * Usage:
 *   tsx packages/core/src/__tests__/coordinator-safety.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentCoordinator, type AgentCoordinatorConfig } from '../communication/agent-coordinator.js';
import type { AgentMessage } from '../communication/axl-client.js';
import type { Tool } from '../storage/tool-registry.js';
import type { TaskRequest, TaskResult } from '../self-evolving-agent.js';

// ─── Minimal stubs ─────────────────────────────────────────────────────────

type MessageListener = (msg: AgentMessage, fromPeerId: string) => void;

class MockAgent {
  getName(): string { return 'mock-agent'; }
  handleTask(_task: TaskRequest): Promise<TaskResult> {
    return Promise.resolve({ output: null, toolUsed: '', wasGenerated: false, executionTimeMs: 0 });
  }
}

class MockRegistry {
  imported: Tool[] = [];
  async importTool(tool: Tool): Promise<string> {
    this.imported.push(tool);
    return tool.rootHash ?? 'mock-hash';
  }
  async searchTools(_query: string): Promise<Tool[]> { return []; }
  async exportTools(): Promise<Tool[]> { return []; }
}

class MockAXLClient {
  listener: MessageListener | null = null;
  sent: Array<{ toPeerId: string; message: AgentMessage }> = [];

  async startListening(cb: MessageListener): Promise<void> {
    this.listener = cb;
  }
  stopListening(_cb: MessageListener): void {
    this.listener = null;
  }
  async sendMessage(toPeerId: string, message: AgentMessage): Promise<void> {
    this.sent.push({ toPeerId, message });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeTool(code: string): Tool {
  return {
    id: 'test-id',
    name: 'test_tool',
    description: 'a test tool',
    code,
    schema: { input: {}, output: {} },
    tags: [],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now(),
  };
}

function makeToolShareMsg(tool: Tool): AgentMessage {
  return {
    type: 'tool_share',
    requestId: 'req-1',
    payload: tool,
    timestamp: Date.now(),
  };
}

async function wasToolImported(code: string): Promise<boolean> {
  const registry = new MockRegistry();
  const axl = new MockAXLClient();

  const config: AgentCoordinatorConfig = {
    agent: new MockAgent(),
    // MockRegistry and MockAXLClient satisfy the structural types that
    // AgentCoordinator depends on, so the casts below are safe.
    registry: registry as unknown as AgentCoordinatorConfig['registry'],
    axlClient: axl as unknown as AgentCoordinatorConfig['axlClient'],
  };

  const coordinator = new AgentCoordinator(config);
  await coordinator.start();

  if (!axl.listener) {
    throw new Error('AgentCoordinator did not register an AXL listener');
  }

  axl.listener(makeToolShareMsg(makeTool(code)), 'peer-xyz');
  // Allow the async handler to complete
  await new Promise<void>((r) => setTimeout(r, 30));

  coordinator.stop();
  return registry.imported.length > 0;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

test('safe tool code is accepted and imported', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { return params.x + 1; }'
  );
  assert.equal(imported, true, 'safe tool should be imported');
});

test('require(...) is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { const fs = require("fs"); return fs.readFileSync("/etc/passwd"); }'
  );
  assert.equal(imported, false, 'tool with require() should be rejected');
});

test('process.exit is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { process.exit(0); }'
  );
  assert.equal(imported, false, 'tool with process.exit should be rejected');
});

test('eval(...) is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { return eval("1+1"); }'
  );
  assert.equal(imported, false, 'tool with eval() should be rejected');
});

test('new Function(...) is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { return new Function("return 42")(); }'
  );
  assert.equal(imported, false, 'tool with new Function() should be rejected');
});

test('dynamic import() is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { const m = await import("fs"); return m; }'
  );
  assert.equal(imported, false, 'tool with dynamic import() should be rejected');
});

test('__proto__ manipulation is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { ({}).__proto__.evil = true; return true; }'
  );
  assert.equal(imported, false, 'tool with __proto__ should be rejected');
});

test('Proxy constructor is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { return new Proxy({}, {}); }'
  );
  assert.equal(imported, false, 'tool using Proxy() should be rejected');
});

test('Reflect API is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { return Reflect.ownKeys(params); }'
  );
  assert.equal(imported, false, 'tool using Reflect should be rejected');
});

test('child_process is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { const cp = require("child_process"); return cp; }'
  );
  assert.equal(imported, false, 'tool using child_process should be rejected');
});

test('Object.defineProperty is blocked', async () => {
  const imported = await wasToolImported(
    'async function execute(params) { Object.defineProperty(params, "x", { value: 99 }); return params.x; }'
  );
  assert.equal(imported, false, 'tool using Object.defineProperty should be rejected');
});
