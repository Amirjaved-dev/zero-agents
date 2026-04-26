import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ResearchAgent from '../src/index.js';
import { ENSIdentityManager } from '@zero-agents/core';
import type { AgentIdentityProvider, AgentProfile, AgentStepEvent, TaskResult } from '@zero-agents/core';

const TASK_DESCRIPTION = 'Search for the top 3 trending AI agents news today and summarize them';

class DemoIdentityProvider implements AgentIdentityProvider {
  private profile: AgentProfile | null = null;
  private readonly axlPeerIds = new Map<string, string>();
  private readonly textRecords = new Map<string, string>();

  constructor(private readonly ensName: string) {}

  async getProfile(): Promise<AgentProfile | null> {
    return this.profile;
  }

  async setProfile(profile: AgentProfile): Promise<void> {
    this.profile = profile;
    this.textRecords.set('description', profile.description);
    this.textRecords.set('capabilities', JSON.stringify(profile.capabilities));
    this.textRecords.set('zeroagent.toolRegistry', profile.toolRegistryHash);

    if (profile.axlPeerId) {
      this.textRecords.set('zeroagent.axlPeerId', profile.axlPeerId);
      this.axlPeerIds.set(this.ensName, profile.axlPeerId);
    }

    if (profile.url) {
      this.textRecords.set('url', profile.url);
    }
  }

  async getToolRegistryHash(): Promise<string | null> {
    return this.textRecords.get('zeroagent.toolRegistry') ?? null;
  }

  async setToolRegistryHash(rootHash: string): Promise<void> {
    this.textRecords.set('zeroagent.toolRegistry', rootHash);
  }

  async setAXLPeerId(peerId: string): Promise<void> {
    this.textRecords.set('zeroagent.axlPeerId', peerId);
    this.axlPeerIds.set(this.ensName, peerId);
  }

  async getAXLPeerIdForName(ensName: string): Promise<string | null> {
    return this.axlPeerIds.get(ensName) ?? null;
  }

  setUrl(url: string): void {
    this.textRecords.set('url', url);
  }

  entries(): Array<[string, string]> {
    return Array.from(this.textRecords.entries());
  }
}

function createIdentity(ensName: string): AgentIdentityProvider {
  const privateKey = process.env.ENS_PRIVATE_KEY;
  const configuredName = process.env.ENS_NAME ?? ensName;
  if (privateKey && configuredName === ensName) {
    return new ENSIdentityManager({
      ensName,
      privateKey,
      rpcUrl: process.env.SEPOLIA_RPC_URL
    });
  }
  return new DemoIdentityProvider(ensName);
}

async function printModeBanner(): Promise<void> {
  const hasZeroG = !!process.env.ZERO_G_PRIVATE_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasENS = !!(process.env.ENS_PRIVATE_KEY && process.env.ENS_NAME);

  console.log('\n=== ZeroAgent Demo — Mode ===');
  console.log(`  Tool Generation : ${hasZeroG ? 'REAL 0G Compute' : hasOpenAI ? 'REAL OpenAI' : 'OFFLINE FALLBACK (no keys)'}`);
  console.log(`  0G Storage      : ${hasZeroG ? 'REAL 0G Testnet' : 'OFFLINE (sha256 hash)'}`);
  console.log(`  ENS Identity    : ${hasENS ? `REAL Sepolia (${process.env.ENS_NAME})` : 'MOCK (in-memory)'}`);
  console.log(`  AXL P2P         : Will attempt real AXL, falls back to simulation`);
  console.log('=============================\n');
}

function logStep(step: number, message: string): void {
  console.log(`\n${timestamp()} STEP ${step}: ${message}`);
}

function logHighlight(message: string): void {
  console.log(`${timestamp()} >>> ${message}`);
}

function logEvent(agentName: string, event: AgentStepEvent): void {
  const data = event.data ? ` ${JSON.stringify(event.data)}` : '';
  console.log(`${timestamp()} [${agentName}] ${event.type.toUpperCase()}: ${event.message}${data}`);
}

function printResult(label: string, result: TaskResult): void {
  console.log(`${timestamp()} ${label}:`);
  console.log(JSON.stringify(result, null, 2));
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

async function main(): Promise<void> {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  process.chdir(packageRoot);

  await printModeBanner();

  const tempDir = await mkdtemp(join(tmpdir(), 'zero-agent-demo-'));
  const researchIdentity = createIdentity('research-agent.eth');
  const plannerIdentity = createIdentity('planner-agent.eth');
  if (researchIdentity instanceof DemoIdentityProvider) {
    researchIdentity.setUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://github.com/zero-agents/zero-agent');
  }
  if (plannerIdentity instanceof DemoIdentityProvider) {
    plannerIdentity.setUrl(process.env.NEXT_PUBLIC_APP_URL ?? 'https://github.com/zero-agents/zero-agent');
  }

  const researchAgent = new ResearchAgent({
    name: 'research-agent.eth',
    identity: researchIdentity,
    registryPath: join(tempDir, 'research-agent-index.json')
  });
  researchAgent.on('step', (event) => logEvent(researchAgent.name, event));

  logStep(1, 'Start research-agent.eth with an empty tool library');
  await researchAgent.publishProfile();
  logHighlight(`Capabilities: ${researchAgent.capabilities.join(', ')}`);
  logHighlight(`Initial registry tools: ${researchAgent.exportTools().length}`);

  logStep(2, `Send task: "${TASK_DESCRIPTION}"`);
  logStep(3, 'Agent searches registry and should log MISS');
  logStep(4, 'Generate tool: web_search_and_summarize');
  logStep(5, 'Sandbox test the generated code');
  logStep(6, 'Evaluate generated tool and capture score');
  logStep(7, 'Save generated tool to 0G and log root hash');
  logStep(8, 'Execute task and return result');
  const firstResult = await researchAgent.handleTask({ description: TASK_DESCRIPTION });
  printResult('First run result', firstResult);

  const firstRootHash = researchAgent.getStoredToolRootHashes()[0] ?? '';
  await researchIdentity.setToolRegistryHash(firstRootHash);

  logStep(9, 'Send the same task again');
  logStep(10, 'Agent searches registry, finds existing tool, and reuses it');
  const secondResult = await researchAgent.handleTask({ description: TASK_DESCRIPTION });
  printResult('Second run result', secondResult);

  if (secondResult.wasGenerated) {
    throw new Error('Expected second run to reuse the existing web_search_and_summarize tool.');
  }

  logStep(11, 'Start planner-agent.eth and import tools from research-agent.eth');
  const plannerAgent = new ResearchAgent({
    name: 'planner-agent.eth',
    identity: plannerIdentity,
    registryPath: join(tempDir, 'planner-agent-index.json')
  });
  plannerAgent.on('step', (event) => logEvent(plannerAgent.name, event));
  await plannerAgent.publishProfile(firstRootHash);

  const importedToolCount = await plannerAgent.importToolsFrom(researchAgent);
  logHighlight(`Planner imported ${importedToolCount} tool(s) from research-agent.eth`);

  logStep(12, 'Planner sends task to research-agent.eth over AXL and receives a result');
  const axlResult = await plannerAgent.sendTaskOverAXL(researchAgent, { description: TASK_DESCRIPTION });
  printResult('AXL routed result', axlResult);

  const allTools = researchAgent.exportTools();
  const saveRecords = researchAgent.getToolSaveRecords();
  const axlMessages = plannerAgent.getAXLMessages();

  console.log('\n=== DEMO SUMMARY ===');
  console.log(`Total tools in registry: ${allTools.length}`);
  console.log('0G root hashes of stored tools:');
  for (const record of saveRecords) {
    console.log(`- ${record.toolName}: ${record.rootHash} (${record.storage})`);
  }

  console.log('ENS text records set:');
  if (researchIdentity instanceof DemoIdentityProvider) {
    for (const [key, value] of researchIdentity.entries()) {
      console.log(`- research-agent.eth ${key}=${value}`);
    }
  }
  if (plannerIdentity instanceof DemoIdentityProvider) {
    for (const [key, value] of plannerIdentity.entries()) {
      console.log(`- planner-agent.eth ${key}=${value}`);
    }
  }

  console.log('AXL messages exchanged:');
  for (const message of axlMessages) {
    console.log(`- ${message.type} ${message.requestId} from=${message.fromAgent ?? 'unknown'} at=${new Date(message.timestamp).toISOString()}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
