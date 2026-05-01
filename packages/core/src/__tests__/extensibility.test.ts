import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReflectionEngine, SelfEvolvingAgent, ToolGenerator } from '../index.js';

test('tool generator prompt includes runtime hints and appended system prompt', () => {
  const generator = new ToolGenerator({
    systemPromptAppend: 'Pan-specific rule: handle missing params safely.',
    runtimeHints: ['Use fetch instead of Node APIs.', 'Return structured errors safely.']
  });

  const messages = generator.createMessages('fetch btc price');
  assert.match(messages[0]?.content ?? '', /Pan-specific rule/);
  assert.match(messages[0]?.content ?? '', /Use fetch instead of Node APIs/);
});

test('tool generator normalizes common wrapped LLM output shapes', () => {
  const generator = new ToolGenerator(false);
  const payload = generator.parseGeneratedTool(JSON.stringify({
    generatedTool: {
      toolName: 'price_tool',
      summary: 'Fetches a price',
      functionCode: 'async function execute(params) { return 1; }',
      tags: ['price']
    }
  }));

  assert.equal(payload.name, 'price_tool');
  assert.equal(payload.description, 'Fetches a price');
  assert.equal(payload.code, 'async function execute(params) { return 1; }');
  assert.deepEqual(payload.schema, { input: {}, output: {} });
});

test('reflection treats structured error output as failure', () => {
  const reflection = new ReflectionEngine().reflect({
    task: 'fetch price',
    strategy: 'reuse_existing_tool',
    toolUsed: 'price_tool',
    result: { error: 'API failed' },
    executionTimeMs: 10
  });

  assert.equal(reflection.success, false);
  assert.equal(reflection.qualityScore, 0);
  assert.match(reflection.whatFailed, /API failed/);
});

test('agent registry config supports first-class local storage paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-agent-extensibility-registry-'));
  const agent = new SelfEvolvingAgent({
    name: 'registry-config-agent',
    registry: {
      storageMode: 'local',
      indexPointerPath: join(dir, 'index.json'),
      localStorePath: join(dir, 'tools.json')
    },
    experienceMemoryPath: join(dir, 'experiences.json'),
    allowUnsafeNodeVmFallback: true
  });

  await agent.getRegistry().saveTool({
    id: 'tool-1',
    name: 'hello_tool',
    description: 'Says hello',
    code: 'async function execute(params) { return "hello"; }',
    schema: { input: {}, output: { type: 'string' } },
    tags: ['hello'],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now()
  });

  const tools = await agent.getRegistry().searchTools('hello');
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, 'hello_tool');
});

test('agent built-in chat gate avoids tool generation for greetings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-agent-extensibility-chat-'));
  const agent = new SelfEvolvingAgent({
    name: 'chat-gate-agent',
    registry: {
      storageMode: 'local',
      indexPointerPath: join(dir, 'index.json'),
      localStorePath: join(dir, 'tools.json')
    },
    experienceMemoryPath: join(dir, 'experiences.json'),
    allowUnsafeNodeVmFallback: true
  });

  const result = await agent.handleTask({ description: 'hi' });
  assert.equal(result.wasGenerated, false);
  assert.equal(result.toolUsed, '');
  assert.equal(result.strategy, 'reject_task');
});
