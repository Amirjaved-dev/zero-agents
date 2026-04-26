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
}

const INDEX_POINTER_FILE = '.zero-agent-index.json';
const DEFAULT_INDEX_CACHE_TTL_MS = 60_000;

export class ToolRegistry {
  private readonly indexPointerPath: string;
  private readonly zeroGPrivateKey?: string;
  private readonly indexCacheTtlMs: number;

  // In-memory cache for downloaded tools (permanent until a write invalidates it)
  private readonly toolCache = new Map<string, Tool>();

  // In-memory cache for the index (name → currentRootHash)
  private cachedIndex: Map<string, string> | null = null;
  // One-level history stored alongside the index (name → previousRootHash)
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
  }

  async saveTool(tool: Tool): Promise<string> {
    const toolToUpload: Tool = { ...tool };
    delete toolToUpload.rootHash;

    const rootHash = await uploadToZeroG(toolToUpload, { privateKey: this.zeroGPrivateKey });
    tool.rootHash = rootHash;
    this.toolCache.set(rootHash, { ...tool });
    await this.updateIndex(tool);

    return rootHash;
  }

  async getTool(rootHash: string): Promise<Tool> {
    const cached = this.toolCache.get(rootHash);
    if (cached) return cached;

    const data = await downloadFromZeroG(rootHash);
    const tool = this.parseTool(data);
    const result = { ...tool, rootHash };

    this.toolCache.set(rootHash, result);
    return result;
  }

  async getToolByName(name: string): Promise<Tool | null> {
    const index = await this.loadIndex();
    const rootHash = index.get(name);

    if (!rootHash) {
      return null;
    }

    return this.getTool(rootHash);
  }

  async getIndexRootHash(): Promise<string | null> {
    return this.readIndexPointer();
  }

  /**
   * Returns the current and previous root hash for a tool.
   * Previous hash is stored in the index's _history section on each update.
   */
  async getToolHistory(name: string): Promise<ToolHistory> {
    await this.loadIndexData();
    return {
      current: this.cachedIndex?.get(name) ?? null,
      previous: this.cachedHistory?.get(name) ?? null
    };
  }

  async searchTools(query: string): Promise<Tool[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const index = await this.loadIndex();

    if (!normalizedQuery || index.size === 0) {
      return [];
    }

    const tools = await Promise.all(
      Array.from(index.values(), async (rootHash) => this.getTool(rootHash))
    );

    return tools
      .map((tool) => ({ tool, score: this.scoreToolMatch(tool, normalizedQuery) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.tool.successRate - a.tool.successRate)
      .map((result) => result.tool);
  }

  async exportTools(): Promise<Tool[]> {
    const index = await this.loadIndex();
    return Promise.all(Array.from(index.values(), async (rootHash) => this.getTool(rootHash)));
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

    // Load current state before overwriting so we can preserve history
    await this.loadIndexData();

    const index = this.cachedIndex ?? new Map<string, string>();
    const history = this.cachedHistory ?? new Map<string, string>();

    // Record current hash as previous before overwriting
    const existingHash = index.get(tool.name);
    if (existingHash && existingHash !== tool.rootHash) {
      history.set(tool.name, existingHash);
    }

    index.set(tool.name, tool.rootHash);

    const indexFile = this.createIndexFile(index, history);
    const indexRootHash = await uploadToZeroG(indexFile, { privateKey: this.zeroGPrivateKey });

    await this.writeIndexPointer(indexRootHash);

    // Invalidate cache — fresh data will be fetched on next read
    this.invalidateIndexCache();

    return indexRootHash;
  }

  async loadIndex(): Promise<Map<string, string>> {
    await this.loadIndexData();
    return this.cachedIndex ?? new Map();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Downloads and parses the index from 0G (or returns from in-memory cache).
   * Populates both cachedIndex and cachedHistory.
   */
  private async loadIndexData(): Promise<void> {
    if (this.cachedIndex !== null && Date.now() < this.indexCacheExpiresAt) {
      return; // Cache is fresh
    }

    const indexRootHash = await this.readIndexPointer();

    if (!indexRootHash) {
      this.cachedIndex = new Map();
      this.cachedHistory = new Map();
      this.indexCacheExpiresAt = Date.now() + this.indexCacheTtlMs;
      return;
    }

    const data = await downloadFromZeroG(indexRootHash);
    const index = new Map<string, string>();
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

      if (typeof value !== 'string') {
        throw new Error(`Invalid root hash for tool "${key}" in tool index`);
      }

      index.set(key, value);
    }

    this.cachedIndex = index;
    this.cachedHistory = history;
    this.indexCacheExpiresAt = Date.now() + this.indexCacheTtlMs;
  }

  private invalidateIndexCache(): void {
    this.cachedIndex = null;
    this.cachedHistory = null;
    this.indexCacheExpiresAt = 0;
  }

  private createIndexFile(index: Map<string, string>, history: Map<string, string>): Record<string, unknown> {
    const indexFile: Record<string, unknown> = Object.fromEntries(index);

    if (history.size > 0) {
      indexFile._history = Object.fromEntries(history);
    }

    const meta: ToolIndexMeta = {
      updatedAt: Date.now(),
      count: index.size
    };
    indexFile._meta = meta;

    return indexFile;
  }

  private scoreToolMatch(tool: Tool, normalizedQuery: string): number {
    const searchableText = [tool.name, tool.description, ...tool.tags]
      .join(' ')
      .toLowerCase();

    if (searchableText.includes(normalizedQuery)) {
      return 1;
    }

    const queryTerms = new Set(normalizedQuery.match(/[a-z0-9]+/g) ?? []);
    if (queryTerms.size === 0) {
      return 0;
    }

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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
  }
}
