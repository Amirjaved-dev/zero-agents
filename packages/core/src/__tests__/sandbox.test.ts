/**
 * Unit tests for ToolSandbox — run without any external credentials.
 *
 * Usage:
 *   tsx packages/core/src/__tests__/sandbox.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolSandbox } from '../sandbox/tool-sandbox.js';

test('executes simple arithmetic', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run('async function execute(params) { return 40 + 2; }', {});
  assert.equal(result.success, true);
  assert.equal(result.output, 42);
});

test('passes params to the function', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run('async function execute(params) { return params.x * 2; }', { x: 21 });
  assert.equal(result.success, true);
  assert.equal(result.output, 42);
});

test('returns failure result when code throws', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run('async function execute(params) { throw new Error("boom"); }', {});
  assert.equal(result.success, false);
  assert.ok(result.error?.includes('boom'), `Expected error to include "boom", got: ${result.error}`);
});

test('returns object output correctly', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run(
    'async function execute(params) { return { name: params.name, doubled: params.n * 2 }; }',
    { name: 'agent', n: 5 }
  );
  assert.equal(result.success, true);
  // Normalise via JSON round-trip: objects from VM contexts may have a
  // different Object.prototype, which makes deepStrictEqual fail even when
  // the values are identical.
  const normalised = JSON.parse(JSON.stringify(result.output));
  assert.equal(normalised.name, 'agent');
  assert.equal(normalised.doubled, 10);
});

test('returns array output correctly', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run(
    'async function execute(params) { return [1, 2, 3].map(n => n + params.offset); }',
    { offset: 10 }
  );
  assert.equal(result.success, true);
  // Same JSON-normalisation to avoid cross-VM-context comparison issues.
  assert.equal(JSON.stringify(result.output), JSON.stringify([11, 12, 13]));
});

test('executionTimeMs is a positive number', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run('async function execute(params) { return true; }', {});
  assert.ok(typeof result.executionTimeMs === 'number' && result.executionTimeMs >= 0);
});

test('$0 string literal in tool code does not corrupt execution', async () => {
  const sandbox = new ToolSandbox();
  // Before the fix, this would produce "params!" instead of "$0!" because
  // the Node vm path did a raw string replacement of "$0" → "params".
  const result = await sandbox.run(
    'async function execute(params) { const s = "$0"; return s + params.suffix; }',
    { suffix: '!' }
  );
  assert.equal(result.success, true);
  assert.equal(result.output, '$0!');
});

test('does not expose require to tool code', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run(
    'async function execute(params) { return typeof require === "undefined" ? "safe" : "unsafe"; }',
    {}
  );
  // isolated-vm path: require is not available → 'safe'
  // node vm path: require is blocked by shadowing → 'safe'
  if (result.success) {
    assert.equal(result.output, 'safe');
  }
  // If it throws (also acceptable — isolated-vm may throw on undefined require access)
});

test('does not expose process to tool code', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run(
    'async function execute(params) { return typeof process === "undefined" ? "safe" : "unsafe"; }',
    {}
  );
  if (result.success) {
    assert.equal(result.output, 'safe');
  }
});

test('times out for long-running code', async () => {
  const sandbox = new ToolSandbox();
  const result = await sandbox.run(
    // Busy loop — should be killed by timeout
    `async function execute(params) {
      const end = Date.now() + 60_000;
      while (Date.now() < end) { /* spin */ }
      return "should not reach here";
    }`,
    {},
    150   // 150 ms timeout
  );
  assert.equal(result.success, false);
  // Either a Timeout error or a Script execution timed out error
  const errLower = (result.error ?? '').toLowerCase();
  assert.ok(
    errLower.includes('timeout') || errLower.includes('timed out'),
    `Expected timeout error, got: "${result.error}"`
  );
});
