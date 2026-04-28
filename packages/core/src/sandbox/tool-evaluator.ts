import OpenAI from 'openai';
import type { Tool } from '../storage/tool-registry.js';
import { ToolSandbox, type SandboxResult } from './tool-sandbox.js';
import { EvaluationError } from '../errors.js';

const TEST_CASE_MODEL = 'gpt-4o-mini';
const DEFAULT_TEST_CASE_TIMEOUT_MS = 30_000;

export interface TestCase {
  input: object;
  expectedOutput?: unknown;
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
        const passed = result.success && this.outputMatches(result.output, testCase.expectedOutput, tool.schema.output);

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
          input: this.createSmokeInput(tool.schema.input),
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
              'Generate exactly two basic test cases for a JavaScript tool. Return only JSON: {"testCases":[{"input":{},"expectedOutput":{},"description":"..."}]}. Include expectedOutput whenever the result is deterministic. For dynamic network/API tools, expectedOutput may be omitted, but the tool output schema must be specific enough to verify the shape.'
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

  private outputMatches(output: unknown, expectedOutput: unknown, outputSchema: object): boolean {
    if (expectedOutput === undefined || expectedOutput === null) {
      return this.outputMatchesSchema(output, outputSchema);
    }

    return JSON.stringify(output) === JSON.stringify(expectedOutput);
  }

  private createSmokeInput(inputSchema: object): object {
    if (!this.isRecord(inputSchema)) {
      return {};
    }

    const input: Record<string, unknown> = {};
    for (const [key, expected] of Object.entries(inputSchema)) {
      input[key] = this.createSampleValue(expected);
    }
    return input;
  }

  private createSampleValue(expected: unknown): unknown {
    if (typeof expected === 'string') {
      switch (expected.toLowerCase()) {
        case 'string':
          return 'sample';
        case 'number':
          return 1;
        case 'boolean':
          return true;
        case 'array':
          return [];
        case 'object':
          return {};
        default:
          return null;
      }
    }

    if (typeof expected === 'number') return 1;
    if (typeof expected === 'boolean') return true;
    if (Array.isArray(expected)) return [];
    if (this.isRecord(expected)) return {};

    return null;
  }

  private outputMatchesSchema(output: unknown, outputSchema: object): boolean {
    const scalarType = this.getScalarSchemaType(outputSchema);
    if (scalarType) {
      return this.valueMatchesTypeName(output, scalarType);
    }

    const entries = Object.entries(outputSchema);
    if (entries.length === 0) {
      // Without expected output or a declared schema, "successful execution" is
      // too weak to approve generated code for permanent reuse.
      return false;
    }

    if (!this.isRecord(output)) {
      return false;
    }

    return entries.every(([key, expected]) => {
      if (!(key in output)) return false;

      const actual = output[key];
      if (typeof expected === 'string') {
        return this.valueMatchesTypeName(actual, expected);
      }

      if (typeof expected === 'number') return typeof actual === 'number';
      if (typeof expected === 'boolean') return typeof actual === 'boolean';
      if (Array.isArray(expected)) return Array.isArray(actual);
      if (this.isRecord(expected)) return this.isRecord(actual);

      return actual !== undefined;
    });
  }

  private valueMatchesTypeName(value: unknown, typeName: string): boolean {
    switch (typeName.toLowerCase()) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return this.isRecord(value);
      default:
        return value !== undefined;
    }
  }

  private getScalarSchemaType(outputSchema: object): string | null {
    if (!this.isRecord(outputSchema)) {
      return null;
    }

    const type = outputSchema.type;
    if (typeof type !== 'string') {
      return null;
    }

    const keys = Object.keys(outputSchema);
    return keys.length === 1 ? type : null;
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
