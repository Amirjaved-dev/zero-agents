# Integrations

---

## 0G Storage

**SDK:** `@0gfoundation/0g-ts-sdk`
**Source:** `packages/core/src/storage/zero-g.ts`
**Network:** 0G testnet
**RPC:** `https://evmrpc-testnet.0g.ai`
**Indexer:** `https://indexer-storage-testnet-turbo.0g.ai`

### What Is Stored

| Data | Who Writes | Who Reads |
|------|-----------|-----------|
| Individual tool blobs (JSON) | `ToolRegistry.saveTool()` | `ToolRegistry.getTool()` |
| Tool index blob (tool metadata plus root hashes) | `ToolRegistry.updateIndex()` / `saveTool()` | `ToolRegistry.loadIndex()` / `searchTools()` |

### How the Index Works

```
.zero-agent-index.json          (local pointer file, git-ignored)
  └── rootHash: "0xABC..."      (points to current index blob)

0G blob at 0xABC...             (the index)
  └── {
        "fetch_hn_stories": {
          "rootHash": "0x111...",
          "name": "fetch_hn_stories",
          "description": "Fetches top Hacker News stories",
          "tags": ["hacker-news", "fetch"],
          "successRate": 1,
          "usageCount": 3
        },
        "_meta": { updatedAt: 1700000000000, count: 2 }
      }

0G blob at 0x111...             (the tool)
  └── { id, name, description, code, schema, tags, ... }
```

Every `saveTool()` call stores the tool, stores a new index blob, then updates the local pointer file. Without a configured private key, `ToolRegistry` defaults to local JSON storage in `.zero-agent-tools.json` and returns deterministic `local-...` hashes.

### Configuration

```env
ZERO_G_PRIVATE_KEY=your_ethereum_private_key_no_0x_prefix
```

The wallet must have Sepolia ETH. Uploads cost a small gas fee.

### Direct Usage

```typescript
import { ToolRegistry } from '@zero-agents/core';

const registry = new ToolRegistry();

// Save a tool
const rootHash = await registry.saveTool(myTool);
console.log('Stored at:', rootHash);

// Retrieve it later (even from a different machine)
const tool = await registry.getTool(rootHash);

// Search by query
const tools = await registry.searchTools('fetch web page');
```

`new ToolRegistry()` uses 0G only when `ZERO_G_PRIVATE_KEY` is configured. For a hard failure when 0G credentials are missing, use `new ToolRegistry({ storageMode: 'zero-g' })`.

---

## 0G Compute

**SDK:** `@0glabs/0g-serving-broker`
**Source:** `packages/core/src/generation/tool-generator.ts`

0G Compute is the primary LLM backend for tool generation. The `ToolGenerator` queries the serving broker for available "chatbot" providers and calls their `/chat/completions` endpoint.

### Fallback Chain

```
1. 0G Compute broker — finds available provider, calls /chat/completions
2. OpenAI gpt-4o-mini — if OPENAI_API_KEY is set and 0G is unavailable
3. Error — if neither is available
```

### LLM Prompt Contract

The system prompt instructs the LLM to return **only JSON**, no markdown:

```json
{
  "name": "fetch_hn_stories",
  "description": "Fetches top Hacker News stories",
  "code": "async function execute(params) { const r = await fetch('...'); return await r.json(); }",
  "schema": {
    "input": { "limit": "number" },
    "output": { "stories": "array", "summary": "string" }
  },
  "tags": ["hacker-news", "fetch", "stories"]
}
```

Returned `code` is a complete self-contained async function string named `execute`.

### Configuration

```env
# Required for 0G Compute broker setup
ZERO_G_PRIVATE_KEY=your_ethereum_private_key_no_0x_prefix

# Optional — enables OpenAI fallback
OPENAI_API_KEY=sk-...
```

No additional 0G Compute config is needed; the broker is discovered automatically using `ZERO_G_PRIVATE_KEY`.

---

## ENS (Ethereum Name Service)

**Library:** `viem`
**Source:** `packages/core/src/identity/ens-identity-manager.ts`
**Network:** Sepolia testnet
**Resolver:** resolved dynamically from the ENS name before reads and writes.

### What Gets Written

Each agent writes to ENS text records on its ENS name:

| Record | Value |
|--------|-------|
| `description` | Agent description string |
| `capabilities` | `JSON.stringify(string[])` |
| `zeroagent.toolRegistry` | 0G root hash of the tool index |
| `zeroagent.axlPeerId` | Gensyn AXL peer ID |
| `url` | Optional repository or endpoint URL |

### Setup

You need to own an ENS name on Sepolia. Registrar: `https://app.ens.domains` (switch to Sepolia).

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({
  ensName: 'my-agent.eth',
  privateKey: process.env.ZERO_G_PRIVATE_KEY!,
});

const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  description: 'A web research agent',
  capabilities: ['web-search', 'summarization'],
  identity,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: false,
});

// Publish profile to ENS (writes all text records)
await agent.publishProfile();
```

### Agent Discovery

Any agent can look up another agent's profile by ENS name:

```typescript
const identity = new ENSIdentityManager({ ensName: 'my-agent.eth', privateKey: '...' });

// Get another agent's full profile
const profile = await identity.getProfile();
// { description, capabilities, toolRegistryHash, axlPeerId, url }

// Resolve AXL peer ID for direct messaging
const peerId = await identity.getAXLPeerIdForName('other-agent.eth');

// Find agents with a specific capability
const agents = await identity.discoverAgentsByCapability('web-search', [
  'agent-a.eth', 'agent-b.eth', 'agent-c.eth'
]);
```

---

## Gensyn AXL

**Source:** `packages/core/src/communication/axl-client.ts`
**Protocol:** HTTP (local AXL node)
**Default port:** `9002`

AXL (Agent eXchange Layer) is Gensyn's peer-to-peer messaging network. Each agent runs a local AXL node and communicates with other agents by peer ID.

### AXL Node Setup

```bash
# Start a local Gensyn AXL node that exposes HTTP on localhost:9002.
# If you keep an AXL checkout in local-axl/, follow that repo's setup instructions.

# The node exposes HTTP endpoints at localhost:9002
```

### Message Protocol

All messages follow `AgentMessage`:

```typescript
{
  type: 'task_request' | 'task_result' | 'tool_share' | 'ping';
  requestId: string;   // UUID, used to match request → result
  payload: any;        // TaskRequest for task_request, TaskResult for task_result, Tool for tool_share
  fromAgent?: string;  // Sender's agent name
  timestamp: number;   // Unix ms
}
```

### Sending a Task to Another Agent

```typescript
import { SelfEvolvingAgent, ENSIdentityManager } from '@zero-agents/core';

const identity = new ENSIdentityManager({ ensName: 'my-agent.eth', privateKey: '...' });
const agent = new SelfEvolvingAgent({
  name: 'my-agent.eth',
  identity,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY!,
  axlEnabled: true,
});

// Resolves other-agent.eth's AXL peer ID via ENS, then sends task over AXL
const result = await agent.collaborateWith('other-agent.eth', {
  description: 'Summarize the latest AI news',
  params: { limit: 5 },
});
```

Internally this calls:
1. `identity.getAXLPeerIdForName('other-agent.eth')` — ENS lookup
2. `axlClient.sendTask(peerId, task)` — sends `task_request` message, polls for `task_result` with 30 s timeout

### Receiving Tasks

When `SelfEvolvingAgent` is constructed with `axlEnabled: true`, it initializes AXL and starts an `AgentCoordinator`. It:
1. Calls `axlClient.getPeerId()` and stores the result in `agent.getState().metadata.axlPeerId`
2. Calls `axlClient.startListening(handler)` to poll `/messages` every 500 ms, with `/recv` fallback for older local AXL builds
3. Routes inbound messages:
   - `task_request` → `agent.handleTask(payload)` → sends back `task_result`
   - `tool_share` → `registry.importTool(payload)`
   - `ping` → no-op

### Sharing Tools

```typescript
import { AgentCoordinator, AXLClient, ToolRegistry } from '@zero-agents/core';

const axlClient = new AXLClient({ axlPort: 9002 });
const registry = new ToolRegistry();
const coordinator = new AgentCoordinator({ agent, registry, axlClient });

// Share all local tools with another peer
const otherPeerId = await axlClient.getPeerId(); // or resolve via ENS
await coordinator.shareToolLibrary(otherPeerId);
```

### AXL Without ENS

You can use AXL directly with raw peer IDs:

```typescript
const axlClient = new AXLClient({ axlPort: 9002 });
const myPeerId = await axlClient.getPeerId();

// Send raw message
await axlClient.sendMessage(remotePeerId, {
  type: 'ping',
  requestId: crypto.randomUUID(),
  payload: {},
  timestamp: Date.now(),
});

// Send task and wait for result
const result = await axlClient.sendTask(remotePeerId, {
  description: 'Fetch weather for London',
});
```
