/**
 * Test script for 0G storage functionality
 * Tests uploading and downloading data to/from 0G storage
 */

import { existsSync, readFileSync } from 'node:fs';
import { uploadToZeroG, downloadFromZeroG } from '../packages/core/dist/storage/zero-g.js';

function loadEnvFile(filePath = '.env'): void {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]+?)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
}

async function main() {
  try {
    loadEnvFile();

    console.log('🚀 Starting 0G storage test...\n');

    if (!process.env.ZERO_G_PRIVATE_KEY) {
      console.log('⏭️  Skipping 0G storage test: ZERO_G_PRIVATE_KEY environment variable not set');
      console.log('Set ZERO_G_PRIVATE_KEY to run the live upload/download integration test.');
      return;
    }

    // Prepare test data
    const testData = {
      hello: 'world',
      timestamp: Date.now()
    };

    console.log('📤 Uploading data to 0G storage...');
    console.log('Data:', testData);

    // Upload to 0G
    const rootHash = await uploadToZeroG(testData);
    console.log('✅ Upload successful!');
    console.log('📦 Root Hash:', rootHash);
    console.log();

    // Download from 0G
    console.log('📥 Downloading data from 0G storage...');
    const downloadedData = await downloadFromZeroG(rootHash);
    console.log('✅ Download successful!');
    console.log('📦 Retrieved Data:', downloadedData);
    console.log();

    // Verify data integrity
    const isValid = JSON.stringify(testData) === JSON.stringify(downloadedData);
    console.log(`🔍 Data Integrity Check: ${isValid ? '✅ PASSED' : '❌ FAILED'}`);

  } catch (error) {
    console.error('❌ Error during storage test:');
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    } else {
      console.error('Unknown error:', error);
    }
    process.exit(1);
  }
}

main();
