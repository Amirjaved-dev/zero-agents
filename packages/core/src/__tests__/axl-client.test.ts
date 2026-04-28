import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXLClient, type AgentMessage } from '../communication/axl-client.js';

const originalFetch = globalThis.fetch;

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

test('AXLClient reads peer ID from /info', async () => {
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'http://localhost:9101/info');
    return jsonResponse({ peerId: 'peer-from-info' });
  };

  try {
    const client = new AXLClient({ axlPort: 9101 });
    assert.equal(await client.getPeerId(), 'peer-from-info');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AXLClient falls back from /info to /topology for peer ID', async () => {
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    paths.push(url.pathname);

    if (url.pathname === '/info') {
      return new Response('', { status: 404 });
    }

    return jsonResponse({ our_public_key: 'peer-from-topology' });
  };

  try {
    const client = new AXLClient({ axlPort: 9102 });
    assert.equal(await client.getPeerId(), 'peer-from-topology');
    assert.deepEqual(paths, ['/info', '/topology']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AXLClient resolves task results from /messages inbox', async () => {
  const requestIds: string[] = [];
  let sentRequestId = '';

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));

    if (url.pathname === '/send') {
      const message = JSON.parse(String(init?.body)) as AgentMessage;
      sentRequestId = message.requestId;
      requestIds.push(message.requestId);
      return new Response('', { status: 200 });
    }

    if (url.pathname === '/messages') {
      if (!sentRequestId) {
        return jsonResponse({ messages: [] });
      }

      return jsonResponse({
        messages: [
          {
            fromPeerId: 'peer-b',
            message: {
              type: 'task_result',
              requestId: sentRequestId,
              payload: {
                output: { ok: true },
                toolUsed: 'remote_tool',
                wasGenerated: false,
                executionTimeMs: 12
              },
              timestamp: Date.now()
            }
          }
        ]
      });
    }

    return new Response('', { status: 404 });
  };

  const client = new AXLClient({ axlPort: 9103, pollIntervalMs: 10, taskTimeoutMs: 1_000 });
  try {
    const result = await client.sendTask('peer-b', { description: 'remote task' });
    assert.deepEqual(result.output, { ok: true });
    assert.equal(result.toolUsed, 'remote_tool');
    assert.equal(requestIds.length, 1);
  } finally {
    client.stop();
    globalThis.fetch = originalFetch;
  }
});
