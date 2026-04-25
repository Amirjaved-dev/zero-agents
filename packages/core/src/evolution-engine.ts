import { ToolGenerator } from './generation/tool-generator.js';
import { ToolEvaluator, type EvalResult } from './sandbox/tool-evaluator.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';

const MAX_GENERATION_ATTEMPTS = 3;

export class EvolutionEngine {
  constructor(
    private readonly generator = new ToolGenerator(),
    private readonly sandbox = new ToolSandbox(),
    private readonly evaluator = new ToolEvaluator(sandbox),
    private readonly registry = new ToolRegistry()
  ) {}

  async generateTool(taskDescription: string, sampleParams: object = {}): Promise<Tool> {
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const prompt = this.createGenerationPrompt(taskDescription, feedback);
      const tool = await this.generator.generateTool(prompt);
      const sandboxResult = await this.sandbox.run(tool.code, sampleParams);

      if (!sandboxResult.success) {
        feedback = `Sandbox failed before evaluation: ${sandboxResult.error ?? 'Unknown error'}`;
        continue;
      }

      const evalResult = await this.evaluator.evaluate(tool);
      tool.successRate = evalResult.score;

      if (evalResult.passed) {
        await this.registry.saveTool(tool);
        return tool;
      }

      feedback = this.createRetryFeedback(evalResult);
    }

    throw new Error(`Tool generation failed after ${MAX_GENERATION_ATTEMPTS} attempts. Last feedback: ${feedback ?? 'none'}`);
  }

  private createGenerationPrompt(taskDescription: string, feedback?: string): string {
    if (!feedback) {
      return taskDescription;
    }

    return `${taskDescription}\n\nPrevious generated tool failed. Fix these issues in the next version:\n${feedback}`;
  }

  private createRetryFeedback(evalResult: EvalResult): string {
    return `Evaluation score ${evalResult.score}. ${evalResult.feedback}`;
  }
}
