import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ExperienceMemory,
  ReflectionEngine,
  StrategyAdapter,
  ToolImprover,
  type ExperienceRecord,
  type Tool
} from '../packages/core/dist/index.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function createTool(): Tool {
  return {
    id: 'tool-fetch-eth-price',
    name: 'fetch_eth_price',
    description: 'Fetches the current ETH price from an API',
    code: 'async function execute(params) { return 3200; }',
    schema: {
      input: {},
      output: {}
    },
    tags: ['eth', 'price'],
    successRate: 0.95,
    usageCount: 3,
    createdAt: Date.now()
  };
}

async function main(): Promise<void> {
  console.log('Testing evolution modules...');

  const reflectionEngine = new ReflectionEngine();
  const successfulReflection = reflectionEngine.reflect({
    agentName: 'research-agent',
    task: 'fetch the current ETH price',
    strategy: 'reuse_existing_tool',
    toolUsed: 'fetch_eth_price',
    result: 3200,
    executionTimeMs: 100
  });

  assert(successfulReflection.success, 'Expected successful reflection to mark success true');
  assert(successfulReflection.qualityScore === 95, 'Expected successful reflection quality score to be 95');
  assert(!successfulReflection.improvementNeeded, 'Expected successful reflection to avoid improvement flag');

  const failedReflection = reflectionEngine.reflect({
    agentName: 'research-agent',
    task: 'fetch the current ETH price',
    strategy: 'reuse_existing_tool',
    toolUsed: 'fetch_eth_price',
    error: new Error('API timeout')
  });

  assert(!failedReflection.success, 'Expected failed reflection to mark success false');
  assert(failedReflection.qualityScore === 0, 'Expected failed reflection quality score to be 0');
  assert(failedReflection.improvementNeeded, 'Expected failed reflection to require improvement');

  const filePath = join(process.cwd(), '.tmp-evolution-modules-test.json');
  await rm(filePath, { force: true });

  try {
    const memory = new ExperienceMemory({ filePath });
    const savedSuccess = await memory.saveExperience({
      agentName: 'research-agent',
      task: 'fetch the current ETH price',
      strategy: 'reuse_existing_tool',
      toolUsed: 'fetch_eth_price',
      resultSummary: 'Returned ETH price as 3200',
      success: true,
      qualityScore: 95,
      reflection: successfulReflection
    });

    const savedFailure = await memory.saveExperience({
      agentName: 'research-agent',
      task: 'fetch the current ETH price',
      strategy: 'reuse_existing_tool',
      toolUsed: 'fetch_eth_price',
      resultSummary: 'API timeout',
      success: false,
      qualityScore: 0,
      reflection: failedReflection
    });

    const experiences = await memory.listExperiences('research-agent');
    assert(experiences.length === 2, `Expected 2 saved experiences, got ${experiences.length}`);

    const similarExperiences = await memory.findSimilarExperiences('current ETH price', 2);
    assert(similarExperiences.length === 2, `Expected 2 similar experiences, got ${similarExperiences.length}`);

    const adapter = new StrategyAdapter();
    const generateDecision = adapter.selectStrategy({ task: 'summarize a new article' });
    assert(
      generateDecision.strategy === 'generate_new_tool',
      `Expected generate_new_tool without memory, got ${generateDecision.strategy}`
    );

    const tool = createTool();
    const reuseDecision = adapter.selectStrategy({
      task: 'fetch current ETH price',
      agentName: 'research-agent',
      availableTools: [tool],
      similarExperiences: [savedSuccess]
    });

    assert(
      reuseDecision.strategy === 'reuse_existing_tool',
      `Expected reuse_existing_tool, got ${reuseDecision.strategy}`
    );
    assert(reuseDecision.selectedToolName === tool.name, 'Expected reuse decision to select matching tool');

    const improveDecision = adapter.selectStrategy({
      task: 'fetch current ETH price',
      agentName: 'research-agent',
      availableTools: [tool],
      similarExperiences: [savedFailure]
    });

    assert(
      improveDecision.strategy === 'improve_existing_tool',
      `Expected improve_existing_tool, got ${improveDecision.strategy}`
    );
    assert(improveDecision.selectedToolId === tool.id, 'Expected improve decision to select failed tool');

    const improver = new ToolImprover();
    assert(improver instanceof ToolImprover, 'Expected ToolImprover to instantiate safely');

    printSummary({ savedSuccess, savedFailure, similarExperiences, generateDecision, reuseDecision, improveDecision });
  } finally {
    await rm(filePath, { force: true });
  }
}

function printSummary(summary: {
  savedSuccess: ExperienceRecord;
  savedFailure: ExperienceRecord;
  similarExperiences: ExperienceRecord[];
  generateDecision: ReturnType<StrategyAdapter['selectStrategy']>;
  reuseDecision: ReturnType<StrategyAdapter['selectStrategy']>;
  improveDecision: ReturnType<StrategyAdapter['selectStrategy']>;
}): void {
  console.log('Evolution modules test passed.');
  console.log(JSON.stringify({
    savedExperienceIds: [summary.savedSuccess.id, summary.savedFailure.id],
    similarExperienceCount: summary.similarExperiences.length,
    strategies: [
      summary.generateDecision.strategy,
      summary.reuseDecision.strategy,
      summary.improveDecision.strategy
    ]
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
