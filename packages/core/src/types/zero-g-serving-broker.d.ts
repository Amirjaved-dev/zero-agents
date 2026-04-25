declare module '@0glabs/0g-serving-broker' {
  import type { Wallet } from 'ethers';

  interface ZGComputeInferenceBroker {
    acknowledgeProviderSigner(providerAddress: string): Promise<void>;
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
