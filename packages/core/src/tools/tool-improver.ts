import type { ReflectionResult } from '../reflection/reflection-engine.js';
import type { Tool } from '../storage/tool-registry.js';

export interface OriginalToolForImprovement {
  id?: string;
  name: string;
  description?: string;
  code: string;
  version?: string;
}

export interface ToolImproverInput {
  originalTool: OriginalToolForImprovement;
  task: string;
  failureReason?: string;
  reflection?: ReflectionResult;
}

export interface ImprovedToolCandidate {
  name: string;
  description: string;
  code: string;
  version: string;
  previousVersionId?: string;
  improvementReason: string;
  createdAt: number;
}

export interface ToolImproverOptions {
  generator?: ToolGeneratorLike;
}

interface ToolGeneratorLike {
  generateTool(taskDescription: string): Promise<Tool>;
}

export class ToolImprover {
  private readonly generator?: ToolGeneratorLike;

  constructor(options: ToolImproverOptions = {}) {
    this.generator = options.generator;
  }

  async improveTool(input: ToolImproverInput): Promise<ImprovedToolCandidate> {
    if (!this.generator) {
      throw new Error('ToolImprover requires a configured ToolGenerator before it can improve tools');
    }

    const improvementReason = this.createImprovementReason(input);
    const generatedTool = await this.generator.generateTool(this.createImprovementPrompt(input, improvementReason));

    return {
      name: generatedTool.name || input.originalTool.name,
      description: generatedTool.description || input.originalTool.description || `Improved version of ${input.originalTool.name}`,
      code: generatedTool.code,
      version: this.nextVersion(input.originalTool.version),
      previousVersionId: input.originalTool.id,
      improvementReason,
      createdAt: Date.now()
    };
  }

  private createImprovementPrompt(input: ToolImproverInput, improvementReason: string): string {
    return [
      'Improve the existing JavaScript tool for the task below.',
      'Return one corrected self-contained async function named execute inside the standard tool JSON schema.',
      '',
      `Task: ${input.task}`,
      `Original tool name: ${input.originalTool.name}`,
      `Original description: ${input.originalTool.description ?? 'No description provided.'}`,
      `Original version: ${input.originalTool.version ?? '0.0.0'}`,
      `Improvement reason: ${improvementReason}`,
      '',
      'Original code:',
      input.originalTool.code
    ].join('\n');
  }

  private createImprovementReason(input: ToolImproverInput): string {
    if (input.failureReason?.trim()) {
      return input.failureReason.trim();
    }

    if (input.reflection && input.reflection.whatFailed !== 'No failure detected.') {
      return input.reflection.whatFailed;
    }

    if (input.reflection?.improvementNeeded) {
      return input.reflection.memoryNote;
    }

    return 'Improve the existing tool for better task reliability.';
  }

  private nextVersion(version?: string): string {
    if (!version) {
      return '1.0.1';
    }

    const parts = version.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part) || part < 0)) {
      return `${version}.1`;
    }

    const [major, minor, patch] = parts as [number, number, number];
    return `${major}.${minor}.${patch + 1}`;
  }
}
