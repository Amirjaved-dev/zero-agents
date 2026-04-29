# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 8+
- A funded Ethereum wallet only when using 0G Storage, 0G Compute, or ENS writes

---

## Installation

For app developers using the framework:

```bash
npm install @zero-agents/core
```

For contributors working in this repository:

```bash
git clone <repo>
cd zero-agents
pnpm install
pnpm build
```

---

## Environment Variables

Skip this section for the zero-wallet smoke test. Copy `.env.example` only when you are ready to use 0G Storage, ENS, or LLM-backed tool generation:

```bash
cp .env.example .env
```

```env
# Required for 0G Storage and 0G Compute: Ethereum private key with testnet funds
ZERO_G_PRIVATE_KEY=your_private_key_here

# Optional fallback LLM for tool generation and evaluator test cases
OPENAI_API_KEY=sk-...

# Optional ENS identity publishing on Sepolia
ENS_PRIVATE_KEY=your_ens_owner_private_key_here
ENS_NAME=my-agent.eth
SEPOLIA_RPC_URL=https://sepolia.drpc.org

# Optional dashboard/demo URL written to ENS metadata
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Getting Sepolia ETH for 0G:**
- Bridge ETH to Sepolia via any Sepolia faucet.
- The 0G RPC is `https://evmrpc-testnet.0g.ai`.

---

## Quickstart

### 1. Zero-wallet local smoke test

Run this first to verify the package and sandbox work. It does not require a wallet, `.env`, 0G, ENS, AXL, or an LLM key.

From this repository, run:

```bash
pnpm validate:framework
```

That command builds `@zero-agents/core`, imports the built package, executes a sandboxed tool, and verifies local `ToolRegistry` save/search/load behavior.

For a minimal app-level smoke test:

```typescript
import { ToolSandbox } from '@zero-agents/core';

const sandbox = new ToolSandbox();
const result = await sandbox.run(
  `async function execute(params) {
    return { sum: params.a + params.b };
  }`,
  { a: 2, b: 3 }
);

if (!result.success) {
  throw new Error(result.error);
}

console.log(result.output);
// { sum: 5 }
```

### 2. Agent evolution with 0G storage

The full `SelfEvolvingAgent` path can reuse locally stored tools without a wallet, but first-time tool generation requires either 0G Compute through `ZERO_G_PRIVATE_KEY` or OpenAI fallback through `OPENAI_API_KEY`. Saving generated tools to real 0G Storage also requires `ZERO_G_PRIVATE_KEY`. Without those credentials, use the demo agent's offline fallback or test lower-level modules directly.

```typescript
import { SelfEvolvingAgent } from '@zero-agents/core';

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A research assistant',
  capabilities: ['web-search', 'summarization'],
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  openAiKey: process.env.OPENAI_API_KEY,   // optional fallback
  axlEnabled: false,                       // local examples should not probe localhost:9002
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

The demo is intentionally resilient: with no keys it uses offline fallback generation, offline tool hashes, mock ENS records, and simulated AXL if a local node is unavailable. With real credentials and services configured, it attempts the live paths.

```bash
cd packages/demo-agent
pnpm demo
```

---

## Windows and Native Dependencies

`isolated-vm` is a native dependency. Use Node.js 20 to match `@zero-agents/core` and reduce native build issues.

If install fails on Windows with `node-gyp`, `MSBuild`, or C++ compiler errors, install Visual Studio Build Tools with the "Desktop development with C++" workload and retry the install.

If `isolated-vm` installs but cannot load, local development can explicitly opt into the restricted Node `vm` fallback with `new ToolSandbox({ allowUnsafeNodeVmFallback: true })`. Do not treat that fallback as a production security boundary for hostile generated code.

---

## Integration Tests

Each test targets a single integration. Run the zero-wallet validation first, then run these only when the matching credentials or local services are available.

```bash
# Zero-wallet framework validation
pnpm validate:framework

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
| `pnpm validate:framework` | Zero-wallet package smoke test |
| `pnpm test:storage` | Integration test for 0G Storage |
| `pnpm test:agent` | Integration test for full agent loop |

---

## Alpha Readiness Notes

`@zero-agents/core` is ready for external alpha developers who are comfortable with Node.js, ESM, native dependencies, and testnet credentials. The stable zero-wallet surface is `ToolSandbox`, local-mode `ToolRegistry`, deterministic reflection, experience memory, and the offline demo flow.

The live self-evolving path depends on external systems: 0G Compute or OpenAI for generation, 0G Storage for permanent tool persistence, ENS for public identity records, and a local Gensyn AXL node for peer-to-peer routing. Treat those as opt-in integration paths and validate each environment before demoing or shipping.

---

## Next Steps

- Read [Core Concepts](./core-concepts.md) to understand how tools and the evolution loop work.
- Read [API Reference](./api-reference.md) for the full method signatures.
- Read [Integrations](./integrations.md) to configure 0G Compute, ENS, and AXL.
