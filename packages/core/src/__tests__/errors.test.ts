/**
 * Unit tests for ZeroAgent custom error classes — no external credentials needed.
 *
 * Usage:
 *   tsx packages/core/src/__tests__/errors.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZeroAgentError,
  ToolGenerationError,
  SandboxError,
  EvaluationError,
  StorageError,
  AXLError,
} from '../errors.js';

test('ZeroAgentError has correct name, code, and message', () => {
  const err = new ZeroAgentError('something went wrong', 'MY_CODE');
  assert.equal(err.name, 'ZeroAgentError');
  assert.equal(err.code, 'MY_CODE');
  assert.equal(err.message, 'something went wrong');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ZeroAgentError);
});

test('ZeroAgentError has a stack trace', () => {
  const err = new ZeroAgentError('with stack', 'X');
  assert.ok(typeof err.stack === 'string' && err.stack.length > 0);
});

test('ToolGenerationError carries attempts count and correct code', () => {
  const err = new ToolGenerationError('gen failed after 3 attempts', 3);
  assert.equal(err.name, 'ToolGenerationError');
  assert.equal(err.code, 'TOOL_GENERATION_ERROR');
  assert.equal(err.attempts, 3);
  assert.ok(err instanceof ZeroAgentError);
  assert.ok(err instanceof Error);
});

test('SandboxError has correct name and code', () => {
  const err = new SandboxError('sandbox blew up');
  assert.equal(err.name, 'SandboxError');
  assert.equal(err.code, 'SANDBOX_ERROR');
  assert.ok(err instanceof ZeroAgentError);
  assert.ok(err instanceof Error);
});

test('EvaluationError has correct name and code', () => {
  const err = new EvaluationError('eval timed out');
  assert.equal(err.name, 'EvaluationError');
  assert.equal(err.code, 'EVALUATION_ERROR');
  assert.ok(err instanceof ZeroAgentError);
  assert.ok(err instanceof Error);
});

test('StorageError has correct name and code', () => {
  const err = new StorageError('0G upload failed');
  assert.equal(err.name, 'StorageError');
  assert.equal(err.code, 'STORAGE_ERROR');
  assert.ok(err instanceof ZeroAgentError);
  assert.ok(err instanceof Error);
});

test('AXLError has correct name and code', () => {
  const err = new AXLError('/send returned 500');
  assert.equal(err.name, 'AXLError');
  assert.equal(err.code, 'AXL_ERROR');
  assert.ok(err instanceof ZeroAgentError);
  assert.ok(err instanceof Error);
});

test('all specific errors can be caught as ZeroAgentError', () => {
  const errors: ZeroAgentError[] = [
    new ToolGenerationError('x', 1),
    new SandboxError('x'),
    new EvaluationError('x'),
    new StorageError('x'),
    new AXLError('x'),
  ];

  for (const err of errors) {
    assert.ok(err instanceof ZeroAgentError, `${err.name} should extend ZeroAgentError`);
    assert.ok(err instanceof Error, `${err.name} should extend Error`);
    assert.ok(typeof err.code === 'string' && err.code.length > 0, `${err.name} should have a non-empty code`);
  }
});

test('instanceof works correctly across re-throws', () => {
  function throwStorage() {
    throw new StorageError('upload failed');
  }

  try {
    throwStorage();
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof StorageError);
    assert.ok(error instanceof ZeroAgentError);
    assert.ok(error instanceof Error);
    assert.equal((error as StorageError).code, 'STORAGE_ERROR');
  }
});
