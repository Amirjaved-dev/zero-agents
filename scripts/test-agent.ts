import { existsSync, readFileSync } from 'node:fs';
import { SelfEvolvingAgent } from '../packages/core/dist/index.js';

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

  const zeroGPrivateKey = process.env.ZERO_G_PRIVATE_KEY;

  if (!zeroGPrivateKey) {
    console.log('Skipping agent integration test: ZERO_G_PRIVATE_KEY environment variable not set.');
    console.log('Set ZERO_G_PRIVATE_KEY to run the live two-task cached reuse test.');
    return;
  }

  const agent = new SelfEvolvingAgent({
    name: 'research-agent.eth',
    ensName: 'research-agent.eth',
    description: 'Research agent that evolves tools on demand.',
    capabilities: ['tool-generation', 'price-research'],
    zeroGPrivateKey,
    openAiKey: process.env.OPENAI_API_KEY
  });

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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
