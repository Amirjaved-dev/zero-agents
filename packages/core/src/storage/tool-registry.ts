import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadFromZeroG, uploadToZeroG } from './zero-g.js';

export interface Tool {
  id: string;
  name: string;
  description: string;
  code: string;
  schema: {
    input: object;
    output: object;
  };
  tags: string[];
  successRate: number;
  usageCount: number;
  createdAt: number;
  rootHash?: string;
}

export interface ToolHistory {
  current: string | null;
  previous: string | null;
}

/**
 * Compact metadata snapshot stored inside the index file alongside rootHash.
 * Enables searchTools() to filter entirely from the cached index without
 * downloading any tool blobs from 0G.
 */
interface ToolIndexEntry {
  rootHash: string;
  name: string;
  description: string;
  tags: string[];
  successRate: number;
}

interface ToolIndexMeta {
  updatedAt: number;
  count: number;
}

interface IndexPointerFile {
  rootHash: string;
}

export interface ToolRegistryOptions {
  indexPointerPath?: string;
  zeroGPrivateKey?: string;
  /** How long (ms) to cache the downloaded index before re-fetching. Default 60 000. */
  indexCacheTtlMs?: number;
  /** Override the 0G EVM RPC endpoint. Defaults to the public 0G testnet. */
  zeroGBlockchainRpc?: string;
  /** Override the 0G Storage indexer endpoint. Defaults to the public 0G testnet indexer. */
  zeroGIndexerRpc?: string;
}

const INDEX_POINTER_FILE = '.zero-agent-index.json';
const DEFAULT_INDEX_CACHE_TTL_MS = 60_000;

export class ToolRegistry {
  private readonly indexPointerPath: string;
  private readonly zeroGPrivateKey?: string;
  private readonly indexCacheTtlMs: number;
  private readonly zeroGBlockchainRpc?: string;
  private readonly zeroGIndexerRpc?: string;

  // In-memory cache for downloaded tool blobs (permanent until write invalidates it)
  private readonly toolCache = new Map<string, Tool>();

  // Metadata-enriched index cache — stores ToolIndexEntry per tool name so
  // searchTools() never needs to download individual blobs.
  private cachedMetaIndex: Map<string, ToolIndexEntry> | null = null;
  // One-level history (name → previousRootHash)
  private cachedHistory: Map<string, string> | null = null;
  private indexCacheExpiresAt = 0;

  constructor(options: string | ToolRegistryOptions = {}) {
    if (typeof options === 'string') {
      this.indexPointerPath = options;
      this.zeroGPrivateKey = undefined;
      this.indexCacheTtlMs = DEFAULT_INDEX_CACHE_TTL_MS;
      return;
    }

    this.indexPointerPath = options.indexPointerPath ?? join(process.cwd(), INDEX_POINTER_FILE);
    this.zeroGPrivateKey = options.zeroGPrivateKey;
    this.indexCacheTtlMs = options.indexCacheTtlMs ?? DEFAULT_INDEX_CACHE_TTL_MS;
    this.zeroGBlockchainRpc = options.zeroGBlockchainRpc;
    this.zeroGIndexerRpc = options.zeroGIndexerRpc;
  }

  async saveTool(tool: Tool): Promise<string> {
    const toolToUpload: Tool = { ...tool };
    delete toolToUpload.rootHash;

    const rootHash = await uploadToZeroG(toolToUpload, {
      privateKey: this.zeroGPrivateKey,
      blockchainRpc: this.zeroGBlockchainRpc,
      indexerRpc: this.zeroGIndexerRpc
    });
    tool.rootHash = rootHash;
    this.toolCache.set(rootHash, { ...tool });
    await this.updateIndex(tool);

    return rootHash;
  }

  async getTool(rootHash: string): Promise<Tool> {
    const cached = this.toolCache.get(rootHash);
    if (cached) return cached;

    const data = await downloadFromZeroG(rootHash, { indexerRpc: this.zeroGIndexerRpc });
    const tool = this.parseTool(data);
    const result = { ...tool, rootHash };

    this.toolCache.set(rootHash, result);
    return result;
  }

  async getToolByName(name: string): Promise<Tool | null> {
    await this.loadIndexData();
    const entry = this.cachedMetaIndex?.get(name);
    if (!entry) return null;
    return this.getTool(entry.rootHash);
  }

  async getIndexRootHash(): Promise<string | null> {
    return this.readIndexPointer();
  }

  /**
   * Returns the current and previous root hash for a tool.
   * Previous hash is preserved in the index's _history section on each update.
   */
  async getToolHistory(name: string): Promise<ToolHistory> {
    await this.loadIndexData();
    return {
      current: this.cachedMetaIndex?.get(name)?.rootHash ?? null,
      previous: this.cachedHistory?.get(name) ?? null
    };
  }

  /**
   * Search tools by name, description, and tags.
   * Uses the in-memory metadata index — zero 0G downloads.
   */
  async searchTools(query: string): Promise<Tool[]> {
    const normalizedQuery = query.trim().toLowerCase();
    await this.loadIndexData();

    if (!normalizedQuery || !this.cachedMetaIndex || this.cachedMetaIndex.size === 0) {
      return [];
    }

    // Score and filter using only the cached metadata — no 0G calls
    const scored = Array.from(this.cachedMetaIndex.values())
      .map((entry) => ({ entry, score: this.scoreEntryMatch(entry, normalizedQuery) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.successRate - a.entry.successRate);

    // Download only the tools that matched (typically 1-3)
    return Promise.all(scored.map(({ entry }) => this.getTool(entry.rootHash)));
  }

  async exportTools(): Promise<Tool[]> {
    await this.loadIndexData();
    if (!this.cachedMetaIndex) return [];
    return Promise.all(
      Array.from(this.cachedMetaIndex.values(), (entry) => this.getTool(entry.rootHash))
    );
  }

  async importTool(tool: Tool): Promise<string> {
    if (tool.rootHash) {
      await this.updateIndex(tool);
      return tool.rootHash;
    }

    return this.saveTool(tool);
  }

  async updateIndex(tool: Tool): Promise<string> {
    if (!tool.rootHash) {
      throw new Error('Cannot update tool index without a rootHash');
    }

    await this.loadIndexData();

    const metaIndex = this.cachedMetaIndex ?? new Map<string, ToolIndexEntry>();
    const history = this.cachedHistory ?? new Map<string, string>();

    // Preserve previous rootHash before overwriting
    const existing = metaIndex.get(tool.name);
    if (existing && existing.rootHash !== tool.rootHash) {
      history.set(tool.name, existing.rootHash);
    }

    metaIndex.set(tool.name, {
      rootHash: tool.rootHash,
      name: tool.name,
      description: tool.description,
      tags: tool.tags,
      successRate: tool.successRate
    });

    const indexFile = this.createIndexFile(metaIndex, history);
    const indexRootHash = await uploadToZeroG(indexFile, {
      privateKey: this.zeroGPrivateKey,
      blockchainRpc: this.zeroGBlockchainRpc,
      indexerRpc: this.zeroGIndexerRpc
    });

    await this.writeIndexPointer(indexRootHash);
    this.invalidateIndexCache();

    return indexRootHash;
  }

  /** Returns a map of tool name → rootHash (for callers that only need the hash). */
  async loadIndex(): Promise<Map<string, string>> {
    await this.loadIndexData();
    const result = new Map<string, string>();
    for (const [name, entry] of (this.cachedMetaIndex ?? new Map())) {
      result.set(name, entry.rootHash);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadIndexData(): Promise<void> {
    if (this.cachedMetaIndex !== null && Date.now() < this.indexCacheExpiresAt) {
      return;
    }

    const indexRootHash = await this.readIndexPointer();

    if (!indexRootHash) {
      this.cachedMetaIndex = new Map();
      this.cachedHistory = new Map();
      this.indexCacheExpiresAt = Date.now() + this.indexCacheTtlMs;
      return;
    }

    const data = await downloadFromZeroG(indexRootHash, { indexerRpc: this.zeroGIndexerRpc });
    const metaIndex = new Map<string, ToolIndexEntry>();
    const history = new Map<string, string>();

    for (const [key, value] of Object.entries(data)) {
      if (key === '_meta') continue;

      if (key === '_history') {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          for (const [toolName, prevHash] of Object.entries(value as Record<string, unknown>)) {
            if (typeof prevHash === 'string') {
              history.set(toolName, prevHash);
            }
          }
        }
        continue;
      }

      // New format: value is a ToolIndexEntry object
      if (this.isToolIndexEntry(value)) {
        metaIndex.set(key, value);
        continue;
      }

      // Legacy format: value is a plain rootHash string
      if (typeof value === 'string') {
        metaIndex.set(key, {
          rootHash: value,
          name: key,
          description: '',
          tags: [],
          successRate: 0
        });
        continue;
      }

      throw new Error(`Invalid index entry for tool "${key}"`);
    }

    this.cachedMetaIndex = metaIndex;
    this.cachedHistory = history;
    this.indexCacheExpiresAt = Date.now() + this.indexCacheTtlMs;
  }

  private invalidateIndexCache(): void {
    this.cachedMetaIndex = null;
    this.cachedHistory = null;
    this.indexCacheExpiresAt = 0;
  }

  private createIndexFile(
    metaIndex: Map<string, ToolIndexEntry>,
    history: Map<string, string>
  ): Record<string, unknown> {
    const indexFile: Record<string, unknown> = Object.fromEntries(metaIndex);

    if (history.size > 0) {
      indexFile._history = Object.fromEntries(history);
    }

    const meta: ToolIndexMeta = {
      updatedAt: Date.now(),
      count: metaIndex.size
    };
    indexFile._meta = meta;

    return indexFile;
  }

  private scoreEntryMatch(entry: ToolIndexEntry, normalizedQuery: string): number {
    const searchableText = [entry.name, entry.description, ...entry.tags]
      .join(' ')
      .toLowerCase();

    if (searchableText.includes(normalizedQuery)) {
      return 1;
    }

    const queryTerms = new Set(normalizedQuery.match(/[a-z0-9]+/g) ?? []);
    if (queryTerms.size === 0) return 0;

    let matchedTerms = 0;
    for (const term of queryTerms) {
      if (searchableText.includes(term)) {
        matchedTerms += 1;
      }
    }

    return matchedTerms / queryTerms.size;
  }

  private async readIndexPointer(): Promise<string | null> {
    try {
      const pointerJson = await readFile(this.indexPointerPath, 'utf-8');
      const pointer: unknown = JSON.parse(pointerJson);

      if (!this.isRecord(pointer) || typeof pointer.rootHash !== 'string') {
        throw new Error(`Invalid index pointer file: ${this.indexPointerPath}`);
      }

      return pointer.rootHash;
    } catch (error) {
      if (this.isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  private async writeIndexPointer(rootHash: string): Promise<void> {
    const pointer: IndexPointerFile = { rootHash };
    await writeFile(this.indexPointerPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf-8');
  }

  private parseTool(data: object): Tool {
    if (!this.isRecord(data)) {
      throw new Error('Downloaded tool is not a JSON object');
    }

    if (
      typeof data.id !== 'string' ||
      typeof data.name !== 'string' ||
      typeof data.description !== 'string' ||
      typeof data.code !== 'string' ||
      !this.isRecord(data.schema) ||
      !this.isRecord(data.schema.input) ||
      !this.isRecord(data.schema.output) ||
      !Array.isArray(data.tags) ||
      !data.tags.every((tag) => typeof tag === 'string') ||
      typeof data.successRate !== 'number' ||
      typeof data.usageCount !== 'number' ||
      typeof data.createdAt !== 'number'
    ) {
      throw new Error('Downloaded tool does not match the Tool schema');
    }

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      code: data.code,
      schema: {
        input: data.schema.input,
        output: data.schema.output
      },
      tags: data.tags,
      successRate: data.successRate,
      usageCount: data.usageCount,
      createdAt: data.createdAt,
      rootHash: typeof data.rootHash === 'string' ? data.rootHash : undefined
    };
  }

  private isToolIndexEntry(value: unknown): value is ToolIndexEntry {
    return (
      this.isRecord(value) &&
      typeof value.rootHash === 'string' &&
      typeof value.name === 'string' &&
      typeof value.description === 'string' &&
      Array.isArray(value.tags) &&
      value.tags.every((t) => typeof t === 'string') &&
      typeof value.successRate === 'number'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
  }
}
