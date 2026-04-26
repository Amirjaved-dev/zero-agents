import OpenAI from 'openai';
import type { Tool } from '../storage/tool-registry.js';
import { ToolSandbox, type SandboxResult } from './tool-sandbox.js';
import { EvaluationError } from '../errors.js';

const TEST_CASE_MODEL = 'gpt-4o-mini';
const DEFAULT_TEST_CASE_TIMEOUT_MS = 30_000;

export interface TestCase {
  input: object;
  expectedOutput?: any;
  description: string;
}

export interface TestCaseResult {
  testCase: TestCase;
  passed: boolean;
  result: SandboxResult;
}

export interface EvalResult {
  score: number;
  passed: boolean;
  testResults: TestCaseResult[];
  feedback: string;
}

interface TestCasePayload {
  testCases: TestCase[];
}

export class ToolEvaluator {
  private readonly testCaseTimeoutMs: number;

  constructor(
    private readonly sandbox = new ToolSandbox(),
    private readonly openAiKey?: string,
    testCaseTimeoutMs = DEFAULT_TEST_CASE_TIMEOUT_MS
  ) {
    this.testCaseTimeoutMs = testCaseTimeoutMs;
  }

  async evaluate(tool: Tool, testCases?: TestCase[]): Promise<EvalResult> {
    const cases = testCases ?? (await this.generateTestCases(tool));
    const testResults = await Promise.all(
      cases.map(async (testCase) => {
        const result = await this.sandbox.run(tool.code, testCase.input);
        const passed = result.success && this.outputMatches(result.output, testCase.expectedOutput);

        return { testCase, passed, result };
      })
    );

    const passedCount = testResults.filter((result) => result.passed).length;
    const score = cases.length === 0 ? 0 : passedCount / cases.length;

    return {
      score,
      passed: score >= 0.7,
      testResults,
      feedback: this.createFeedback(testResults, score)
    };
  }

  private async generateTestCases(tool: Tool): Promise<TestCase[]> {
    const apiKey = this.openAiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return [
        {
          input: {},
          description: `Smoke test for ${tool.name}`
        }
      ];
    }

    const client = new OpenAI({ apiKey });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new EvaluationError(`Test case generation timed out after ${this.testCaseTimeoutMs}ms`)),
        this.testCaseTimeoutMs
      )
    );

    const completion = await Promise.race([
      client.chat.completions.create({
        model: TEST_CASE_MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'Generate exactly two basic test cases for a JavaScript tool. Return only JSON: {"testCases":[{"input":{},"description":"..."}]}. Omit "expectedOutput" unless you know the exact value — omitting it means any successful execution passes.'
          },
          {
            role: 'user',
            content: `Tool name: ${tool.name}\nDescription: ${tool.description}\nInput schema: ${JSON.stringify(tool.schema.input)}\nOutput schema: ${JSON.stringify(tool.schema.output)}`
          }
        ]
      }),
      timeoutPromise
    ]);

    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new EvaluationError('LLM returned an empty test case response');
    }

    return this.parseTestCases(content);
  }

  private parseTestCases(responseText: string): TestCase[] {
    let parsed: unknown;

    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new EvaluationError(`Test case response was not valid JSON: ${this.getErrorMessage(error)}`);
    }

    if (!this.isTestCasePayload(parsed)) {
      throw new EvaluationError('Test case response does not match the expected schema');
    }

    return parsed.testCases;
  }

  private outputMatches(output: unknown, expectedOutput: unknown): boolean {
    if (expectedOutput === undefined || expectedOutput === null) {
      return true;
    }

    return JSON.stringify(output) === JSON.stringify(expectedOutput);
  }

  private createFeedback(testResults: TestCaseResult[], score: number): string {
    const failedResults = testResults.filter((result) => !result.passed);

    if (failedResults.length === 0) {
      return `All test cases passed with score ${score}.`;
    }

    return failedResults
      .map((result) => {
        const expected = JSON.stringify(result.testCase.expectedOutput);
        const actual = JSON.stringify(result.result.output);
        const error = result.result.error ? ` Error: ${result.result.error}.` : '';

        return `${result.testCase.description} failed.${error} Expected ${expected}, got ${actual}.`;
      })
      .join(' ');
  }

  private isTestCasePayload(value: unknown): value is TestCasePayload {
    return (
      this.isRecord(value) &&
      Array.isArray(value.testCases) &&
      value.testCases.length >= 1 &&
      value.testCases.every((testCase) => this.isTestCase(testCase))
    );
  }

  private isTestCase(value: unknown): value is TestCase {
    return (
      this.isRecord(value) &&
      this.isRecord(value.input) &&
      typeof value.description === 'string'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
