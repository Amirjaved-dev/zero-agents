import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SelfEvolvingAgent, type StrategyDecision, type Tool } from '../index.js';

class GeneratedToolAgent extends SelfEvolvingAgent {
  protected override async trySaveImprovedVersion(
    _originalTool: Tool,
    _task: { description: string; params?: object; context?: string },
    _failureReason?: string,
    _reflection?: unknown
  ): Promise<Tool | null> {
    return null;
  }

  exposeActualStrategyDecision(original: StrategyDecision): StrategyDecision {
    return this.createActualStrategyDecision(original, 'generate_new_tool', 'Generated instead.');
  }
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: randomUUID(),
    name: 'eth_price_fetcher',
    description: 'Fetches the current ETH price',
    code: 'async function execute(params) { return 3200; }',
    schema: { input: {}, output: { type: 'number' } },
    tags: ['eth', 'price'],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now(),
    ...overrides
  };
}

test('generated execution reports generate_new_tool strategy metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-agent-strategy-test-'));
  const agent = new GeneratedToolAgent({
    name: 'strategy-test-agent',
    registryPath: join(dir, 'index.json'),
    experienceMemoryPath: join(dir, 'experiences.json'),
    allowUnsafeNodeVmFallback: true
  });

  const tool = makeTool({ successRate: 0.4 });
  await agent.getRegistry().saveTool(tool);

  const generatedTool = makeTool({
    name: 'generated_eth_price_fetcher',
    description: 'Generated ETH price fetcher',
    tags: ['eth', 'price', 'generated']
  });

  const originalEvolve = agent.getEvolutionEngine().evolve.bind(agent.getEvolutionEngine());
  agent.getEvolutionEngine().evolve = async () => {
    await agent.getRegistry().saveTool(generatedTool);
    return generatedTool;
  };

  try {
    const result = await agent.handleTask({ description: 'fetch current eth price' });

    assert.equal(result.wasGenerated, true);
    assert.equal(result.strategy, 'generate_new_tool');
    assert.match(result.strategyReason ?? '', /generated/i);
  } finally {
    agent.getEvolutionEngine().evolve = originalEvolve;
  }
});

test('actual strategy decision clears generated-tool selection fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-agent-strategy-decision-test-'));
  const agent = new GeneratedToolAgent({
    name: 'strategy-decision-test-agent',
    registryPath: join(dir, 'index.json'),
    experienceMemoryPath: join(dir, 'experiences.json'),
    allowUnsafeNodeVmFallback: true
  });

  const original: StrategyDecision = {
    strategy: 'reuse_existing_tool',
    confidence: 0.7,
    reason: 'Existing tool appeared relevant.',
    selectedToolName: 'stale_tool',
    selectedToolId: 'stale-id'
  };

  const actual = agent.exposeActualStrategyDecision(original);
  assert.equal(actual.strategy, 'generate_new_tool');
  assert.equal(actual.selectedToolName, undefined);
  assert.equal(actual.selectedToolId, undefined);
});
