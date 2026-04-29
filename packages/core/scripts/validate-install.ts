import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolRegistry, ToolSandbox, type Tool } from '../dist/index.js';

async function validateSandbox(): Promise<void> {
  const sandbox = new ToolSandbox({ allowUnsafeNodeVmFallback: true });
  const result = await sandbox.run(
    `async function execute(params) {
      return { sum: params.a + params.b };
    }`,
    { a: 2, b: 3 }
  );

  if (!result.success) {
    throw new Error(`Sandbox validation failed: ${result.error ?? 'unknown error'}`);
  }

  if (!isRecord(result.output) || result.output.sum !== 5) {
    throw new Error(`Sandbox returned unexpected output: ${JSON.stringify(result.output)}`);
  }
}

async function validateLocalRegistry(tempDir: string): Promise<void> {
  const registry = new ToolRegistry({
    storageMode: 'local',
    indexPointerPath: join(tempDir, 'index.json'),
    localStorePath: join(tempDir, 'tools.json')
  });

  const tool: Tool = {
    id: 'validate-add',
    name: 'add_numbers',
    description: 'Adds two numbers and returns their sum.',
    code: `async function execute(params) {
      return { sum: params.a + params.b };
    }`,
    schema: {
      input: { a: 'number', b: 'number' },
      output: { sum: 'number' }
    },
    tags: ['math', 'addition'],
    successRate: 1,
    usageCount: 0,
    createdAt: Date.now()
  };

  const rootHash = await registry.saveTool(tool);
  if (!rootHash.startsWith('local-')) {
    throw new Error(`Expected local root hash, got ${rootHash}`);
  }

  const loaded = await registry.getTool(rootHash);
  if (loaded.name !== tool.name) {
    throw new Error(`Loaded wrong tool: ${loaded.name}`);
  }

  const matches = await registry.searchTools('add two numbers');
  if (matches[0]?.name !== tool.name) {
    throw new Error('Local registry search did not return the saved tool');
  }
}

async function main(): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), 'zero-agent-validate-'));

  try {
    await validateSandbox();
    await validateLocalRegistry(tempDir);
    console.log('ZeroAgent zero-wallet validation passed.');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
