# ZeroAgent Framework

A TypeScript monorepo for building self-evolving agents with distributed state storage on 0G.

## Project Structure

```
zero-agents/
├── packages/
│   ├── core/              # ZeroAgent framework core
│   │   ├── src/
│   │   │   ├── index.ts   # SelfEvolvingAgent class
│   │   │   └── storage/
│   │   │       └── zero-g.ts  # 0G storage integration
│   │   └── tsconfig.json
│   ├── demo-agent/        # Example agent implementation
│   │   └── src/
│   │       └── index.ts   # DemoAgent example
│   └── dashboard/         # Next.js monitoring dashboard
│       └── src/
│           └── app/
├── scripts/
│   └── test-storage.ts    # 0G storage integration test
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## Setup

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your ZERO_G_PRIVATE_KEY
```

## Development

### Build all packages

```bash
pnpm build
```

### Watch mode for development

```bash
pnpm dev
```

### Test 0G Storage Integration

```bash
pnpm test:storage
```

This will:
1. Upload `{ hello: 'world', timestamp: Date.now() }` to 0G storage
2. Log the returned root hash
3. Download the data back using the root hash
4. Verify data integrity

## Packages

### `@zero-agents/core`

The core framework providing:
- `SelfEvolvingAgent` - Base class for agents with state management
- `uploadToZeroG()` - Store agent state to 0G storage
- `downloadFromZeroG()` - Retrieve agent state from 0G storage

**Dependencies:**
- `@0glabs/0g-ts-sdk` - 0G storage SDK
- `@0glabs/0g-serving-broker` - 0G broker service
- `viem` - Ethereum library
- `ethers` - Ethereum utilities
- `openai` - OpenAI API client
- `ivm` - Isolated VM

### `@zero-agents/demo-agent`

An example agent implementation extending `SelfEvolvingAgent` with task execution and evolution.

### `@zero-agents/dashboard`

A Next.js application for monitoring and managing agents.

## Configuration

The framework connects to 0G testnet:
- **EVM RPC:** `https://evmrpc-testnet.0g.ai`
- **Indexer RPC:** `https://indexer-storage-testnet-turbo.0g.ai`

## Environment Variables

- `ZERO_G_PRIVATE_KEY` - Your 0G testnet private key (required for storage operations)

See `.env.example` for reference.

## License

MIT
