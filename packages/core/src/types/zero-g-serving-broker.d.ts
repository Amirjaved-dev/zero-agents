declare module '@0glabs/0g-serving-broker' {
  import type { Wallet } from 'ethers';

  type ZGComputeService = readonly [
    providerAddress: string,
    serviceType: string,
    endpoint: string,
    inputPrice: string,
    outputPrice: string,
    updatedAt: string,
    model: string,
    verifiability: string,
    metadata: string,
    signerAddress: string,
    isAvailable: boolean
  ];

  interface ZGComputeInferenceBroker {
    listService(): Promise<ZGComputeService[]>;
    getServiceMetadata(providerAddress: string): Promise<{
      endpoint: string;
      model: string;
    }>;
    getRequestHeaders(providerAddress: string, body?: string): Promise<Record<string, string>>;
  }

  interface ZGComputeNetworkBroker {
    inference: ZGComputeInferenceBroker;
  }

  export function createZGComputeNetworkBroker(wallet: Wallet): Promise<ZGComputeNetworkBroker>;
}
