import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ReflectionResult } from '../reflection/reflection-engine.js';
import { uploadToZeroG, type ZeroGStorageOptions } from '../storage/zero-g.js';

const DEFAULT_EXPERIENCE_FILE = '.zero-agent-experiences.json';
const DEFAULT_SIMILAR_LIMIT = 5;

export interface ExperienceRecord {
  id: string;
  agentName: string;
  task: string;
  strategy: string;
  toolUsed?: string;
  resultSummary?: string;
  success: boolean;
  qualityScore: number;
  reflection?: ReflectionResult;
  createdAt: number;
  storageHash?: string;
  metadata?: Record<string, unknown>;
}

export interface ExperienceMemoryOptions {
  filePath?: string;
  zeroG?: ZeroGStorageOptions;
  persistToZeroG?: boolean;
}

export type ExperienceInput = Omit<ExperienceRecord, 'id' | 'createdAt' | 'storageHash'> &
  Partial<Pick<ExperienceRecord, 'id' | 'createdAt' | 'storageHash'>>;

interface ExperienceFile {
  experiences: ExperienceRecord[];
}

export class ExperienceMemory {
  private readonly filePath: string;
  private readonly zeroG?: ZeroGStorageOptions;
  private readonly persistToZeroG: boolean;

  constructor(options: ExperienceMemoryOptions = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), DEFAULT_EXPERIENCE_FILE);
    this.zeroG = options.zeroG;
    this.persistToZeroG = options.persistToZeroG ?? false;
  }

  async saveExperience(experience: ExperienceInput): Promise<ExperienceRecord> {
    const experiences = await this.readExperiences();
    const record: ExperienceRecord = {
      ...experience,
      id: experience.id ?? this.createId(experience.agentName, experience.task),
      qualityScore: this.clampQualityScore(experience.qualityScore),
      createdAt: experience.createdAt ?? Date.now()
    };

    if (this.persistToZeroG) {
      record.storageHash = experience.storageHash ?? await this.tryUploadExperience(record);
    }

    experiences.push(record);
    await this.writeExperiences(experiences);

    return record;
  }

  async listExperiences(agentName?: string): Promise<ExperienceRecord[]> {
    const experiences = await this.readExperiences();

    if (!agentName) {
      return experiences;
    }

    return experiences.filter((experience) => experience.agentName === agentName);
  }

  async findSimilarExperiences(task: string, limit = DEFAULT_SIMILAR_LIMIT): Promise<ExperienceRecord[]> {
    const normalizedTask = task.trim().toLowerCase();
    if (!normalizedTask) {
      return [];
    }

    const experiences = await this.readExperiences();
    return experiences
      .map((experience) => ({ experience, score: this.scoreTaskSimilarity(normalizedTask, experience.task) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || b.experience.createdAt - a.experience.createdAt)
      .slice(0, Math.max(0, limit))
      .map((result) => result.experience);
  }

  async clearExperiences(): Promise<void> {
    await this.writeExperiences([]);
  }

  private async readExperiences(): Promise<ExperienceRecord[]> {
    try {
      const file = await readFile(this.filePath, 'utf-8');
      const data: unknown = JSON.parse(file);

      if (!this.isExperienceFile(data)) {
        throw new Error(`Invalid experience memory file: ${this.filePath}`);
      }

      return data.experiences;
    } catch (error) {
      if (this.isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  private async writeExperiences(experiences: ExperienceRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const file: ExperienceFile = { experiences };
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  }

  private async tryUploadExperience(record: ExperienceRecord): Promise<string | undefined> {
    try {
      const uploadRecord: ExperienceRecord = { ...record };
      delete uploadRecord.storageHash;
      return await uploadToZeroG(uploadRecord, this.zeroG);
    } catch {
      return undefined;
    }
  }

  private scoreTaskSimilarity(normalizedTask: string, candidateTask: string): number {
    const candidate = candidateTask.toLowerCase();

    if (candidate.includes(normalizedTask)) {
      return 1;
    }

    const queryTerms = new Set(normalizedTask.match(/[a-z0-9]+/g) ?? []);
    if (queryTerms.size === 0) {
      return 0;
    }

    let matchedTerms = 0;
    for (const term of queryTerms) {
      if (candidate.includes(term)) {
        matchedTerms += 1;
      }
    }

    return matchedTerms / queryTerms.size;
  }

  private createId(agentName: string, task: string): string {
    const safeAgentName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    const taskHash = this.hashString(task).toString(36);
    return `${safeAgentName}-${Date.now().toString(36)}-${taskHash}`;
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  private clampQualityScore(score: number): number {
    return Math.max(0, Math.min(100, score));
  }

  private isExperienceFile(value: unknown): value is ExperienceFile {
    return this.isRecord(value) && Array.isArray(value.experiences) && value.experiences.every((item) => this.isExperienceRecord(item));
  }

  private isExperienceRecord(value: unknown): value is ExperienceRecord {
    return (
      this.isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.agentName === 'string' &&
      typeof value.task === 'string' &&
      typeof value.strategy === 'string' &&
      typeof value.success === 'boolean' &&
      typeof value.qualityScore === 'number' &&
      typeof value.createdAt === 'number'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error;
  }
}
