import type { ExperienceRecord } from '../memory/experience-memory.js';
import type { Tool } from '../storage/tool-registry.js';

export type StrategyName =
  | 'reuse_existing_tool'
  | 'generate_new_tool'
  | 'improve_existing_tool'
  | 'ask_another_agent'
  | 'reject_task';

export interface StrategyAdapterInput {
  task: string;
  agentName?: string;
  availableTools?: Tool[];
  similarExperiences?: ExperienceRecord[];
}

export interface StrategyDecision {
  strategy: StrategyName;
  confidence: number;
  reason: string;
  selectedToolName?: string;
  selectedToolId?: string;
}

export class StrategyAdapter {
  selectStrategy(input: StrategyAdapterInput): StrategyDecision {
    const task = input.task.trim();
    const availableTools = input.availableTools ?? [];
    const similarExperiences = this.filterExperiencesByAgent(input.similarExperiences ?? [], input.agentName);
    const bestTool = this.findBestTool(task, availableTools);
    const highQualitySuccess = this.findHighQualitySuccess(similarExperiences);

    if (highQualitySuccess?.toolUsed) {
      const matchingTool = this.findToolByName(availableTools, highQualitySuccess.toolUsed);
      return {
        strategy: 'reuse_existing_tool',
        confidence: matchingTool ? 0.9 : 0.75,
        reason: `A similar high-quality experience succeeded with tool "${highQualitySuccess.toolUsed}".`,
        selectedToolName: matchingTool?.name ?? highQualitySuccess.toolUsed,
        selectedToolId: matchingTool?.id
      };
    }

    if (bestTool) {
      const failedSameTool = similarExperiences.find(
        (experience) => !experience.success && experience.toolUsed === bestTool.name
      );

      if (failedSameTool) {
        return {
          strategy: 'improve_existing_tool',
          confidence: 0.8,
          reason: `A similar experience failed with existing tool "${bestTool.name}".`,
          selectedToolName: bestTool.name,
          selectedToolId: bestTool.id
        };
      }

      return {
        strategy: 'reuse_existing_tool',
        confidence: 0.7,
        reason: `Existing tool "${bestTool.name}" appears relevant to the task.`,
        selectedToolName: bestTool.name,
        selectedToolId: bestTool.id
      };
    }

    if (highQualitySuccess) {
      return {
        strategy: 'generate_new_tool',
        confidence: 0.65,
        reason: 'A similar task succeeded before, but no reusable tool was recorded.'
      };
    }

    return {
      strategy: 'generate_new_tool',
      confidence: 0.6,
      reason: 'No useful tools or high-quality experiences were available.'
    };
  }

  private filterExperiencesByAgent(experiences: ExperienceRecord[], agentName?: string): ExperienceRecord[] {
    if (!agentName) {
      return experiences;
    }

    return experiences.filter((experience) => experience.agentName === agentName);
  }

  private findHighQualitySuccess(experiences: ExperienceRecord[]): ExperienceRecord | undefined {
    return experiences
      .filter((experience) => experience.success && experience.qualityScore >= 80)
      .sort((a, b) => b.qualityScore - a.qualityScore || b.createdAt - a.createdAt)[0];
  }

  private findBestTool(task: string, tools: Tool[]): Tool | undefined {
    const normalizedTask = task.toLowerCase();
    if (!normalizedTask || tools.length === 0) {
      return undefined;
    }

    return tools
      .map((tool) => ({ tool, score: this.scoreToolMatch(normalizedTask, tool) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.tool.successRate - a.tool.successRate)[0]?.tool;
  }

  private findToolByName(tools: Tool[], toolName: string): Tool | undefined {
    return tools.find((tool) => tool.name === toolName);
  }

  private scoreToolMatch(normalizedTask: string, tool: Tool): number {
    const searchableText = [tool.name, tool.description, ...tool.tags].join(' ').toLowerCase();

    if (searchableText.includes(normalizedTask)) {
      return 1;
    }

    const queryTerms = new Set(normalizedTask.match(/[a-z0-9]+/g) ?? []);
    if (queryTerms.size === 0) {
      return 0;
    }

    let matchedTerms = 0;
    for (const term of queryTerms) {
      if (searchableText.includes(term)) {
        matchedTerms += 1;
      }
    }

    return matchedTerms / queryTerms.size;
  }
}
