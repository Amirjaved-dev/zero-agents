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
5. Do not return empty schemas unless the tool truly takes or returns no structured data
6. No markdown, no backticks, pure JSON only`;

interface GeneratedToolPayload {
  name: string;
  description: string;
  code: string;
  schema: {
    input: object;
    output: object;
  };
  tags: string[];
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
}

export class ToolGenerator {
  readonly fallbackToOpenAI: boolean;
  private readonly zeroGPrivateKey?: string;
  private readonly openAiKey?: string;
  private readonly zeroGBlockchainRpc: string;

  constructor(options: ToolGeneratorOptions | boolean = {}) {
    if (typeof options === 'boolean') {
      this.fallbackToOpenAI = options;
      this.zeroGBlockchainRpc = ZERO_G_RPC_URL;
      return;
    }

    this.fallbackToOpenAI = options.fallbackToOpenAI ?? true;
    this.zeroGPrivateKey = options.zeroGPrivateKey;
    this.openAiKey = options.openAiKey;
    this.zeroGBlockchainRpc = options.zeroGBlockchainRpc ?? ZERO_G_RPC_URL;
  }

  async generateTool(taskDescription: string): Promise<Tool> {
    const responseText = await this.generateToolJson(taskDescription);
    const generatedTool = this.parseGeneratedTool(responseText);

    return {
      ...generatedTool,
      id: randomUUID(),
      successRate: 0,
      usageCount: 0,
      createdAt: Date.now()
    };
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

  private createMessages(taskDescription: string): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content: TOOL_GENERATION_SYSTEM_PROMPT
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

  private parseGeneratedTool(responseText: string): GeneratedToolPayload {
    let parsed: unknown;

    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Tool generation response was not valid JSON: ${this.getErrorMessage(error)}`);
    }

    if (!this.isGeneratedToolPayload(parsed)) {
      throw new Error('Tool generation response does not match the expected tool schema');
    }

    return parsed;
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

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
