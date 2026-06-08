import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ChromaClient, IncludeEnum } from 'chromadb';

export interface JobEmbeddingInput {
  jobId: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SimilarityResult {
  jobId: string;
  distance: number;
  /** Cosine similarity score (0-1), derived from distance */
  similarity: number;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private client: ChromaClient;
  private readonly ollamaUrl: string;
  private readonly chromaDbUrl: string;
  private readonly embeddingModel = 'nomic-embed-text';

  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 5000;
  private static readonly BATCH_SIZE = 50;

  constructor(private readonly configService: ConfigService) {
    this.ollamaUrl =
      this.configService.get<string>('OLLAMA_URL') || 'http://localhost:11434';
    this.chromaDbUrl =
      this.configService.get<string>('CHROMADB_URL') || 'http://localhost:8000';
  }

  async onModuleInit() {
    const parsed = new URL(this.chromaDbUrl);
    this.client = new ChromaClient({
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 8000),
      ssl: parsed.protocol === 'https:',
    });
    this.logger.log(
      `EmbeddingService initialized — Ollama: ${this.ollamaUrl}, ChromaDB: ${this.chromaDbUrl}`,
    );
  }

  /**
   * Generate a vector embedding for the given text using Ollama.
   * Retries up to 3 times with 5s delay between attempts.
   * Returns null if all retries fail (signals degraded mode).
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    for (let attempt = 1; attempt <= EmbeddingService.MAX_RETRIES; attempt++) {
      const startTime = Date.now();
      try {
        const response = await axios.post(
          `${this.ollamaUrl}/api/embeddings`,
          { model: this.embeddingModel, prompt: text },
          { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 },
        );

        const elapsed = Date.now() - startTime;
        const embedding = response.data?.embedding;
        if (Array.isArray(embedding) && embedding.length > 0) {
          this.logger.log(
            `[Ollama] embedding — success — elapsed: ${elapsed}ms, status: ${response.status}`,
          );
          return embedding;
        }

        this.logger.warn(
          `[Attempt ${attempt}/${EmbeddingService.MAX_RETRIES}] Ollama returned empty embedding — elapsed: ${elapsed}ms`,
        );
      } catch (err: any) {
        const elapsed = Date.now() - startTime;
        const status = err?.response?.status;
        this.logger.error(
          `[Ollama] embedding — failed — elapsed: ${elapsed}ms` +
          `${status ? `, status: ${status}` : ''}, error: ${err.message}`,
          err.stack,
        );
      }

      if (attempt < EmbeddingService.MAX_RETRIES) {
        await this.delay(EmbeddingService.RETRY_DELAY_MS);
      }
    }

    this.logger.error(
      `Ollama embedding failed after ${EmbeddingService.MAX_RETRIES} attempts — falling back to degraded mode`,
    );
    return null;
  }

  /**
   * Store (or update) a user's profile embedding in the ChromaDB `profiles` collection.
   * Returns true if successful, false if embedding generation or storage failed.
   */
  async upsertProfileEmbedding(
    userId: string,
    text: string,
    metadata?: Record<string, string | number | boolean>,
  ): Promise<boolean> {
    const embedding = await this.generateEmbedding(text);
    if (!embedding) {
      return false;
    }

    const startTime = Date.now();
    try {
      const collection = await this.getOrCreateCollection('profiles');

      await collection.upsert({
        ids: [userId],
        embeddings: [embedding],
        metadatas: [{ userId, ...metadata }],
        documents: [text],
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[ChromaDB] upsertProfileEmbedding — success — elapsed: ${elapsed}ms, userId: ${userId}`,
      );
      return true;
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `[ChromaDB] upsertProfileEmbedding — failed — elapsed: ${elapsed}ms, userId: ${userId}, error: ${err.message}`,
        err.stack,
      );
      return false;
    }
  }

  /**
   * Batch store job embeddings in the ChromaDB `jobs` collection.
   * Splits into batches of 50 to avoid overwhelming Ollama.
   */
  async upsertJobEmbeddings(
    jobs: JobEmbeddingInput[],
  ): Promise<{ embedded: number; failed: number }> {
    let embedded = 0;
    let failed = 0;

    const batches = this.splitIntoBatches(jobs, EmbeddingService.BATCH_SIZE);

    for (const batch of batches) {
      const ids: string[] = [];
      const embeddings: number[][] = [];
      const metadatas: Record<string, any>[] = [];
      const documents: string[] = [];

      for (const job of batch) {
        const embedding = await this.generateEmbedding(job.text);
        if (embedding) {
          ids.push(job.jobId);
          embeddings.push(embedding);
          metadatas.push({ jobId: job.jobId, ...job.metadata });
          documents.push(job.text);
          embedded++;
        } else {
          failed++;
        }
      }

      if (ids.length > 0) {
        const chromaStartTime = Date.now();
        try {
          const collection = await this.getOrCreateCollection('jobs');
          await collection.upsert({ ids, embeddings, metadatas, documents });
          const chromaElapsed = Date.now() - chromaStartTime;
          this.logger.log(
            `[ChromaDB] upsertJobEmbeddings — success — elapsed: ${chromaElapsed}ms, batch: ${ids.length} items`,
          );
        } catch (err: any) {
          const chromaElapsed = Date.now() - chromaStartTime;
          this.logger.error(
            `[ChromaDB] upsertJobEmbeddings — failed — elapsed: ${chromaElapsed}ms, error: ${err.message}`,
            err.stack,
          );
          // Count the successfully embedded ones in this batch as failed
          failed += ids.length;
          embedded -= ids.length;
        }
      }
    }

    this.logger.log(
      `Job embeddings complete — embedded: ${embedded}, failed: ${failed}`,
    );
    return { embedded, failed };
  }

  /**
   * Query cosine similarity between a user's profile embedding and specific jobs.
   * Returns similarity scores for the requested job IDs.
   *
   * ChromaDB cosine distance: 0 = identical, 2 = opposite.
   * Similarity = 1 - (distance / 2), giving a 0-1 range.
   */
  async querySimilarity(
    userId: string,
    jobIds: string[],
  ): Promise<SimilarityResult[] | null> {
    const startTime = Date.now();
    try {
      // Get the user's profile embedding from the profiles collection
      const profilesCollection = await this.getOrCreateCollection('profiles');
      const profileResult = await profilesCollection.get({
        ids: [userId],
        include: [IncludeEnum.embeddings],
      });

      const profileEmbedding = profileResult?.embeddings?.[0];
      if (!profileEmbedding || profileEmbedding.length === 0) {
        this.logger.warn(`No profile embedding found for user ${userId}`);
        return null;
      }

      // Query the jobs collection using the profile embedding
      const jobsCollection = await this.getOrCreateCollection('jobs');
      const queryResult = await jobsCollection.query({
        queryEmbeddings: [profileEmbedding],
        nResults: Math.max(jobIds.length, 10),
        include: [IncludeEnum.distances],
      });

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[ChromaDB] querySimilarity — success — elapsed: ${elapsed}ms, userId: ${userId}, jobIds: ${jobIds.length}`,
      );

      if (!queryResult?.ids?.[0] || !queryResult?.distances?.[0]) {
        return null;
      }

      // Map results to only include requested job IDs
      const results: SimilarityResult[] = [];
      const returnedIds = queryResult.ids[0];
      const returnedDistances = queryResult.distances[0];
      const jobIdSet = new Set(jobIds);

      for (let i = 0; i < returnedIds.length; i++) {
        if (jobIdSet.has(returnedIds[i])) {
          const distance = returnedDistances[i] ?? 1;
          // ChromaDB cosine distance range: [0, 2]
          // Convert to similarity: 1 - (distance / 2) → [0, 1]
          const similarity = Math.max(0, Math.min(1, 1 - distance / 2));
          results.push({
            jobId: returnedIds[i],
            distance,
            similarity,
          });
        }
      }

      return results;
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `[ChromaDB] querySimilarity — failed — elapsed: ${elapsed}ms, userId: ${userId}, error: ${err.message}`,
        err.stack,
      );
      return null;
    }
  }

  /**
   * Delete a user's profile embedding from ChromaDB.
   * Called before re-embedding (e.g., on profile update).
   */
  async deleteProfileEmbedding(userId: string): Promise<boolean> {
    const startTime = Date.now();
    try {
      const collection = await this.getOrCreateCollection('profiles');
      await collection.delete({ ids: [userId] });
      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[ChromaDB] deleteProfileEmbedding — success — elapsed: ${elapsed}ms, userId: ${userId}`,
      );
      return true;
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `[ChromaDB] deleteProfileEmbedding — failed — elapsed: ${elapsed}ms, userId: ${userId}, error: ${err.message}`,
        err.stack,
      );
      return false;
    }
  }

  /**
   * Split an array into batches of a given size.
   */
  splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getOrCreateCollection(name: string) {
    return this.client.getOrCreateCollection({
      name,
      embeddingFunction: null,
      metadata: { 'hnsw:space': 'cosine' },
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
