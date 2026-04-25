/**
 * Demo Agent
 * Example implementation of a SelfEvolvingAgent
 */

import { SelfEvolvingAgent, AgentConfig } from '@zero-agents/core';

export class DemoAgent extends SelfEvolvingAgent {
  private taskCount: number = 0;

  constructor(name: string = 'DemoAgent') {
    const config: AgentConfig = {
      name,
      description: 'A simple example agent that demonstrates SelfEvolvingAgent capabilities'
    };
    super(config);
  }

  async executeTask(taskDescription: string): Promise<void> {
    console.log(`[${this.getName()}] Executing task: ${taskDescription}`);
    this.taskCount += 1;

    // Evolve the agent after task execution
    await this.evolve();
  }

  getTaskCount(): number {
    return this.taskCount;
  }
}

export default DemoAgent;
