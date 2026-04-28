# @zero-agents/core

ENS-native self-evolving agent framework with persistent 0G tool memory.

ZeroAgent lets developers build TypeScript agents that generate tools on demand, test them in a sandbox, store approved tools on 0G Storage, publish identity and capabilities through ENS, and coordinate with other agents over Gensyn AXL.

## Install

```bash
npm install @zero-agents/core
```

Node.js 20+ is required by the package `engines` field. `isolated-vm` is a native dependency, so your environment needs a supported Node runtime and build tooling if a prebuilt binary is unavailable.

## Quickstart

### Zero-wallet smoke test

```ts
import { ToolSandbox } from '@zero-agents/core';

const sandbox = new ToolSandbox();
const result = await sandbox.run(
  `async function execute(params) {
    return { sum: params.a + params.b };
  }`,
  { a: 2, b: 3 }
);

console.log(result.output);
```

### Agent with 0G/ENS

```ts
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'my-agent.eth',
  privateKey: process.env.ENS_PRIVATE_KEY!,
});

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A research agent',
  capabilities: ['web-search', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,
  identity,
  axlEnabled: false,
});

agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

const result = await agent.handleTask({
  description: 'Find the current ETH price and return it as a number',
});

console.log(result.output);
agent.dispose();
```

## Environment

```env
ZERO_G_PRIVATE_KEY=your_0g_testnet_private_key
OPENAI_API_KEY=optional_openai_fallback_key
ENS_PRIVATE_KEY=optional_ens_owner_private_key
ENS_NAME=my-agent.eth
SEPOLIA_RPC_URL=https://sepolia.drpc.org
```

## Main Exports

- `SelfEvolvingAgent`
- `EvolutionEngine`
- `ToolGenerator`
- `ToolRegistry`
- `ToolSandbox`
- `ToolEvaluator`
- `ENSIdentityManager`
- `AXLClient`
- `AgentCoordinator`

## Local Storage Mode

`ToolRegistry` uses 0G Storage when `ZERO_G_PRIVATE_KEY` or `zeroGPrivateKey` is configured. Without a key, it automatically falls back to local JSON-backed storage in `.zero-agent-tools.json`, so framework users can build and test agents before funding a wallet.

## Sandbox Note

Generated tools use `isolated-vm` by default. A restricted Node `vm` fallback exists only when explicitly enabled with `new ToolSandbox({ allowUnsafeNodeVmFallback: true })`. Node `vm` is not a hard security boundary for hostile code; run untrusted generated tools inside a locked-down worker/container for production deployments.

## Repository

Full documentation and demo workspace: https://github.com/Amirjaved-dev/zero-agents
