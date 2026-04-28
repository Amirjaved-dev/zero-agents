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
  type StrategyDecision,
  type StrategyName,
  type TaskRequest,
  type TaskResult,
  type Tool
} from '@zero-agents/core';

export const RESEARCH_AGENT_CAPABILITIES = ['web-research', 'data-extraction', 'summarization'] as const;
const DEMO_TOOL_TIMEOUT_MS = 10_000;

export interface ResearchAgentOptions {
  name?: string;
  description?: string;
  zeroGPrivateKey?: string;
  openAiKey?: string;
  identity?: AgentIdentityProvider;
  axlPort?: number;
  registryPath?: string;
  experienceMemoryPath?: string;
  axlEnabled?: boolean;
  allowOfflineStorage?: boolean;
}

export interface ToolSaveRecord {
  toolName: string;
  rootHash: string;
  storage: '0g' | 'offline-demo';
}

export class ResearchAgent extends SelfEvolvingAgent {
  private readonly demoRegistry: ToolRegistry;
  private readonly demoSandbox = new ToolSandbox({ allowUnsafeNodeVmFallback: true });
  private readonly evaluator = new ToolEvaluator(this.demoSandbox);
  private readonly memoryTools = new Map<string, Tool>();
  private readonly allowOfflineStorage: boolean;
  private readonly saveRecords: ToolSaveRecord[] = [];
  private readonly axlMessages: AgentMessage[] = [];
  private lastAXLTransportWasSimulated = false;

  constructor(options: ResearchAgentOptions = {}) {
    const config: SelfEvolvingAgentConfig = {
      name: options.name ?? 'research-agent.eth',
      description: options.description ?? 'Research agent that discovers, extracts, and summarizes web information.',
      capabilities: [...RESEARCH_AGENT_CAPABILITIES],
      identity: options.identity,
      zeroGPrivateKey: options.zeroGPrivateKey ?? process.env.ZERO_G_PRIVATE_KEY ?? '',
      openAiKey: options.openAiKey ?? process.env.OPENAI_API_KEY,
      axlPort: options.axlPort,
      axlEnabled: options.axlEnabled ?? true,
      experienceMemoryPath: options.experienceMemoryPath
    };

    super(config);

    this.demoRegistry = new ToolRegistry(options.registryPath);
    this.allowOfflineStorage = options.allowOfflineStorage ?? true;
  }

  override async handleTask(task: TaskRequest): Promise<TaskResult> {
    const startedAt = Date.now();
    let selectedToolName: string | undefined;
    let strategy: StrategyName = 'reuse_existing_tool';
    let strategyDecision: StrategyDecision | undefined;

    try {
      this.emitDemoStep('search', 'Searching registry for a matching research tool...', { task });
      const availableTools = await this.findAvailableTools(task.description);
      this.emitDemoStep('strategy', 'Checking past experience...', { task });
      const similarExperiences = await this.getExperienceMemory().findSimilarExperiences(task.description);
      strategyDecision = this.getStrategyAdapter().selectStrategy({
        task: task.description,
        agentName: this.name,
        availableTools,
        similarExperiences
      });
      strategy = strategyDecision.strategy;
      let resultStrategyDecision = strategyDecision;
      this.emitDemoStep('strategy', `Strategy selected: ${strategyDecision.strategy}`, strategyDecision);
      this.emitDemoStep('strategy', `Reason: ${strategyDecision.reason}`, strategyDecision);

      if (strategyDecision.strategy === 'reject_task') {
        const result = this.createRejectionResult(strategyDecision, startedAt);
        await this.reflectAndSaveExperience(task, result, strategyDecision.strategy);
        this.emitDemoStep('done', 'Task complete.', result);
        return result;
      }

      let tool = strategyDecision.strategy === 'reuse_existing_tool'
        ? this.findSelectedTool(availableTools, strategyDecision) ?? this.findBestDemoTool(availableTools)
        : null;
      let wasGenerated = false;

      if (!tool || tool.successRate <= 0.5 || strategyDecision.strategy !== 'reuse_existing_tool') {
        strategy = 'generate_new_tool';
        resultStrategyDecision = this.createActualStrategyDecision(
          strategyDecision,
          'generate_new_tool',
          !tool
            ? 'No reusable demo tool was available, so a new tool was generated.'
            : `Selected strategy "${strategyDecision.strategy}" required a fresh generated tool before execution.`
        );
        this.emitDemoStep('miss', 'MISS: no reusable tool found in the registry.', { task });

        const hasLLMKey = !!(process.env.OPENAI_API_KEY ?? process.env.ZERO_G_PRIVATE_KEY);

        if (hasLLMKey) {
          this.emitDemoStep('generating', 'Generating tool via LLM (real evolution engine)...', { toolName: 'web_search_and_summarize' });
          tool = await this.getEvolutionEngine().evolve(task.description, { query: task.description });
        } else {
          this.emitDemoStep('generating', '[OFFLINE] No LLM key — using built-in fallback tool...', { toolName: 'web_search_and_summarize' });
          tool = this.createWebSearchAndSummarizeTool();

          this.emitDemoStep('sandboxing', `Sandbox testing generated tool ${tool.name}...`, { toolName: tool.name });
          const sandboxResult = await this.demoSandbox.run(tool.code, { query: task.description }, DEMO_TOOL_TIMEOUT_MS);
          if (!sandboxResult.success) {
            throw new Error(sandboxResult.error ?? 'Fallback tool sandbox failed');
          }

          this.emitDemoStep('evaluating', `Evaluating generated tool ${tool.name}...`, { toolName: tool.name });
          const evalResult = await this.evaluator.evaluate(tool, [
            { input: { query: task.description }, description: 'Smoke test' }
          ]);
          tool.successRate = evalResult.score;

          if (!evalResult.passed) {
            throw new Error(`Fallback tool failed evaluation: ${evalResult.feedback}`);
          }
        }

        wasGenerated = true;
        this.emitDemoStep('saving', `Saving generated tool ${tool.name} to 0G storage...`, { toolName: tool.name });
        await this.saveGeneratedTool(tool);
      }

      selectedToolName = tool.name;
      this.emitDemoStep('executing', `Executing tool ${tool.name} for the task...`, { toolName: tool.name });
      const execution = await this.demoSandbox.run(tool.code, { query: task.description }, DEMO_TOOL_TIMEOUT_MS);
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

      this.applyStrategyMetadata(result, resultStrategyDecision);
      await this.reflectAndSaveExperience(task, result, strategy);
      this.emitDemoStep('done', 'Task complete.', result);
      return result;
    } catch (error) {
      await this.reflectAndSaveFailure(task, error, strategy, Date.now() - startedAt, selectedToolName);
      this.emitDemoStep('error', error instanceof Error ? error.message : String(error), { error });
      throw error;
    }
  }

  async importToolsFrom(agent: ResearchAgent): Promise<number> {
    const tools = agent.exportTools();

    for (const tool of tools) {
      this.memoryTools.set(tool.name, structuredClone(tool));
    }

    return tools.length;
  }

  async sendTaskOverAXL(toAgent: ResearchAgent, task: TaskRequest): Promise<TaskResult> {
    // Try real AXL via parent's collaborateWith() (requires AXL node running + peer ID in identity)
    try {
      this.emitDemoStep('executing', `[AXL] Sending task to ${toAgent.name} over real AXL P2P...`, {});
      const result = await this.collaborateWith(toAgent.name, task);
      this.lastAXLTransportWasSimulated = false;
      this.emitDemoStep('done', `[AXL] Task result received from ${toAgent.name} over real AXL.`, result);
      return result;
    } catch (axlError) {
      const reason = axlError instanceof Error ? axlError.message : String(axlError);
      this.lastAXLTransportWasSimulated = true;
      this.emitDemoStep('executing', `[AXL SIMULATION] AXL unavailable (${reason}). Using direct call.`, {});
    }

    // Record simulated AXL message traffic for the demo summary
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

  /** Returns true if the last sendTaskOverAXL() call fell back to a direct in-process call. */
  wasLastAXLSimulated(): boolean {
    return this.lastAXLTransportWasSimulated;
  }

  private async findAvailableTools(taskDescription: string): Promise<Tool[]> {
    const queryTerms = new Set(taskDescription.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const toolsByName = new Map<string, Tool>();

    for (const tool of this.memoryTools.values()) {
      toolsByName.set(tool.name, tool);
    }

    try {
      const registryMatches = await this.demoRegistry.searchTools(taskDescription);
      for (const tool of registryMatches) {
        toolsByName.set(tool.name, tool);
        this.memoryTools.set(tool.name, tool);
      }
    } catch {
      // Demo mode can run without persistent 0G-backed registry access.
    }

    return Array.from(toolsByName.values())
      .map((tool) => ({ tool, score: this.scoreTool(tool, queryTerms) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || b.tool.successRate - a.tool.successRate)
      .map((match) => match.tool);
  }

  private findBestDemoTool(tools: Tool[]): Tool | null {
    return tools.find((tool) => tool.successRate > 0.5) ?? null;
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

  return {
    query,
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
    summary: items.length > 0
      ? items.map((item) => item.rank + '. ' + item.title).join(' | ')
      : 'No results returned by the search API for this query.'
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
