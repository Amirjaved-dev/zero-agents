/**
 * 0G Storage Integration
 * Handles upload and download of agent state from 0G distributed storage
 */

import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageError } from '../errors.js';

const DEFAULT_BLOCKCHAIN_RPC = 'https://evmrpc-testnet.0g.ai';
const DEFAULT_IND_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';


type IndexerUploadSigner = Parameters<Indexer['upload']>[2];
type UploadResponse = string | { rootHash: string; txHash?: string } | { rootHashes: string[]; txHashes?: string[] };

export interface ZeroGStorageOptions {
  privateKey?: string;
  /** Override the 0G EVM RPC endpoint. Defaults to the public 0G testnet. */
  blockchainRpc?: string;
  /** Override the 0G Storage indexer endpoint. Defaults to the public 0G testnet indexer. */
  indexerRpc?: string;
}

/**
 * Retry helper with exponential backoff.
 * Attempts: 1 → 2 → 3 with delays 500ms → 1000ms between retries.
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((res) => setTimeout(res, baseDelayMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Upload data to 0G storage
 * @param data - Object to store
 * @returns Root hash of the uploaded data
 */
export async function uploadToZeroG(data: object, options: ZeroGStorageOptions = {}): Promise<string> {
  const privateKey = options.privateKey ?? process.env.ZERO_G_PRIVATE_KEY;
  if (!privateKey) {
    throw new StorageError('ZERO_G_PRIVATE_KEY environment variable not set');
  }

  const blockchainRpc = options.blockchainRpc ?? DEFAULT_BLOCKCHAIN_RPC;
  const indexerRpc = options.indexerRpc ?? DEFAULT_IND_RPC;

  const provider = new JsonRpcProvider(blockchainRpc);
  const signer = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);

  const jsonString = JSON.stringify(data);
  const dataBuffer = Buffer.from(jsonString, 'utf-8');
  const memData = new MemData(dataBuffer);
  const indexer = new Indexer(indexerRpc);

  return withRetry(async () => {
    const [uploadResponse, error] = await indexer.upload(memData, blockchainRpc, signer as unknown as IndexerUploadSigner);

    if (error) {
      throw new StorageError(`0G upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rootHash = rootHashFromUploadResponse(uploadResponse);

    if (!rootHash) {
      throw new StorageError('0G upload did not return a root hash');
    }

    return rootHash;
  });
}

function rootHashFromUploadResponse(uploadResponse: UploadResponse): string {
  if (typeof uploadResponse === 'string') {
    return uploadResponse;
  }

  if ('rootHashes' in uploadResponse) {
    return uploadResponse.rootHashes[0] ?? '';
  }

  return uploadResponse.rootHash;
}

/**
 * Download data from 0G storage.
 * @param rootHash - Root hash of the data to retrieve
 * @param options  - Optional overrides (e.g. `indexerRpc` for a custom indexer)
 * @returns Downloaded object
 */
export async function downloadFromZeroG(
  rootHash: string,
  options: Pick<ZeroGStorageOptions, 'indexerRpc'> = {}
): Promise<object> {
  const indexerRpc = options.indexerRpc ?? DEFAULT_IND_RPC;
  const indexer = new Indexer(indexerRpc);
  const tempDir = await mkdtemp(join(tmpdir(), 'zero-agent-'));
  const filePath = join(tempDir, 'download.json');

  try {
    const result = await withRetry(async () => {
      const error = await indexer.download(rootHash, filePath, false);
      if (error) {
        throw new StorageError(`0G download failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const jsonString = await readFile(filePath, 'utf-8');
      const data: unknown = JSON.parse(jsonString);

      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new StorageError('Downloaded 0G data is not a JSON object');
      }

      return data;
    });

    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export default {
  uploadToZeroG,
  downloadFromZeroG
};
