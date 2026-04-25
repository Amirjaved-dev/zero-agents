# ZeroAgent — Cursor AI Rules & Project Context

## CORE RULE — READ THIS FIRST

You are a coding assistant. You do NOT build ahead. You do NOT assume what comes next.
The developer gives you a task. You complete exactly that task. Nothing more.
Do not create files that weren't asked for. Do not install packages that weren't asked for.
Do not refactor code that wasn't mentioned. Do not add "bonus" features.
Ask if something is unclear. Do not guess and build.

---

## What We Are Building

**Project Name:** ZeroAgent
**Type:** npm framework package + demo agent + Next.js dashboard
**Hackathon:** ETHGlobal Open Agents 2026
**Tagline:** ENS-native self-evolving agent framework

ZeroAgent is a reusable TypeScript framework that lets developers create AI agents that:
- Start with zero tools
- Generate new tools on demand when they face unknown tasks
- Test generated tools in a safe isolated sandbox
- Store approved tools permanently on 0G decentralized storage
- Reuse tools across sessions (persistent memory)
- Share tools with other agents
- Have onchain identities via ENS (Ethereum Name Service)
- Communicate peer-to-peer with other agents via Gensyn AXL

This is a **framework**, not a single app. The deliverable is a reusable engine other developers can `npm install`.

---

## Repo Structure

```
zero-agent/
├── packages/
│   ├── core/              ← The framework (main npm package)
│   ├── demo-agent/        ← Example research agent built on the framework
│   └── dashboard/         ← Next.js UI that visualizes the demo live
├── docs/
├── README.md
└── package.json           ← pnpm workspace root
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript + Node.js |
| Package Manager | pnpm (workspace monorepo) |
| Storage / Memory | 0G Storage via `@0glabs/0g-ts-sdk` |
| Inference / Compute | 0G Compute via `@0glabs/0g-serving-broker` (fallback: OpenAI) |
| Agent Identity | ENS via `viem` |
| Agent Communication | Gensyn AXL (local binary + HTTP API on localhost:9002) |
| Tool Sandbox | `ivm` (isolated-vm) |
| Dashboard | Next.js 14 + Tailwind CSS |

---

## Sponsor Integrations (Critical for Judging)

### 0G Storage
- Package: `@0glabs/0g-ts-sdk`
- Testnet EVM RPC: `https://evmrpc-testnet.0g.ai`
- Testnet Indexer: `https://indexer-storage-testnet-turbo.0g.ai`
- Used for: storing tool code + metadata as JSON blobs, retrieving by root hash
- Every approved tool gets a permanent 0G root hash as its ID

### 0G Compute
- Package: `@0glabs/0g-serving-broker`
- Used for: running LLM inference to generate new tool code
- Exposes OpenAI-compatible API after broker setup
- Fallback to OpenAI gpt-4o-mini if 0G Compute is unavailable

### ENS (Ethereum Name Service)
- Package: `viem`
- Used for: agent identity (`research-agent.eth`), storing capabilities + tool registry hash + AXL peer ID as text records
- ENS must be functional, not just cosmetic — judges will resolve the name and read the records
- Use Sepolia testnet for ENS operations

### Gensyn AXL
- AXL is a binary that runs locally and exposes HTTP on `localhost:9002`
- Used for: agent-to-agent P2P communication (send tasks, receive results, share tools)
- Key endpoints: `GET /info` (get peer ID), `POST /send` (send message), `GET /messages` (poll inbox)
- Peer ID is derived from ed25519 keypair — stable and permanent

---

## Core Concepts

### Tool
A tool is a self-contained async JavaScript function stored as a string, along with metadata.
```typescript
interface Tool {
  id: string
  name: string
  description: string
  code: string           // async function execute(params) { ... }
  schema: { input: object, output: object }
  tags: string[]
  successRate: number    // 0 to 1
  usageCount: number
  createdAt: number
  rootHash?: string      // assigned after 0G upload
}
```

### Self-Evolution Flow
```
Task arrives
→ Search tool registry (semantic/string match)
→ Tool found? YES → run it via sandbox → done
→ Tool found? NO  → generate tool via LLM
                  → sandbox test
                  → evaluate (score >= 0.7 to pass)
                  → failed? retry up to 3x with feedback
                  → passed? save to 0G
                  → run tool → done
```

### Tool Registry
- Local index: `.zero-agent-index.json` maps tool names to 0G root hashes
- The index itself is also stored on 0G (as a JSON blob) for sharing
- Tools are fetched from 0G by root hash on demand

### Agent Events
The agent emits events at each step for the dashboard to listen to:
```
'search'      → searching registry
'miss'        → no tool found
'generating'  → calling LLM to write tool code
'sandboxing'  → running code in isolated VM
'evaluating'  → scoring the tool
'saving'      → uploading to 0G
'executing'   → running the tool on the real task
'done'        → task complete
'error'       → something failed
```

---

## Demo Flow (12 Steps — This Is the Winning Moment)

1. Agent starts with empty tool library
2. Task arrives: "fetch the current ETH price and return it as a number"
3. Registry search → no tool found (MISS)
4. Generate new tool using 0G Compute
5. Sandbox test the generated code
6. Evaluate → score returned
7. Save to 0G → root hash logged
8. Execute task → result returned
9. Same task arrives again
10. Registry search → tool found (HIT) → instant reuse
11. Second agent (`planner-agent.eth`) imports tools from first agent
12. Planner routes task to researcher over AXL → result returned

Step 9-10 is the emotional payoff judges need to see: **"the agent actually learned."**

---

## ENS Setup

- Register `research-agent.eth` on Sepolia testnet at app.ens.domains
- Register `planner-agent.eth` on Sepolia testnet
- Text records to set on each agent's ENS name:
  - `description` — what the agent does
  - `capabilities` — JSON array of capability strings
  - `zeroagent.toolRegistry` — 0G root hash of the tool index
  - `zeroagent.axlPeerId` — the agent's AXL peer ID
  - `url` — repo or demo URL

---

## Environment Variables

```env
ZERO_G_PRIVATE_KEY=          # wallet private key for 0G testnet (needs OG tokens for gas)
OPENAI_API_KEY=               # fallback for tool generation if 0G Compute is down
NEXT_PUBLIC_APP_URL=          # dashboard URL
```

---

## What Has Been Done

Nothing has been built yet. This is Day 0.
The roadmap has been planned. The PRD is finalized.
Building starts now, task by task.

---

## Rules for This Project

1. **Wait for task.** Do not start building something until explicitly told to.
2. **One task at a time.** Complete the given task fully, then stop.
3. **No extra files.** Only create files that are part of the task.
4. **No extra packages.** Only install what the task requires.
5. **No refactoring other files.** Unless the task specifically says to.
6. **No assumptions about next steps.** Do not scaffold future days' work.
7. **Ask before guessing.** If a task is ambiguous, ask one clarifying question.
8. **Keep code clean.** TypeScript strict mode. No `any` unless necessary. Proper error handling.
9. **Test scripts work.** Any test or demo script must actually run without errors.
10. **Commit-ready code only.** Every task result should be clean enough to commit.

---

## Current Status

**Day:** 0 (Not started)
**Last completed task:** None
**Next task:** Waiting for developer instruction