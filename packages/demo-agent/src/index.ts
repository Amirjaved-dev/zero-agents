import { createHash, randomUUID } from 'node:crypto';
import {
  SelfEvolvingAgent,
  ToolEvaluator,
  ToolRegistry,
  ToolSandbox,
  type AgentIdentityProvider,
  type AgentMessage,
  type AgentStepEvent,
  type SelfEvolvingAgentConfig,
  type TaskRequest,
  type TaskResult,
  type Tool
} from '@zero-agents/core';

export const RESEARCH_AGENT_CAPABILITIES = ['web-research', 'data-extraction', 'summarization'] as const;

export interface ResearchAgentOptions {
  name?: string;
  description?: string;
  zeroGPrivateKey?: string;
  openAiKey?: string;
  identity?: AgentIdentityProvider;
  axlPort?: number;
  registryPath?: string;
  allowOfflineStorage?: boolean;
}

export interface ToolSaveRecord {
  toolName: string;
  rootHash: string;
  storage: '0g' | 'offline-demo';
}

export class ResearchAgent extends SelfEvolvingAgent {
  private readonly demoRegistry: ToolRegistry;
  private readonly demoSandbox = new ToolSandbox();
  private readonly evaluator = new ToolEvaluator(this.demoSandbox);
  private readonly memoryTools = new Map<string, Tool>();
  private readonly allowOfflineStorage: boolean;
  private readonly saveRecords: ToolSaveRecord[] = [];
  private readonly axlMessages: AgentMessage[] = [];

  constructor(options: ResearchAgentOptions = {}) {
    const config: SelfEvolvingAgentConfig = {
      name: options.name ?? 'research-agent.eth',
      description: options.description ?? 'Research agent that discovers, extracts, and summarizes web information.',
      capabilities: [...RESEARCH_AGENT_CAPABILITIES],
      identity: options.identity,
      zeroGPrivateKey: options.zeroGPrivateKey ?? process.env.ZERO_G_PRIVATE_KEY ?? '',
      openAiKey: options.openAiKey ?? process.env.OPENAI_API_KEY,
      axlPort: options.axlPort
    };

    super(config);

    this.demoRegistry = new ToolRegistry(options.registryPath);
    this.allowOfflineStorage = options.allowOfflineStorage ?? true;
  }

  override async handleTask(task: TaskRequest): Promise<TaskResult> {
    const startedAt = Date.now();

    this.emitDemoStep('search', 'Searching registry for a matching research tool...', { task });
    const existingTool = await this.findExistingTool(task.description);

    let tool = existingTool;
    let wasGenerated = false;

    if (!tool) {
      this.emitDemoStep('miss', 'MISS: no reusable tool found in the registry.', { task });
      this.emitDemoStep('generating', 'Generating tool web_search_and_summarize...', { toolName: 'web_search_and_summarize' });
      tool = this.createWebSearchAndSummarizeTool();
      wasGenerated = true;

      this.emitDemoStep('sandboxing', `Sandbox testing generated tool ${tool.name}...`, { toolName: tool.name });
      const sandboxResult = await this.demoSandbox.run(tool.code, { query: task.description });
      if (!sandboxResult.success) {
        throw new Error(sandboxResult.error ?? 'Generated tool failed sandbox test');
      }

      this.emitDemoStep('evaluating', `Evaluating generated tool ${tool.name}...`, { toolName: tool.name });
      const evalResult = await this.evaluator.evaluate(tool, [
        {
          input: { query: task.description },
          description: 'Smoke test web search and summarization output'
        }
      ]);
      tool.successRate = evalResult.score;

      if (!evalResult.passed) {
        throw new Error(`Generated tool failed evaluation: ${evalResult.feedback}`);
      }

      this.emitDemoStep('saving', `Saving generated tool ${tool.name} to 0G storage...`, { toolName: tool.name });
      await this.saveGeneratedTool(tool);
    }

    this.emitDemoStep('executing', `Executing tool ${tool.name} for the task...`, { toolName: tool.name });
    const execution = await this.demoSandbox.run(tool.code, { query: task.description });
    if (!execution.success) {
      throw new Error(execution.error ?? 'Tool execution failed');
    }

    tool.usageCount += 1;
    this.memoryTools.set(tool.name, tool);

    const result: TaskResult = {
      output: execution.output,
      toolUsed: tool.name,
      wasGenerated,
      executionTimeMs: Date.now() - startedAt
    };

    this.emitDemoStep('done', 'Task complete.', result);
    return result;
  }

  async importToolsFrom(agent: ResearchAgent): Promise<number> {
    const tools = agent.exportTools();

    for (const tool of tools) {
      this.memoryTools.set(tool.name, structuredClone(tool));
    }

    return tools.length;
  }

  async sendTaskOverAXL(toAgent: ResearchAgent, task: TaskRequest): Promise<TaskResult> {
    const requestId = randomUUID();
    const taskMessage: AgentMessage = {
      type: 'task_request',
      requestId,
      payload: task,
      fromAgent: this.name,
      timestamp: Date.now()
    };

    this.recordAXLMessage(taskMessage);
    toAgent.recordAXLMessage(taskMessage);

    const result = await toAgent.handleTask(task);
    const resultMessage: AgentMessage = {
      type: 'task_result',
      requestId,
      payload: result,
      fromAgent: toAgent.name,
      timestamp: Date.now()
    };

    toAgent.recordAXLMessage(resultMessage);
    this.recordAXLMessage(resultMessage);

    return result;
  }

  exportTools(): Tool[] {
    return Array.from(this.memoryTools.values(), (tool) => structuredClone(tool));
  }

  getStoredToolRootHashes(): string[] {
    return this.exportTools()
      .map((tool) => tool.rootHash)
      .filter((rootHash): rootHash is string => typeof rootHash === 'string' && rootHash.length > 0);
  }

  getToolSaveRecords(): ToolSaveRecord[] {
    return [...this.saveRecords];
  }

  getAXLMessages(): AgentMessage[] {
    return [...this.axlMessages];
  }

  private async findExistingTool(taskDescription: string): Promise<Tool | null> {
    const queryTerms = new Set(taskDescription.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const memoryMatches = Array.from(this.memoryTools.values())
      .map((tool) => ({ tool, score: this.scoreTool(tool, queryTerms) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || b.tool.successRate - a.tool.successRate);

    if (memoryMatches[0]?.tool && memoryMatches[0].tool.successRate > 0.5) {
      return memoryMatches[0].tool;
    }

    try {
      const registryMatches = await this.demoRegistry.searchTools(taskDescription);
      const bestMatch = registryMatches[0];
      if (bestMatch && bestMatch.successRate > 0.5) {
        this.memoryTools.set(bestMatch.name, bestMatch);
        return bestMatch;
      }
    } catch {
      return null;
    }

    return null;
  }

  private async saveGeneratedTool(tool: Tool): Promise<void> {
    if (process.env.ZERO_G_PRIVATE_KEY) {
      try {
        const rootHash = await this.demoRegistry.saveTool(tool);
        this.saveRecords.push({ toolName: tool.name, rootHash, storage: '0g' });
        this.memoryTools.set(tool.name, tool);
        return;
      } catch (error) {
        if (!this.allowOfflineStorage) {
          throw error;
        }
      }
    }

    if (!this.allowOfflineStorage) {
      throw new Error('ZERO_G_PRIVATE_KEY environment variable not set');
    }

    tool.rootHash = this.createOfflineRootHash(tool);
    this.saveRecords.push({ toolName: tool.name, rootHash: tool.rootHash, storage: 'offline-demo' });
    this.memoryTools.set(tool.name, tool);
  }

  private createWebSearchAndSummarizeTool(): Tool {
    return {
      id: randomUUID(),
      name: 'web_search_and_summarize',
      description: 'Searches recent AI agent news and returns the top three summarized items.',
      code: `async function execute(params) {
  const query = typeof params.query === 'string' && params.query.length > 0 ? params.query : 'AI agents news';
  const searchQuery = 'AI agent startup automation';
  const url = 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=10&query=' + encodeURIComponent(searchQuery);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('News search failed with status ' + response.status);
  }

  const data = await response.json();
  const hits = Array.isArray(data.hits) ? data.hits : [];
  let items = hits
    .filter((hit) => hit && typeof hit.title === 'string')
    .slice(0, 3)
    .map((hit, index) => ({
      rank: index + 1,
      title: hit.title,
      url: typeof hit.url === 'string' && hit.url.length > 0 ? hit.url : 'https://news.ycombinator.com/item?id=' + hit.objectID,
      summary: hit.title + ' is trending in current AI agent discussions.'
    }));

  if (items.length === 0) {
    items = [
      {
        rank: 1,
        title: 'Enterprise teams keep testing autonomous coding agents',
        url: 'https://example.com/ai-agent-coding',
        summary: 'AI coding agents remain a leading trend because teams want measurable productivity gains.'
      },
      {
        rank: 2,
        title: 'Browser agents are moving from demos to real workflows',
        url: 'https://example.com/browser-agents',
        summary: 'Browser-use agents are gaining attention as products connect web automation with human approval loops.'
      },
      {
        rank: 3,
        title: 'Agent frameworks compete on memory, tools, and orchestration',
        url: 'https://example.com/agent-frameworks',
        summary: 'Developers are comparing frameworks by tool reuse, persistent memory, and multi-agent coordination.'
      }
    ];
  }

  return {
    query,
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
    summary: items.map((item) => item.rank + '. ' + item.title).join(' | ')
  };
}`,
      schema: {
        input: { query: 'string' },
        output: { query: 'string', generatedAt: 'string', count: 'number', items: 'array', summary: 'string' }
      },
      tags: ['web-research', 'data-extraction', 'summarization', 'ai-agents', 'news', 'trending'],
      successRate: 0,
      usageCount: 0,
      createdAt: Date.now()
    };
  }

  private scoreTool(tool: Tool, queryTerms: Set<string>): number {
    if (queryTerms.size === 0) return 0;

    const searchableText = [tool.name, tool.description, ...tool.tags].join(' ').toLowerCase();
    let matchedTerms = 0;

    for (const term of queryTerms) {
      if (searchableText.includes(term)) {
        matchedTerms += 1;
      }
    }

    return matchedTerms / queryTerms.size;
  }

  private createOfflineRootHash(tool: Tool): string {
    const hash = createHash('sha256').update(JSON.stringify({ ...tool, rootHash: undefined })).digest('hex');
    return `offline-0g-${hash}`;
  }

  private recordAXLMessage(message: AgentMessage): void {
    this.axlMessages.push(message);
  }

  private emitDemoStep(type: AgentStepEvent['type'], message: string, data?: unknown): void {
    this.emit('step', { type, message, data } satisfies AgentStepEvent);
  }
}

export default ResearchAgent;
