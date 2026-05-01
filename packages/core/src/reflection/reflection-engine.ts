export type RecommendedStrategy =
  | 'reuse_existing_tool'
  | 'generate_new_tool'
  | 'improve_existing_tool'
  | 'ask_another_agent'
  | 'reject_task';

export interface ReflectionInput {
  agentName?: string;
  task: string;
  strategy: string;
  toolUsed?: string;
  result?: unknown;
  error?: unknown;
  executionTimeMs?: number;
}

export interface ReflectionResult {
  success: boolean;
  qualityScore: number;
  whatWorked: string;
  whatFailed: string;
  improvementNeeded: boolean;
  memoryNote: string;
  recommendedStrategy: RecommendedStrategy;
}

export interface ReflectionEngineOptions {
  /** Object keys that make a result count as failure. Default: ['error']. Empty disables this check. */
  errorOutputKeys?: string[];
  beforeReflection?: (input: ReflectionInput) => void;
  afterReflection?: (result: ReflectionResult, input: ReflectionInput) => void;
}

export class ReflectionEngine {
  private readonly errorOutputKeys: string[];
  private readonly beforeReflection?: (input: ReflectionInput) => void;
  private readonly afterReflection?: (result: ReflectionResult, input: ReflectionInput) => void;

  constructor(options: ReflectionEngineOptions = {}) {
    this.errorOutputKeys = options.errorOutputKeys ?? ['error'];
    this.beforeReflection = options.beforeReflection;
    this.afterReflection = options.afterReflection;
  }

  reflect(input: ReflectionInput): ReflectionResult {
    this.beforeReflection?.(input);
    const structuredError = this.getStructuredOutputError(input.result);
    const error = input.error ?? structuredError;
    const success = error === undefined && input.result !== undefined;
    const inputForScoring = error === undefined ? input : { ...input, error };
    const qualityScore = this.getQualityScore(inputForScoring, success);
    const recommendedStrategy = this.getRecommendedStrategy(inputForScoring, success);
    const agentPrefix = input.agentName ? `${input.agentName} ` : '';
    const taskSummary = input.task.trim() || 'unspecified task';

    const result = {
      success,
      qualityScore,
      whatWorked: success
        ? `${agentPrefix}completed the task using ${input.toolUsed ?? 'the selected strategy'}.`
        : 'No successful result was produced.',
      whatFailed: success
        ? 'No failure detected.'
        : this.describeError(error),
      improvementNeeded: !success || qualityScore < 70,
      memoryNote: success
        ? `For task "${taskSummary}", strategy "${input.strategy}" produced a usable result${input.toolUsed ? ` with tool "${input.toolUsed}"` : ''}.`
        : `For task "${taskSummary}", strategy "${input.strategy}" failed: ${this.describeError(error)}`,
      recommendedStrategy,
    };
    this.afterReflection?.(result, inputForScoring);
    return result;
  }

  private getStructuredOutputError(output: unknown): unknown | undefined {
    if (this.errorOutputKeys.length === 0 || output === null || typeof output !== 'object' || Array.isArray(output)) {
      return undefined;
    }

    const record = output as Record<string, unknown>;
    const key = this.errorOutputKeys.find((candidate) => record[candidate] !== undefined && record[candidate] !== null);
    return key ? record[key] : undefined;
  }

  private getQualityScore(input: ReflectionInput, success: boolean): number {
    if (!success) {
      return 0;
    }

    let score = 80;

    if (input.toolUsed) {
      score += 10;
    }

    if (input.executionTimeMs !== undefined && input.executionTimeMs <= 5_000) {
      score += 5;
    }

    return Math.min(score, 100);
  }

  private getRecommendedStrategy(input: ReflectionInput, success: boolean): RecommendedStrategy {
    if (success) {
      return input.toolUsed ? 'reuse_existing_tool' : 'generate_new_tool';
    }

    return input.toolUsed ? 'improve_existing_tool' : 'generate_new_tool';
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    return 'Unknown error.';
  }
}
