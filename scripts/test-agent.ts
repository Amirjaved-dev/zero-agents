import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENSIdentityManager, SelfEvolvingAgent, type Tool } from '../packages/core/dist/index.js';

const TASK_DESCRIPTION = 'fetch the current price of ETH from CoinGecko API and return it as a number';

function loadEnvFile(filePath = '.env'): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
}

async function main(): Promise<void> {
  loadEnvFile();

  if (process.env.ZERO_AGENT_LIVE_TEST !== '1') {
    await runOfflineAgentTest();
    return;
  }

  const zeroGPrivateKey = process.env.ZERO_G_PRIVATE_KEY;
  const ensPrivateKey = process.env.ENS_PRIVATE_KEY ?? zeroGPrivateKey;
  const ensName = process.env.ENS_NAME;

  if (!zeroGPrivateKey) {
    console.log('Skipping agent integration test: ZERO_G_PRIVATE_KEY environment variable not set.');
    console.log('Set ZERO_G_PRIVATE_KEY to run the live two-task cached reuse test.');
    return;
  }

  const identity = ensName
    ? new ENSIdentityManager({
        ensName,
        privateKey: ensPrivateKey
      })
    : undefined;

  const agent = new SelfEvolvingAgent({
    name: ensName ?? 'research-agent',
    description: 'Research agent that evolves tools on demand.',
    capabilities: ['tool-generation', 'price-research'],
    identity,
    zeroGPrivateKey,
    openAiKey: process.env.OPENAI_API_KEY
  });

  await agent.publishProfile();

  agent.on('step', (event) => {
    const data = event.data ? ` ${JSON.stringify(event.data)}` : '';
    console.log(`[${event.type}] ${event.message}${data}`);
  });

  console.log('Run 1: should generate and save a tool');
  const firstResult = await agent.handleTask({ description: TASK_DESCRIPTION });
  console.log('Run 1 result:', firstResult);

  console.log('\nRun 2: should reuse cached tool');
  const secondResult = await agent.handleTask({ description: TASK_DESCRIPTION });
  console.log('Run 2 result:', secondResult);

  if (secondResult.wasGenerated) {
    throw new Error('Expected second run to reuse cached tool, but it generated a new one');
  }

  if (firstResult.toolUsed !== secondResult.toolUsed) {
    throw new Error(`Expected second run to use ${firstResult.toolUsed}, got ${secondResult.toolUsed}`);
  }

  console.log('\nConfirmed: second run reused cached tool.');
}

async function runOfflineAgentTest(): Promise<void> {
  const previousZeroGPrivateKey = process.env.ZERO_G_PRIVATE_KEY;
  delete process.env.ZERO_G_PRIVATE_KEY;

  const tempDir = await mkdtemp(join(tmpdir(), 'zero-agent-test-'));
  const agent = new SelfEvolvingAgent({
    name: 'offline-test-agent',
    registryPath: join(tempDir, 'index.json'),
    experienceMemoryPath: join(tempDir, 'experiences.json'),
    allowUnsafeNodeVmFallback: true
  });

  const tool: Tool = {
    id: randomUUID(),
    name: 'fetch_eth_price',
    description: 'Fetches the current price of ETH from CoinGecko API and returns it as a number.',
    code: 'async function execute(params) { return 3200; }',
    schema: { input: {}, output: { type: 'number' } },
    tags: ['crypto', 'price', 'eth', 'coingecko'],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now()
  };

  const originalToolRootHash = await agent.getRegistry().saveTool(tool);

  const firstResult = await agent.handleTask({ description: TASK_DESCRIPTION });
  const secondResult = await agent.handleTask({ description: TASK_DESCRIPTION });
  const reusedTool = await agent.getRegistry().getToolByName(tool.name);

  if (firstResult.wasGenerated || secondResult.wasGenerated) {
    throw new Error('Expected offline agent test to reuse the seeded tool without generation');
  }

  if (firstResult.output !== 3200 || secondResult.output !== 3200) {
    throw new Error('Expected seeded ETH price tool to return 3200 on both runs');
  }

  if (reusedTool?.rootHash !== originalToolRootHash) {
    throw new Error('Expected tool root hash to remain stable after usage stats changed');
  }

  console.log('Offline agent integration test passed.');
  console.log('Set ZERO_AGENT_LIVE_TEST=1 with live credentials to run the 0G/ENS path.');

  if (previousZeroGPrivateKey) {
    process.env.ZERO_G_PRIVATE_KEY = previousZeroGPrivateKey;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
