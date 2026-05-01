import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import OpenAI from 'openai';
import type { Tool } from '../storage/tool-registry.js';

const ZERO_G_RPC_URL = 'https://evmrpc-testnet.0g.ai';
const OPENAI_FALLBACK_MODEL = 'gpt-4o-mini';

const TOOL_GENERATION_SYSTEM_PROMPT = `You generate JavaScript tools for an autonomous agent.

You must:
1. Create a self-contained async JavaScript function named 'execute'
2. The function takes a single 'params' object argument
3. Return ONLY valid JSON in this exact format:
{
  "name": "tool_name_snake_case",
  "description": "what it does",
  "code": "async function execute(params) { ... }",
  "schema": { "input": { "field": "type" }, "output": { "field": "type" } },
  "tags": []
}
4. The schemas must describe the real input/output fields using type strings like "string", "number", "boolean", "array", or "object"
5. If the tool returns a raw scalar, describe output as { "type": "number" } or the correct scalar type
6. Do not return empty schemas unless the tool truly takes or returns no structured data
7. No markdown, no backticks, pure JSON only`;

export interface GeneratedToolPayload {
  name: string;
  description: string;
  code: string;
  schema: {
    input: object;
    output: object;
  };
  tags: string[];
}

export type ToolGenerationMessage = { role: 'system' | 'user'; content: string };

export interface ToolGenerationPromptInput {
  taskDescription: string;
  baseSystemPrompt: string;
  systemPromptAppend?: string;
  runtimeHints: string[];
}

interface ZeroGChatCompletionResponse {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface ZeroGComputeBroker {
  inference: {
    listService: () => Promise<ZeroGService[]>;
    getServiceMetadata: (providerAddress: string) => Promise<{ endpoint: string; model: string }>;
    getRequestHeaders: (providerAddress: string) => Promise<Record<string, string>>;
  };
}

interface ZeroGServingBrokerModule {
  createZGComputeNetworkBroker: (wallet: ethers.Wallet) => Promise<ZeroGComputeBroker>;
}

type ZeroGService = readonly [
  providerAddress: string,
  serviceType: string,
  endpoint: string,
  inputPrice: string,
  outputPrice: string,
  updatedAt: string,
  model: string,
  verifiability: string,
  metadata: string,
  signerAddress: string,
  isAvailable: boolean
];

export interface ToolGeneratorOptions {
  fallbackToOpenAI?: boolean;
  zeroGPrivateKey?: string;
  openAiKey?: string;
  /** Override the 0G EVM RPC endpoint used by the compute broker. Defaults to the public 0G testnet. */
  zeroGBlockchainRpc?: string;
  /** Extra instructions appended to the built-in tool-generation system prompt. */
  systemPromptAppend?: string;
  /** Runtime constraints included in the generation prompt, for example "use fetch, not require". */
  runtimeHints?: string[];
  /** Full prompt override for advanced integrations. */
  createMessages?: (input: ToolGenerationPromptInput) => ToolGenerationMessage[];
  /** Override or extend LLM response normalization before validation. */
  normalizeGeneratedTool?: (raw: unknown) => GeneratedToolPayload;
  beforeToolGeneration?: (taskDescription: string) => void | Promise<void>;
  afterToolGeneration?: (tool: Tool) => void | Promise<void>;
}

export class ToolGenerator {
  readonly fallbackToOpenAI: boolean;
  private readonly zeroGPrivateKey?: string;
  private readonly openAiKey?: string;
  private readonly zeroGBlockchainRpc: string;
  private readonly systemPromptAppend?: string;
  private readonly runtimeHints: string[];
  private readonly createMessagesOverride?: (input: ToolGenerationPromptInput) => ToolGenerationMessage[];
  private readonly normalizeGeneratedToolOverride?: (raw: unknown) => GeneratedToolPayload;
  private readonly beforeToolGeneration?: (taskDescription: string) => void | Promise<void>;
  private readonly afterToolGeneration?: (tool: Tool) => void | Promise<void>;

  constructor(options: ToolGeneratorOptions | boolean = {}) {
    if (typeof options === 'boolean') {
      this.fallbackToOpenAI = options;
      this.zeroGBlockchainRpc = ZERO_G_RPC_URL;
      this.runtimeHints = [];
      return;
    }

    this.fallbackToOpenAI = options.fallbackToOpenAI ?? true;
    this.zeroGPrivateKey = options.zeroGPrivateKey;
    this.openAiKey = options.openAiKey;
    this.zeroGBlockchainRpc = options.zeroGBlockchainRpc ?? ZERO_G_RPC_URL;
    this.systemPromptAppend = options.systemPromptAppend;
    this.runtimeHints = options.runtimeHints ?? [];
    this.createMessagesOverride = options.createMessages;
    this.normalizeGeneratedToolOverride = options.normalizeGeneratedTool;
    this.beforeToolGeneration = options.beforeToolGeneration;
    this.afterToolGeneration = options.afterToolGeneration;
  }

  async generateTool(taskDescription: string): Promise<Tool> {
    await this.beforeToolGeneration?.(taskDescription);
    const responseText = await this.generateToolJson(taskDescription);
    const generatedTool = this.parseGeneratedTool(responseText);

    const tool = {
      ...generatedTool,
      id: randomUUID(),
      successRate: 0,
      usageCount: 0,
      createdAt: Date.now()
    };
    await this.afterToolGeneration?.(tool);
    return tool;
  }

  private async generateToolJson(taskDescription: string): Promise<string> {
    try {
      return await this.generateWithZeroG(taskDescription);
    } catch (error) {
      if (!this.fallbackToOpenAI || !this.getOpenAiKey()) {
        throw error;
      }

      return this.generateWithOpenAI(taskDescription);
    }
  }

  private async generateWithZeroG(taskDescription: string): Promise<string> {
    const privateKey = this.zeroGPrivateKey ?? process.env.ZERO_G_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('ZERO_G_PRIVATE_KEY environment variable not set');
    }

    const { createZGComputeNetworkBroker } = this.loadZeroGServingBroker();
    const provider = new ethers.JsonRpcProvider(this.zeroGBlockchainRpc);
    const wallet = new ethers.Wallet(privateKey, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    const providerAddress = await this.getChatbotProviderAddress(broker.inference.listService.bind(broker.inference));

    const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
    const headers = await broker.inference.getRequestHeaders(providerAddress);
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({
        model,
        messages: this.createMessages(taskDescription),
        temperature: 0.2
      })
    });

    if (!response.ok) {
      throw new Error(`0G Compute request failed with status ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!this.isZeroGChatCompletionResponse(data)) {
      throw new Error('0G Compute returned an invalid chat completion response');
    }

    const content = data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('0G Compute returned an empty tool generation response');
    }

    return content;
  }

  private loadZeroGServingBroker(): ZeroGServingBrokerModule {
    const require = createRequire(import.meta.url);
    return require('@0glabs/0g-serving-broker') as ZeroGServingBrokerModule;
  }

  private async getChatbotProviderAddress(listService: () => Promise<ZeroGService[]>): Promise<string> {
    const services = await listService();
    const chatbot = services.find((service) => service[1] === 'chatbot' && service[10]);

    if (!chatbot) {
      throw new Error('0G Compute did not return an available chatbot provider');
    }

    return chatbot[0];
  }

  private async generateWithOpenAI(taskDescription: string): Promise<string> {
    const apiKey = this.getOpenAiKey();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable not set');
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: OPENAI_FALLBACK_MODEL,
      messages: this.createMessages(taskDescription),
      response_format: { type: 'json_object' },
      temperature: 0.2
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new Error('OpenAI returned an empty tool generation response');
    }

    return content;
  }

  createMessages(taskDescription: string): ToolGenerationMessage[] {
    if (this.createMessagesOverride) {
      return this.createMessagesOverride({
        taskDescription,
        baseSystemPrompt: TOOL_GENERATION_SYSTEM_PROMPT,
        systemPromptAppend: this.systemPromptAppend,
        runtimeHints: this.runtimeHints
      });
    }

    const additions = [
      this.systemPromptAppend,
      this.runtimeHints.length > 0
        ? `Runtime hints:\n${this.runtimeHints.map((hint) => `- ${hint}`).join('\n')}`
        : undefined
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return [
      {
        role: 'system',
        content: additions.length > 0
          ? `${TOOL_GENERATION_SYSTEM_PROMPT}\n\n${additions.join('\n\n')}`
          : TOOL_GENERATION_SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: `Task description: ${taskDescription}`
      }
    ];
  }

  private getOpenAiKey(): string | undefined {
    return this.openAiKey ?? process.env.OPENAI_API_KEY;
  }

  parseGeneratedTool(responseText: string): GeneratedToolPayload {
    let parsed: unknown;

    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Tool generation response was not valid JSON: ${this.getErrorMessage(error)}`);
    }

    const normalized = this.normalizeGeneratedToolOverride
      ? this.normalizeGeneratedToolOverride(parsed)
      : this.normalizeGeneratedTool(parsed);

    if (!this.isGeneratedToolPayload(normalized)) {
      throw new Error('Tool generation response does not match the expected tool schema');
    }

    return normalized;
  }

  normalizeGeneratedTool(raw: unknown): GeneratedToolPayload {
    const candidate = this.unwrapGeneratedTool(raw);
    if (this.isGeneratedToolPayload(candidate)) {
      return candidate;
    }

    if (!this.isRecord(candidate)) {
      throw new Error('Tool generation response did not contain an object payload');
    }

    const code = this.getString(candidate.code) ?? this.getString(candidate.functionCode) ?? this.getString(candidate.execute);
    const name = this.getString(candidate.name) ?? this.getString(candidate.toolName) ?? 'generated_tool';
    const description = this.getString(candidate.description) ?? this.getString(candidate.summary) ?? 'Generated tool';
    const schema = this.isRecord(candidate.schema) ? candidate.schema : {};
    const input = this.isRecord(schema.input) ? schema.input : {};
    const output = this.isRecord(schema.output) ? schema.output : {};
    const tags = Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : [];

    if (!code) {
      throw new Error('Tool generation response did not include executable code');
    }

    return { name, description, code, schema: { input, output }, tags };
  }

  private unwrapGeneratedTool(raw: unknown): unknown {
    if (Array.isArray(raw)) {
      return raw[0];
    }

    if (!this.isRecord(raw)) {
      return raw;
    }

    return raw.tool ?? raw.generatedTool ?? raw.result ?? raw.data ?? raw;
  }

  private isGeneratedToolPayload(value: unknown): value is GeneratedToolPayload {
    return (
      this.isRecord(value) &&
      typeof value.name === 'string' &&
      typeof value.description === 'string' &&
      typeof value.code === 'string' &&
      this.isRecord(value.schema) &&
      this.isRecord(value.schema.input) &&
      this.isRecord(value.schema.output) &&
      Array.isArray(value.tags) &&
      value.tags.every((tag) => typeof tag === 'string')
    );
  }

  private isZeroGChatCompletionResponse(value: unknown): value is ZeroGChatCompletionResponse {
    return (
      this.isRecord(value) &&
      Array.isArray(value.choices) &&
      value.choices.every(
        (choice) =>
          this.isRecord(choice) &&
          (choice.message === undefined ||
            (this.isRecord(choice.message) &&
              (choice.message.content === undefined ||
                typeof choice.message.content === 'string' ||
                choice.message.content === null)))
      )
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
