import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type Tool } from '../storage/tool-registry.js';

function makeTool(): Tool {
  return {
    id: 'tool-1',
    name: 'eth_price_fetcher',
    description: 'Fetches the current ETH price',
    code: 'async function execute(params) { return { price: 3200 }; }',
    schema: { input: {}, output: { price: 'number' } },
    tags: ['eth', 'price'],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now()
  };
}

test('ToolRegistry saves and loads tools in local storage mode without 0G credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zero-agent-registry-test-'));
  const registry = new ToolRegistry({
    storageMode: 'local',
    indexPointerPath: join(dir, 'index.json'),
    localStorePath: join(dir, 'tools.json')
  });

  const tool = makeTool();
  const rootHash = await registry.saveTool(tool);

  assert.match(rootHash, /^local-/);

  const loaded = await registry.getTool(rootHash);
  assert.equal(loaded.name, tool.name);

  const matches = await registry.searchTools('current eth price');
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.name, tool.name);
});
