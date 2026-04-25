export interface AgentProfile {
  description: string
  capabilities: string[]
  toolRegistryHash: string
  axlPeerId?: string
  url?: string
}

export interface AgentIdentityProvider {
  getProfile(): Promise<AgentProfile | null>
  setProfile(profile: AgentProfile): Promise<void>
  getToolRegistryHash(): Promise<string | null>
  setToolRegistryHash(rootHash: string): Promise<void>
  setAXLPeerId?(peerId: string): Promise<void>
  getAXLPeerIdForName?(ensName: string): Promise<string | null>
}
