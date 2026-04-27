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

export class ReflectionEngine {
  reflect(input: ReflectionInput): ReflectionResult {
    const success = input.error === undefined && input.result !== undefined;
    const qualityScore = this.getQualityScore(input, success);
    const recommendedStrategy = this.getRecommendedStrategy(input, success);
    const agentPrefix = input.agentName ? `${input.agentName} ` : '';
    const taskSummary = input.task.trim() || 'unspecified task';

    return {
      success,
      qualityScore,
      whatWorked: success
        ? `${agentPrefix}completed the task using ${input.toolUsed ?? 'the selected strategy'}.`
        : 'No successful result was produced.',
      whatFailed: success
        ? 'No failure detected.'
        : this.describeError(input.error),
      improvementNeeded: !success || qualityScore < 70,
      memoryNote: success
        ? `For task "${taskSummary}", strategy "${input.strategy}" produced a usable result${input.toolUsed ? ` with tool "${input.toolUsed}"` : ''}.`
        : `For task "${taskSummary}", strategy "${input.strategy}" failed: ${this.describeError(input.error)}`,
      recommendedStrategy,
    };
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
