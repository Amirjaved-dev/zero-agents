import { createPublicClient, createWalletClient, http, getContract } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { namehash, normalize } from 'viem/ens'
import type { AgentProfile } from './types.js'

const ENS_REGISTRY_ADDRESS = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as const
const PUBLIC_RESOLVER_ADDRESS = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63' as const

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
  ensName: string
  privateKey: string
  rpcUrl?: string
}

export class ENSIdentityManager {
  readonly ensName: string
  private readonly account
  private readonly publicClient
  private readonly walletClient
  private readonly node: `0x${string}`

  constructor(config: ENSIdentityManagerConfig) {
    this.ensName = config.ensName
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)

    const rpcUrl = config.rpcUrl ?? 'https://rpc.sepolia.org'

    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl)
    })

    this.walletClient = createWalletClient({
      chain: sepolia,
      transport: http(rpcUrl),
      account: this.account
    })

    this.node = namehash(normalize(this.ensName))
  }

  async resolveAddress(): Promise<string | null> {
    try {
      const address = await this.publicClient.getAddress({
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

  async setAgentProfile(profile: AgentProfile): Promise<void> {
    const resolver = getContract({
      address: PUBLIC_RESOLVER_ADDRESS,
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

    for (const record of records) {
      await resolver.write.setText([this.node, record.key, record.value])
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
        const client = createPublicClient({
          chain: sepolia,
          transport: http()
        })
        const contract = getContract({
          address: PUBLIC_RESOLVER_ADDRESS,
          abi: RESOLVER_ABI,
          client
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
    try {
      const contract = getContract({
        address: PUBLIC_RESOLVER_ADDRESS,
        abi: RESOLVER_ABI,
        client: this.publicClient
      })

      const value = await contract.read.text([this.node, key])
      return value && value.length > 0 ? value : null
    } catch {
      return null
    }
  }
}
