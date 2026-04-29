# Examples

Examples that use 0G, ENS, or AXL require the matching environment variables. The first example is deterministic and runs without a wallet or network access. See [Getting Started](./getting-started.md).

---

## 1. Zero-wallet Sandbox Smoke Test

```typescript
import { ToolSandbox } from '@zero-agents/core';

const sandbox = new ToolSandbox();
const result = await sandbox.run(
  `async function execute(params) {
    return { greeting: 'hello ' + params.name };
  }`,
  { name: 'ZeroAgent' }
);

console.log(result.output);
// { greeting: 'hello ZeroAgent' }
```

---

## 2. Basic Agent - Run a Task

```typescript
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'demo-agent.eth',
  description: 'A general-purpose research agent',
  capabilities: ['web-search', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,
  axlEnabled: false,
});

agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

const result = await agent.handleTask({
  description: 'Fetch top 5 Hacker News stories and return their titles',
  params: { limit: 5 },
});

console.log(result.output);
// { stories: [...], summary: 'Top 5: ...' }

console.log(`wasGenerated: ${result.wasGenerated}`);
// wasGenerated: true  (first run)
// wasGenerated: false (subsequent runs — tool was cached in registry)
```

---

## 3. Agent with ENS Identity

Publishes the agent profile to ENS text records so other agents can discover it.

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'my-agent.eth',
  privateKey: process.env.ZERO_G_PRIVATE_KEY!,
});

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A web research agent',
  capabilities: ['web-search', 'data-extraction'],
  identity,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: false,
});

// Run a task — after completion, toolRegistryHash auto-syncs to ENS
const result = await agent.handleTask({
  description: 'Summarize the latest crypto news',
});

// Manually publish the full profile (e.g. on startup)
await agent.publishProfile();

// Verify what was written
const profile = await identity.getProfile();
console.log(profile);
// {
//   description: 'A web research agent',
//   capabilities: ['web-search', 'data-extraction'],
//   toolRegistryHash: '0x...',
//   axlPeerId: '...'
// }
```

---

## 4. Cross-Agent Collaboration via AXL

Agent A delegates a task to Agent B over the Gensyn AXL network. Both agents must have AXL nodes running locally.

**Agent B (receiver) — runs on machine B:**

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'agent-b.eth',
  privateKey: process.env.ZERO_G_PRIVATE_KEY!,
});

const agentB = new SelfEvolvingAgent({
  name: 'agent-b.eth',
  description: 'Specializes in weather data',
  capabilities: ['weather'],
  identity,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlPort: 9002,
  axlEnabled: true,
});

// agentB is now listening for inbound tasks because axlEnabled is true.
await agentB.publishProfile(); // writes AXL peer ID to ENS
console.log('Agent B ready');
```

**Agent A (sender) — runs on machine A:**

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'agent-a.eth',
  privateKey: process.env.ZERO_G_PRIVATE_KEY!,
});

const agentA = new SelfEvolvingAgent({
  name: 'agent-a.eth',
  identity,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: true,
});

// Resolves agent-b.eth's AXL peer ID from ENS, then sends task over AXL
const result = await agentA.collaborateWith('agent-b.eth', {
  description: 'Get current weather for London',
  params: { city: 'London' },
});

console.log(result.output);
```

---

## 5. Direct ToolRegistry Usage

Use the registry independently of the agent — useful for inspecting, importing, or managing tools.

```typescript
import { ToolRegistry } from '@zero-agents/core';

const registry = new ToolRegistry();

// Search for tools matching a query
const tools = await registry.searchTools('fetch weather data');
for (const tool of tools) {
  console.log(`${tool.name} — successRate: ${tool.successRate}, uses: ${tool.usageCount}`);
}

// Get all tools
const allTools = await registry.exportTools();

// Import a tool from another agent (e.g. received over AXL tool_share)
const externalTool = { /* ...Tool object from another agent... */ };
await registry.importTool(externalTool);

// Retrieve a specific tool by its 0G content address
const tool = await registry.getTool('0xabc123...');
console.log(tool.code);
```

---

## 6. Direct ToolSandbox Usage

Run arbitrary tool code in isolation, outside of the agent loop.

```typescript
import { ToolSandbox } from '@zero-agents/core';

const sandbox = new ToolSandbox();

const code = `async function execute(params) {
  const response = await fetch('https://api.github.com/repos/anthropics/claude-code');
  const data = await response.json();
  return { stars: data.stargazers_count, forks: data.forks_count };
}`;

const result = await sandbox.run(code, {});

if (result.success) {
  console.log(result.output);  // { stars: 1234, forks: 56 }
  console.log(`Ran in ${result.executionTimeMs}ms`);
} else {
  console.error('Sandbox error:', result.error);
}
```

---

## 7. Manual Tool Generation + Evaluation

Step through the evolution pipeline manually.

```typescript
import { ToolGenerator, ToolSandbox, ToolEvaluator, ToolRegistry } from '@zero-agents/core';

const generator = new ToolGenerator();
const sandbox = new ToolSandbox();
const evaluator = new ToolEvaluator(sandbox);
const registry = new ToolRegistry();

// Generate
const tool = await generator.generateTool(
  'Write a function that converts a temperature from Celsius to Fahrenheit'
);
console.log('Generated:', tool.name);
console.log('Code:\n', tool.code);

// Validate in sandbox
const sandboxResult = await sandbox.run(tool.code, { celsius: 100 });
if (!sandboxResult.success) {
  console.error('Sandbox failed:', sandboxResult.error);
  process.exit(1);
}

// Evaluate with LLM-generated test cases
const evalResult = await evaluator.evaluate(tool);
console.log(`Score: ${evalResult.score}`);
console.log(`Passed: ${evalResult.passed}`);
if (!evalResult.passed) {
  console.log('Feedback:', evalResult.feedback);
}

// Save if good
if (evalResult.passed) {
  const rootHash = await registry.saveTool({ ...tool, successRate: evalResult.score });
  console.log('Saved to 0G:', rootHash);
}
```

---

## 8. Observing Agent Events

Subscribe to granular step events for dashboards, logging, or debugging.

```typescript
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'observer-demo',
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: false,
});

const log: string[] = [];

agent.on('step', (event) => {
  const entry = `${new Date().toISOString()} [${event.type}] ${event.message}`;
  log.push(entry);

  if (event.type === 'error') {
    console.error(entry, event.data);
  } else {
    console.log(entry);
  }
});

try {
  await agent.handleTask({ description: 'Get the current Bitcoin price in USD' });
} finally {
  console.log('\nFull event log:');
  log.forEach((l) => console.log(l));
}
```

---

## 9. Custom Identity Provider

Implement `AgentIdentityProvider` with a database instead of ENS.

```typescript
import type { AgentIdentityProvider, AgentProfile } from '@zero-agents/core';

class DatabaseIdentityProvider implements AgentIdentityProvider {
  private db: Map<string, AgentProfile> = new Map();

  async getProfile(): Promise<AgentProfile | null> {
    return this.db.get('profile') ?? null;
  }

  async setProfile(profile: AgentProfile): Promise<void> {
    this.db.set('profile', profile);
  }

  async getToolRegistryHash(): Promise<string | null> {
    return this.db.get('profile')?.toolRegistryHash ?? null;
  }

  async setToolRegistryHash(rootHash: string): Promise<void> {
    const profile = this.db.get('profile');
    if (profile) {
      profile.toolRegistryHash = rootHash;
      this.db.set('profile', profile);
    }
  }

  async setAXLPeerId(peerId: string): Promise<void> {
    const profile = this.db.get('profile');
    if (profile) {
      profile.axlPeerId = peerId;
    }
  }
}

// Use it
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'db-agent',
  identity: new DatabaseIdentityProvider(),
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: false,
});
```

---

## 10. Running the Demo Agent

The demo agent ships with a hardcoded `web_search_and_summarize` tool and illustrates the full lifecycle without requiring ENS ownership.

```bash
cd packages/demo-agent
pnpm demo
```

Source: `packages/demo-agent/src/index.ts`

Key demo agent features:
- Offline mode: creates a fake root hash if `ZERO_G_PRIVATE_KEY` is not set.
- `importToolsFrom(otherAgent)` — simulates cross-agent tool sharing in-process.
- `exportTools()` — returns all in-memory tools.
- `sendTaskOverAXL(toAgent, task)` — simulates AXL messaging without a real network.
