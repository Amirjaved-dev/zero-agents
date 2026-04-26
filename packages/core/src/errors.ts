/**
 * ZeroAgent custom error hierarchy.
 *
 * All errors thrown by the framework extend `ZeroAgentError` so callers can
 * distinguish framework errors from generic JavaScript errors with a single
 * `instanceof` check:
 *
 * ```ts
 * try {
 *   await agent.handleTask(task);
 * } catch (error) {
 *   if (error instanceof ZeroAgentError) {
 *     console.error(`[${error.code}] ${error.message}`);
 *   }
 * }
 * ```
 */

/** Base class for all errors thrown by the ZeroAgent framework. */
export class ZeroAgentError extends Error {
  constructor(
    message: string,
    /** A machine-readable error code (e.g. `'TOOL_GENERATION_ERROR'`). */
    public readonly code: string
  ) {
    super(message);
    this.name = 'ZeroAgentError';
    // Maintains proper prototype chain in environments that transpile classes.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when tool generation fails after all retry attempts.
 * `attempts` carries the number of generation attempts that were made.
 */
export class ToolGenerationError extends ZeroAgentError {
  constructor(
    message: string,
    /** Number of generation attempts that were made before giving up. */
    public readonly attempts: number
  ) {
    super(message, 'TOOL_GENERATION_ERROR');
    this.name = 'ToolGenerationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a tool fails to execute inside the sandbox.
 * Check `message` for the underlying execution error.
 */
export class SandboxError extends ZeroAgentError {
  constructor(message: string) {
    super(message, 'SANDBOX_ERROR');
    this.name = 'SandboxError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when tool evaluation (LLM test-case generation or scoring) fails.
 */
export class EvaluationError extends ZeroAgentError {
  constructor(message: string) {
    super(message, 'EVALUATION_ERROR');
    this.name = 'EvaluationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a 0G Storage upload or download fails.
 */
export class StorageError extends ZeroAgentError {
  constructor(message: string) {
    super(message, 'STORAGE_ERROR');
    this.name = 'StorageError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an AXL (Gensyn P2P) operation fails.
 */
export class AXLError extends ZeroAgentError {
  constructor(message: string) {
    super(message, 'AXL_ERROR');
    this.name = 'AXLError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
