import { EventEmitter } from 'node:events';
import { ToolGenerator } from './generation/tool-generator.js';
import { ToolEvaluator, type EvalResult } from './sandbox/tool-evaluator.js';
import { ToolSandbox } from './sandbox/tool-sandbox.js';
import { ToolRegistry, type Tool } from './storage/tool-registry.js';

const MAX_GENERATION_ATTEMPTS = 3;
const DEFAULT_EVOLUTION_TIMEOUT_MS = 120_000;

export interface EvolutionEvent {
  type: 'generating' | 'sandboxing' | 'evaluating' | 'saving';
  message: string;
  data?: any;
}

export class EvolutionEngine extends EventEmitter {
  private readonly evolutionTimeoutMs: number;

  constructor(
    private readonly generator = new ToolGenerator(),
    private readonly sandbox = new ToolSandbox(),
    private readonly evaluator = new ToolEvaluator(sandbox),
    private readonly registry = new ToolRegistry(),
    evolutionTimeoutMs = DEFAULT_EVOLUTION_TIMEOUT_MS
  ) {
    super();
    this.evolutionTimeoutMs = evolutionTimeoutMs;
  }

  override on(eventName: 'step', listener: (event: EvolutionEvent) => void): this;
  override on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(eventName, listener);
  }

  async evolve(taskDescription: string, sampleParams: object = {}): Promise<Tool> {
    return this.generateTool(taskDescription, sampleParams);
  }

  async generateTool(taskDescription: string, sampleParams: object = {}): Promise<Tool> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tool generation timed out after ${this.evolutionTimeoutMs}ms`)),
        this.evolutionTimeoutMs
      )
    );
    return Promise.race([this.runGenerationLoop(taskDescription, sampleParams), timeoutPromise]);
  }

  private async runGenerationLoop(taskDescription: string, sampleParams: object): Promise<Tool> {
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const prompt = this.createGenerationPrompt(taskDescription, feedback);
      this.emitStep({ type: 'generating', message: `Generating tool attempt ${attempt}...`, data: { attempt } });
      const tool = await this.generator.generateTool(prompt);

      this.emitStep({ type: 'sandboxing', message: `Sandboxing generated tool ${tool.name}...`, data: { tool } });
      const sandboxResult = await this.sandbox.run(tool.code, sampleParams);

      if (!sandboxResult.success) {
        feedback = `Sandbox failed before evaluation: ${sandboxResult.error ?? 'Unknown error'}`;
        continue;
      }

      this.emitStep({ type: 'evaluating', message: `Evaluating generated tool ${tool.name}...`, data: { tool } });
      const evalResult = await this.evaluator.evaluate(tool);
      tool.successRate = evalResult.score;

      if (evalResult.passed) {
        this.emitStep({ type: 'saving', message: `Saving generated tool ${tool.name}...`, data: { tool } });
        await this.registry.saveTool(tool);
        return tool;
      }

      feedback = this.createRetryFeedback(evalResult);
    }

    throw new Error(`Tool generation failed after ${MAX_GENERATION_ATTEMPTS} attempts. Last feedback: ${feedback ?? 'none'}`);
  }

  private emitStep(event: EvolutionEvent): void {
    this.emit('step', event);
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
