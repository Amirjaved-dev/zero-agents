/**
 * Test script for 0G storage functionality
 * Tests uploading and downloading data to/from 0G storage
 */

import { uploadToZeroG, downloadFromZeroG } from '@zero-agents/core/dist/storage/zero-g.js';

async function main() {
  try {
    console.log('🚀 Starting 0G storage test...\n');

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
