# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZeroAgent is a TypeScript npm framework for self-evolving AI agents. Agents start with zero tools, generate tools on demand via LLM, store them permanently on-chain (0G Storage), and reuse them across tasks and agent networks. Built as a hackathon entry for ETHGlobal Open Agents 2026.

## Commands

### Build & Development

```bash
# Build all packages
pnpm build

# Watch mode (all packages)
pnpm dev

# Dashboard only
cd packages/dashboard && pnpm dev   # Next.js dev server
cd packages/dashboard && pnpm build # Next.js production build
cd packages/dashboard && pnpm lint  # Next.js lint
```

### Running the Demo

```bash
cd packages/demo-agent && pnpm demo   # 12-step demo sequence
```

### Integration Tests (require env vars)

```bash
# Run from root with tsx
tsx scripts/test-storage.ts          # 0G upload/download (ZERO_G_PRIVATE_KEY required)
tsx scripts/test-agent.ts            # Full evolution loop (ZERO_G_PRIVATE_KEY required)
tsx scripts/test-ens-identity.ts     # ENS read/write - 11 test cases

# AXL P2P test (Windows PowerShell, requires local AXL binary at ./local-axl/)
powershell -ExecutionPolicy Bypass -File scripts/test-axl-local.ps1
```

### Root-level pnpm scripts

```bash
pnpm test:storage   # → tsx scripts/test-storage.ts
pnpm test:agent     # → tsx scripts/test-agent.ts
```

## Architecture

### Monorepo Structure

```
packages/
  core/         → @zero-agents/core (main published framework, ~1,650 LOC)
  demo-agent/   → @zero-agents/demo-agent (ResearchAgent example)
  dashboard/    → @zero-agents/dashboard (Next.js monitoring UI, placeholder)
scripts/        → Integration tests
docs/           → API reference, guides
```

All packages use ESM (`"type": "module"`), TypeScript strict mode, and are managed via pnpm workspaces.

### Self-Evolution Loop

When a task arrives:
1. **Search** `ToolRegistry` by name/description
2. **HIT** → execute cached tool → done
3. **MISS** → `EvolutionEngine.evolve()`:
   - `ToolGenerator` calls 0G Compute broker → falls back to OpenAI `gpt-4o-mini`
   - `ToolSandbox` executes code in `isolated-vm` (16MB, 3s timeout) → falls back to Node `vm`
   - `ToolEvaluator` generates 2 LLM test cases, scores ≥ 0.7 to pass
   - On failure: retry up to 3× with error feedback
   - On pass: `ToolRegistry.saveTool()` uploads JSON blob to 0G Storage
4. Tool is now cached locally and on-chain for future agents

### Core Modules (`packages/core/src/`)

| Module | Purpose |
|--------|---------|
| `self-evolving-agent.ts` | Main agent class (EventEmitter), orchestrates all subsystems |
| `evolution-engine.ts` | 3-attempt retry loop with feedback |
| `generation/tool-generator.ts` | LLM tool code generation (0G Compute → OpenAI fallback) |
| `sandbox/tool-sandbox.ts` | isolated-vm execution with Node vm fallback |
| `sandbox/tool-evaluator.ts` | LLM test generation + pass/fail scoring |
| `storage/zero-g.ts` | 0G Storage upload/download (ethers.js signer) |
| `storage/tool-registry.ts` | Tool index: local `.zero-agent-index.json` + 0G root hashes + in-memory cache |
| `identity/ens-identity-manager.ts` | ENS text records on Sepolia (viem) |
| `communication/axl-client.ts` | HTTP client for Gensyn AXL (polling GET /recv, POST /send) |
| `communication/agent-coordinator.ts` | Routes AXL messages → agent task handling + tool sharing |

### Key Design Patterns

- **Fallback chains**: 0G Compute → OpenAI for generation; isolated-vm → Node vm for sandboxing
- **Retry with feedback**: evolution engine captures sandbox/eval errors and passes them back to the generator
- **Local pointer + on-chain truth**: `.zero-agent-index.json` maps tool names to 0G root hashes; in-memory cache for hot tools
- **EventEmitter steps**: agent emits `search`, `miss`, `generating`, `sandboxing`, `evaluating`, `saving`, `executing`, `done`, `error` for real-time observability

### Networks (Hardcoded Defaults)

- 0G Testnet RPC: `https://evmrpc-testnet.0g.ai`
- 0G Indexer: `https://indexer-storage-testnet-turbo.0g.ai`
- Sepolia ENS: Public Resolver at `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`
- Gensyn AXL: `http://localhost:9002`

## Environment Variables

```
ZERO_G_PRIVATE_KEY    # Required: 0G testnet signing key
OPENAI_API_KEY        # Optional: fallback LLM (gpt-4o-mini)
ENS_PRIVATE_KEY       # Optional: for ENS text record writes
ENS_NAME              # Optional: agent's ENS name (e.g. my-agent.eth)
SEPOLIA_RPC_URL       # Optional: custom Sepolia RPC
```

Copy `.env.example` to `.env` before running any scripts.

## TypeScript Configuration

Root `tsconfig.json` enforces:
- `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- Target: ES2020, Module: ESNext, Resolution: bundler
- Declaration maps + source maps enabled

All packages extend the root config with `rootDir: src` / `outDir: dist`.

## Requirements

- Node.js 20+ (required for `isolated-vm` native module)
- pnpm 8+
- Windows: Visual Studio Build Tools 2022 for native module compilation

## Key Files for Context

- `AGENTS.md` — Cursor AI project rules and sponsor integration context
- `packages/core/src/index.ts` — All public exports
- `packages/demo-agent/scripts/run-demo.ts` — 12-step demo sequence showing full framework usage
- `docs/api-reference.md` — Full API documentation
