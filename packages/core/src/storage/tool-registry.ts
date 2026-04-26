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
}

const INDEX_POINTER_FILE = '.zero-agent-index.json';

export class ToolRegistry {
  private readonly indexPointerPath: string;
  private readonly zeroGPrivateKey?: string;
  private readonly toolCache = new Map<string, Tool>();

  constructor(options: string | ToolRegistryOptions = {}) {
    if (typeof options === 'string') {
      this.indexPointerPath = options;
      this.zeroGPrivateKey = undefined;
      return;
    }

    this.indexPointerPath = options.indexPointerPath ?? join(process.cwd(), INDEX_POINTER_FILE);
    this.zeroGPrivateKey = options.zeroGPrivateKey;
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

    const index = await this.loadIndex();
    index.set(tool.name, tool.rootHash);

    const indexFile = this.createIndexFile(index);
    const indexRootHash = await uploadToZeroG(indexFile, { privateKey: this.zeroGPrivateKey });

    await this.writeIndexPointer(indexRootHash);
    return indexRootHash;
  }

  async loadIndex(): Promise<Map<string, string>> {
    const indexRootHash = await this.readIndexPointer();

    if (!indexRootHash) {
      return new Map();
    }

    const data = await downloadFromZeroG(indexRootHash);
    const index = new Map<string, string>();

    for (const [key, value] of Object.entries(data)) {
      if (key === '_meta') {
        continue;
      }

      if (typeof value !== 'string') {
        throw new Error(`Invalid root hash for tool "${key}" in tool index`);
      }

      index.set(key, value);
    }

    return index;
  }

  private createIndexFile(index: Map<string, string>): Record<string, unknown> {
    const indexFile: Record<string, unknown> = Object.fromEntries(index);
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
