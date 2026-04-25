import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { ENSIdentityManager } from '../packages/core/dist/identity/ens-identity-manager.js';
import { SelfEvolvingAgent } from '../packages/core/dist/index.js';

const SEPOLIA_RPC = 'https://sepolia.drpc.org';

function loadEnvFile(filePath = '.env'): void {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
}

function log(label: string, msg: string): void {
  console.log(`\n[${label}] ${msg}`);
}

let passed = 0;
let failed = 0;

function assert(testName: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${testName}${detail ? `: ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function main(): Promise<void> {
  loadEnvFile();
  log('SETUP', '=== ENSIdentityManager Integration Test ===\n');

  const privateKey = process.env.ZERO_G_PRIVATE_KEY || process.env.ENS_PRIVATE_KEY;
  const fullKey = privateKey ? (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) : undefined;

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC)
  });

  log('RPC', `Connected to Sepolia via ${SEPOLIA_RPC}`);

  if (fullKey) {
    const { getAddress } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(fullKey);
    const balance = await publicClient.getBalance({ address: account.address });
    log('WALLET', `Address: ${account.address} | Balance: ${Number(balance) / 1e18} ETH`);
  }

  log('TEST', '--- Test 1: Constructor & Instantiation ---');
  try {
    const mgr = new ENSIdentityManager({
      ensName: 'test-agent.eth',
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    assert('ENSIdentityManager instantiates', mgr.ensName === 'test-agent.eth', `ensName=${mgr.ensName}`);
  } catch (err) {
    assert('ENSIdentityManager instantiates', false, err instanceof Error ? err.message : String(err));
  }

  log('TEST', '\n--- Test 2: resolveAddress() on real Sepolia ENS names ---');

  const testNames = [
    'ens.eth',
    'vitalik.eth',
    'resolver.eth',
    'nonexistent-name-xyz-12345.eth'
  ];

  for (const name of testNames) {
    const mgr = new ENSIdentityManager({
      ensName: name,
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const addr = await mgr.resolveAddress();
    if (name === 'nonexistent-name-xyz-12345.eth') {
      assert(`resolveAddress("${name}") returns null for missing name`, addr === null, `got ${addr}`);
    } else if (name === 'ens.eth') {
      assert(`resolveAddress("${name}") returns address or null`, addr === null || (addr !== null && addr.startsWith('0x')), `got ${addr}`);
      console.log(`     → ${name} resolves to ${addr ?? '(no address record)'}`);
    } else {
      assert(`resolveAddress("${name}") returns address`, addr !== null && addr!.startsWith('0x'), `got ${addr}`);
      console.log(`     → ${name} resolves to ${addr}`);
    }
  }

  log('TEST', '\n--- Test 3: getCapabilities() ---');
  {
    const mgr = new ENSIdentityManager({
      ensName: 'ens.eth',
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const caps = await mgr.getCapabilities();
    assert('getCapabilities() returns array', Array.isArray(caps), `type=${typeof caps}, value=${JSON.stringify(caps)}`);
    if (caps.length > 0) {
      console.log(`     → ens.eth capabilities: ${JSON.stringify(caps)}`);
    } else {
      console.log('     → ens.eth has no capabilities set (expected for non-agent name)');
    }
  }

  log('TEST', '\n--- Test 4: getToolRegistryHash() ---');
  {
    const mgr = new ENSIdentityManager({
      ensName: 'ens.eth',
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const hash = await mgr.getToolRegistryHash();
    assert('getToolRegistryHash() returns string or null', hash === null || typeof hash === 'string', `got ${typeof hash}: ${hash}`);
    console.log(`     → toolRegistryHash: ${hash ?? '(not set)'}`);
  }

  log('TEST', '\n--- Test 5: getAXLPeerId() ---');
  {
    const mgr = new ENSIdentityManager({
      ensName: 'ens.eth',
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const peerId = await mgr.getAXLPeerId();
    assert('getAXLPeerId() returns string or null', peerId === null || typeof peerId === 'string', `got ${typeof peerId}: ${peerId}`);
    console.log(`     → axlPeerId: ${peerId ?? '(not set)'}`);
  }

  log('TEST', '\n--- Test 6: discoverAgentsByCapability() ---');
  {
    const mgr = new ENSIdentityManager({
      ensName: 'ens.eth',
      privateKey: fullKey ?? '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const discovered = await mgr.discoverAgentsByCapability('tool-generation', ['ens.eth', 'vitalik.eth', 'resolver.eth']);
    assert('discoverAgentsByCapability() returns array', Array.isArray(discovered), `got ${JSON.stringify(discovered)}`);
    console.log(`     → Agents with "tool-generation": ${discovered.length > 0 ? discovered.join(', ') : '(none found - expected)'}`);
  }

  log('TEST', '\n--- Test 7: Error handling (invalid/bad inputs) ---');
  {
    const mgr = new ENSIdentityManager({
      ensName: '',
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const addr = await mgr.resolveAddress();
    assert('Empty ENS name returns null gracefully', addr === null, `got ${addr}`);

    const badMgr = new ENSIdentityManager({
      ensName: '...invalid-name!!!.eth',
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      rpcUrl: SEPOLIA_RPC
    });
    const badAddr = await badMgr.resolveAddress();
    assert('Invalid ENS name returns null gracefully', badAddr === null, `got ${badAddr}`);
  }

  if (fullKey) {
    log('TEST', '\n=== WRITE TESTS (requires owned ENS name) ===\n');
    log('TEST', '⚠️ Skipping write tests — no owned ENS name available.');
    log('TEST', 'To test setAgentProfile(): register a .eth name on sepolia.app.ens.domains first.');
    log('TEST', 'Then re-run with that name.');

    log('TEST', '\n--- Test 8: SelfEvolvingAgent integration (init only) ---');
    try {
      const agent = new SelfEvolvingAgent({
        name: 'test-research-agent',
        ensName: 'test-agent.eth',
        ensPrivateKey: fullKey,
        description: 'Test agent',
        capabilities: ['test-cap'],
        zeroGPrivateKey: fullKey,
        openAiKey: process.env.OPENAI_API_KEY
      });
      assert('SelfEvolvingAgent accepts ensPrivateKey', agent.ensName === 'test-agent.eth');
      assert('identityManager initialized on agent', !!(agent as any).identityManager);
      console.log(`     → Agent: ${agent.name}, ENS: ${agent.ensName}, hasIdentity: ${!!(agent as any).identityManager}`);
    } catch (err) {
      assert('SelfEvolvingAgent integration', false, err instanceof Error ? err.message : String(err));
    }
  } else {
    log('TEST', '\n⚠️ Skipping write tests and agent integration — no private key in .env');
    log('TEST', 'Set ZERO_G_PRIVATE_KEY or ENS_PRIVATE_KEY in .env to run full tests.');
  }

  log('\n', `=== RESULTS: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('\n❌ Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
