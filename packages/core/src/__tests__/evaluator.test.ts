/**
 * Unit tests for ToolEvaluator schema-aware scoring.
 *
 * Usage:
 *   tsx packages/core/src/__tests__/evaluator.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolEvaluator } from '../sandbox/tool-evaluator.js';
import { ToolSandbox } from '../sandbox/tool-sandbox.js';
import type { Tool } from '../storage/tool-registry.js';

function createTool(code: string, outputSchema: object): Tool {
  return {
    id: 'tool-1',
    name: 'schema_test_tool',
    description: 'schema test tool',
    code,
    schema: {
      input: {},
      output: outputSchema
    },
    tags: [],
    successRate: 0,
    usageCount: 0,
    createdAt: Date.now()
  };
}

test('fails successful execution when output does not match declared schema', async () => {
  const evaluator = new ToolEvaluator(new ToolSandbox({ allowUnsafeNodeVmFallback: true }));
  const tool = createTool(
    'async function execute(params) { return { price: "3200" }; }',
    { price: 'number' }
  );

  const result = await evaluator.evaluate(tool, [{ input: {}, description: 'schema smoke test' }]);

  assert.equal(result.passed, false);
  assert.equal(result.score, 0);
});

test('passes successful execution when output matches declared schema', async () => {
  const evaluator = new ToolEvaluator(new ToolSandbox({ allowUnsafeNodeVmFallback: true }));
  const tool = createTool(
    'async function execute(params) { return { price: 3200 }; }',
    { price: 'number' }
  );

  const result = await evaluator.evaluate(tool, [{ input: {}, description: 'schema smoke test' }]);

  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
});
