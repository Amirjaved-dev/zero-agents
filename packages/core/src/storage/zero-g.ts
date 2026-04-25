/**
 * 0G Storage Integration
 * Handles upload and download of agent state from 0G distributed storage
 */

import { ZgFile, Indexer, MemData } from '@0glabs/0g-ts-sdk';
import { Wallet } from 'ethers';

const EVM_RPC = 'https://evmrpc-testnet.0g.ai';
const IND_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

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
  const signer = new Wallet(privateKey);

  // Serialize data to JSON and convert to Buffer
  const jsonString = JSON.stringify(data);
  const dataBuffer = Buffer.from(jsonString, 'utf-8');

  // Create MemData from buffer
  const memData = new MemData(dataBuffer);

  // Create ZgFile with the data
  const zgFile = new ZgFile([memData]);

  // Upload to 0G via Indexer
  const indexer = new Indexer(IND_RPC);
  const rootHash = await indexer.upload(zgFile, signer);

  return rootHash;
}

/**
 * Download data from 0G storage
 * @param rootHash - Root hash of the data to retrieve
 * @returns Downloaded object
 */
export async function downloadFromZeroG(rootHash: string): Promise<object> {
  // Query the indexer to retrieve the data
  const indexer = new Indexer(IND_RPC);
  const zgFile = await indexer.download(rootHash);

  // Extract the data from ZgFile
  const dataBuffer = zgFile.getSegment(0);

  // Parse JSON from buffer
  const jsonString = dataBuffer.toString('utf-8');
  const data = JSON.parse(jsonString);

  return data;
}

export default {
  uploadToZeroG,
  downloadFromZeroG
};
