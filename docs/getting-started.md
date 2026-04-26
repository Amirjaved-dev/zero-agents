# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 8+
- A funded Ethereum wallet (Sepolia testnet) for 0G Storage uploads

---

## Installation

```bash
git clone <repo>
cd zero-agents
pnpm install
pnpm build
```

---

## Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

```env
# Required: Ethereum private key (no 0x prefix) with Sepolia testnet ETH
ZERO_G_PRIVATE_KEY=your_private_key_here

# Optional: Fallback LLM when 0G Compute is unavailable
OPENAI_API_KEY=sk-...
```

**Getting Sepolia ETH for 0G:**
- Bridge ETH to Sepolia via any Sepolia faucet.
- The 0G RPC is `https://evmrpc-testnet.0g.ai`.

---

## Quickstart

```typescript
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A research assistant',
  capabilities: ['web-search', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,   // optional fallback
});

// Listen to progress events
agent.on('step', (event) => {
  console.log(`[${event.type}] ${event.message}`);
});

// Run a task
const result = await agent.handleTask({
  description: 'Fetch and summarize top Hacker News stories',
});

console.log(result.output);
console.log(`Tool used: ${result.toolUsed}`);
console.log(`Was generated this run: ${result.wasGenerated}`);
console.log(`Took ${result.executionTimeMs}ms`);
```

Expected console output (first run — tool does not exist yet):

```
[search] Searching for existing tool...
[miss] No tool found. Generating new tool...
[generating] Generating tool attempt 1...
[sandboxing] Sandboxing generated tool fetch_hn_stories...
[evaluating] Evaluating generated tool fetch_hn_stories...
[saving] Saving generated tool fetch_hn_stories...
[executing] Executing tool fetch_hn_stories...
[done] Task complete.
```

Second run for the same task:

```
[search] Searching for existing tool...
[executing] Executing tool fetch_hn_stories...
[done] Task complete.
```

---

## Run the Demo Agent

The demo agent (`packages/demo-agent/`) ships with a pre-built `web_search_and_summarize` tool and runs a 12-step demonstration of tool generation, reuse, and cross-agent sharing.

```bash
cd packages/demo-agent
pnpm demo
```

---

## Integration Tests

Each test targets a single integration. Run them to verify your environment before building.

```bash
# Test 0G Storage upload/download
pnpm test:storage

# Test full agent evolution loop
pnpm test:agent

# Test ENS identity read/write (requires ENS name ownership)
tsx scripts/test-ens-identity.ts

# Test AXL P2P (requires local AXL node running)
powershell -ExecutionPolicy Bypass -File scripts/test-axl-local.ps1
```

---

## Monorepo Scripts (root)

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm dev` | Dev mode for all packages |
| `pnpm test:storage` | Integration test for 0G Storage |
| `pnpm test:agent` | Integration test for full agent loop |

---

## Next Steps

- Read [Core Concepts](./core-concepts.md) to understand how tools and the evolution loop work.
- Read [API Reference](./api-reference.md) for the full method signatures.
- Read [Integrations](./integrations.md) to configure 0G Compute, ENS, and AXL.
