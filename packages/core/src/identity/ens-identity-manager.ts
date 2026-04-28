import { createPublicClient, createWalletClient, http, getContract, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { namehash, normalize } from 'viem/ens'
import type { AgentIdentityProvider, AgentProfile } from './types.js'

const RESOLVER_ABI = [
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' }
    ],
    name: 'text',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' }
    ],
    name: 'setText',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'node', type: 'bytes32' }],
    name: 'addr',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

export interface ENSIdentityManagerConfig {
  ensName?: string
  privateKey: string
  rpcUrl?: string
}

export class ENSIdentityManager implements AgentIdentityProvider {
  ensName: string
  private readonly account
  private readonly publicClient
  private readonly walletClient
  private node!: `0x${string}`;

  constructor(config: ENSIdentityManagerConfig) {
    this.account = privateKeyToAccount(this.normalizePrivateKey(config.privateKey))

    const rpcUrl = config.rpcUrl ?? 'https://sepolia.drpc.org'

    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl)
    })

    this.walletClient = createWalletClient({
      chain: sepolia,
      transport: http(rpcUrl),
      account: this.account
    })

    this.ensName = config.ensName ?? '';
    this.setNodeFromName(this.ensName)
  }

  static async autoDetect(privateKey: string, rpcUrl?: string): Promise<ENSIdentityManager | null> {
    const mgr = new ENSIdentityManager({ privateKey, rpcUrl })
    const detected = await mgr.detectPrimaryName()
    if (!detected) return null
    mgr.ensName = detected
    mgr.setNodeFromName(detected)
    return mgr
  }

  async detectPrimaryName(): Promise<string | null> {
    try {
      const name = await this.publicClient.getEnsName({ address: this.account.address })
      return name ?? null
    } catch {
      return null
    }
  }

  async resolveAllNames(): Promise<string[]> {
    try {
      const name = await this.detectPrimaryName()
      if (!name) return []
      return [name]
    } catch {
      return []
    }
  }

  getWalletAddress(): string {
    return this.account.address
  }

  hasEnsNameConfigured(): boolean {
    return !!this.ensName && this.ensName.length > 0
  }

  private setNodeFromName(ensName: string): void {
    try {
      this.node = ensName ? namehash(normalize(ensName)) : ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`)
    } catch {
      this.node = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
    }
  }

  async resolveAddress(): Promise<string | null> {
    try {
      const address = await this.publicClient.getEnsAddress({
        name: this.ensName
      })
      return address ?? null
    } catch {
      return null
    }
  }

  async getCapabilities(): Promise<string[]> {
    try {
      const raw = await this.getTextRecord('capabilities')
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async getToolRegistryHash(): Promise<string | null> {
    return this.getTextRecord('zeroagent.toolRegistry')
  }

  async getAXLPeerId(): Promise<string | null> {
    return this.getTextRecord('zeroagent.axlPeerId')
  }

  async getAXLPeerIdForName(ensName: string): Promise<string | null> {
    try {
      return this.getTextRecordForNode(namehash(normalize(ensName)), 'zeroagent.axlPeerId', ensName)
    } catch {
      return null
    }
  }

  async getProfile(): Promise<AgentProfile | null> {
    const [description, capabilities, toolRegistryHash, axlPeerId, url] = await Promise.all([
      this.getTextRecord('description'),
      this.getCapabilities(),
      this.getToolRegistryHash(),
      this.getAXLPeerId(),
      this.getTextRecord('url')
    ])

    if (!description && capabilities.length === 0 && !toolRegistryHash && !axlPeerId && !url) {
      return null
    }

    return {
      description: description ?? '',
      capabilities,
      toolRegistryHash: toolRegistryHash ?? '',
      axlPeerId: axlPeerId ?? undefined,
      url: url ?? undefined
    }
  }

  async setProfile(profile: AgentProfile): Promise<void> {
    await this.setAgentProfile(profile)
  }

  async setToolRegistryHash(rootHash: string): Promise<void> {
    const profile = await this.getProfile()
    await this.setAgentProfile({
      description: profile?.description ?? '',
      capabilities: profile?.capabilities ?? [],
      toolRegistryHash: rootHash,
      axlPeerId: profile?.axlPeerId,
      url: profile?.url
    })
  }

  async setAXLPeerId(peerId: string): Promise<void> {
    const profile = await this.getProfile()
    await this.setAgentProfile({
      description: profile?.description ?? '',
      capabilities: profile?.capabilities ?? [],
      toolRegistryHash: profile?.toolRegistryHash ?? '',
      axlPeerId: peerId,
      url: profile?.url
    })
  }

  async setAgentProfile(profile: AgentProfile): Promise<void> {
    const resolverAddress = await this.getResolverAddress(this.ensName)
    if (!resolverAddress) {
      throw new Error(`ENS name ${this.ensName} does not have a resolver configured`)
    }

    const resolver = getContract({
      address: resolverAddress,
      abi: RESOLVER_ABI,
      client: this.walletClient
    })

    const records: Array<{ key: string; value: string }> = [
      { key: 'description', value: profile.description },
      { key: 'capabilities', value: JSON.stringify(profile.capabilities) },
      { key: 'zeroagent.toolRegistry', value: profile.toolRegistryHash }
    ]

    if (profile.axlPeerId) {
      records.push({ key: 'zeroagent.axlPeerId', value: profile.axlPeerId })
    }

    if (profile.url) {
      records.push({ key: 'url', value: profile.url })
    }

    const results = await Promise.allSettled(
      records.map((record) => resolver.write.setText([this.node, record.key, record.value]))
    );

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length > 0) {
      const reasons = failed.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))).join('; ');
      throw new Error(`${failed.length} ENS text record(s) failed to update: ${reasons}`);
    }
  }

  async discoverAgentsByCapability(
    capability: string,
    knownAgentNames: string[]
  ): Promise<string[]> {
    const matches: string[] = []

    for (const name of knownAgentNames) {
      try {
        const node = namehash(normalize(name))
        const resolverAddress = await this.getResolverAddress(name)
        if (!resolverAddress) continue

        const contract = getContract({
          address: resolverAddress,
          abi: RESOLVER_ABI,
          client: this.publicClient
        })

        const raw = await contract.read.text([node, 'capabilities'])
        if (!raw) continue

        const caps: string[] = JSON.parse(raw)
        if (caps.includes(capability)) {
          matches.push(name)
        }
      } catch {
        continue
      }
    }

    return matches
  }

  private async getTextRecord(key: string): Promise<string | null> {
    return this.getTextRecordForNode(this.node, key)
  }

  private async getTextRecordForNode(node: `0x${string}`, key: string, ensName = this.ensName): Promise<string | null> {
    try {
      const resolverAddress = await this.getResolverAddress(ensName)
      if (!resolverAddress) return null

      const contract = getContract({
        address: resolverAddress,
        abi: RESOLVER_ABI,
        client: this.publicClient
      })

      const value = await contract.read.text([node, key])
      return value && value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  private async getResolverAddress(ensName: string): Promise<Address | null> {
    try {
      return await this.publicClient.getEnsResolver({ name: normalize(ensName) })
    } catch {
      return null
    }
  }

  private normalizePrivateKey(privateKey: string): `0x${string}` {
    const trimmed = privateKey.trim()
    return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as `0x${string}`
  }
}
