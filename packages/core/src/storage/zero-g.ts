/**
 * 0G Storage Integration
 * Handles upload and download of agent state from 0G distributed storage
 */

import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BLOCKCHAIN_RPC = 'https://evmrpc-testnet.0g.ai';
const IND_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

type IndexerUploadSigner = Parameters<Indexer['upload']>[2];
type UploadResponse = string | { rootHash: string; txHash?: string } | { rootHashes: string[]; txHashes?: string[] };

/**
 * Upload data to 0G storage
 * @param data - Object to store
 * @returns Root hash of the uploaded data
 */
export async function uploadToZeroG(data: object): Promise<string> {
  const privateKey = process.env.ZERO_G_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('ZERO_G_PRIVATE_KEY environment variable not set');
  }

  // Create signer from private key
  const provider = new JsonRpcProvider(BLOCKCHAIN_RPC);
  const signer = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`, provider);

  // Serialize data to JSON and convert to Buffer
  const jsonString = JSON.stringify(data);
  const dataBuffer = Buffer.from(jsonString, 'utf-8');

  // Create in-memory file from buffer
  const memData = new MemData(dataBuffer);

  // Upload to 0G via Indexer
  const indexer = new Indexer(IND_RPC);
  const [uploadResponse, error] = await indexer.upload(memData, BLOCKCHAIN_RPC, signer as unknown as IndexerUploadSigner);

  if (error) {
    throw error;
  }

  const rootHash = rootHashFromUploadResponse(uploadResponse);

  if (!rootHash) {
    throw new Error('0G upload did not return a root hash');
  }

  return rootHash;
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
 * Download data from 0G storage
 * @param rootHash - Root hash of the data to retrieve
 * @returns Downloaded object
 */
export async function downloadFromZeroG(rootHash: string): Promise<object> {
  const indexer = new Indexer(IND_RPC);
  const tempDir = await mkdtemp(join(tmpdir(), 'zero-agent-'));
  const filePath = join(tempDir, 'download.json');

  try {
    const error = await indexer.download(rootHash, filePath, false);
    if (error) {
      throw error;
    }

    const jsonString = await readFile(filePath, 'utf-8');
    const data: unknown = JSON.parse(jsonString);

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Downloaded 0G data is not a JSON object');
    }

    return data;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export default {
  uploadToZeroG,
  downloadFromZeroG
};
