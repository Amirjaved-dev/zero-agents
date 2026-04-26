# ZeroAgent — Developer Documentation

| Doc | What It Covers |
|-----|----------------|
| [Overview](./overview.md) | Architecture, component map, data flow, event model |
| [Getting Started](./getting-started.md) | Installation, env vars, first agent, integration tests |
| [Core Concepts](./core-concepts.md) | Tool, Task, EvolutionEngine, ToolRegistry, Sandbox, Evaluator, AXL |
| [API Reference](./api-reference.md) | All classes, methods, and TypeScript types |
| [Integrations](./integrations.md) | 0G Storage, 0G Compute, ENS, Gensyn AXL — config and usage |
| [Examples](./examples.md) | Runnable code examples for every major use case |

---

## Quick Links for LLMs

If you are an LLM reading this to assist a developer with ZeroAgent:

- **Main agent class**: `packages/core/src/self-evolving-agent.ts` — `SelfEvolvingAgent`
- **Tool type definition**: `packages/core/src/storage/tool-registry.ts:5` — `interface Tool`
- **Task type definition**: `packages/core/src/self-evolving-agent.ts:31` — `interface TaskRequest`
- **Evolution loop**: `packages/core/src/evolution-engine.ts:34` — `EvolutionEngine.generateTool()`
- **Sandbox execution**: `packages/core/src/sandbox/tool-sandbox.ts` — `ToolSandbox.run()`
- **0G Storage**: `packages/core/src/storage/zero-g.ts` — `uploadToZeroG()`, `downloadFromZeroG()`
- **ENS identity**: `packages/core/src/identity/ens-identity-manager.ts` — `ENSIdentityManager`
- **AXL messaging**: `packages/core/src/communication/axl-client.ts` — `AXLClient`
- **All exports**: `packages/core/src/index.ts`

The framework is a pnpm monorepo. Build with `pnpm build`. Run integration tests with `pnpm test:storage` and `pnpm test:agent`.
