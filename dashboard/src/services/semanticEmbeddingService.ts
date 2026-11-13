import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { env } from '../config/env.js';
import { Bulkhead } from '../shared/bulkhead.js';
import { CircuitBreaker } from '../shared/circuitBreaker.js';

const EMBEDDING_DIMENSIONS = 768;
const MAX_CACHE_ENTRIES = 500;
const MAX_BATCH_SIZE = 32;

const embeddingResponseSchema = z.object({
  embeddings: z.array(
    z.object({
      values: z.array(z.number().finite()).min(1),
    })
  ).min(1),
});

const documentEmbeddingCache = new Map<string, number[]>();

function normalizeVector(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Gemini retornou um embedding com ${vector.length} dimensões; eram esperadas ${EMBEDDING_DIMENSIONS}.`
    );
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('Gemini retornou um embedding vazio ou inválido.');
  }
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

export class SemanticEmbeddingService {
  public static readonly modelName = env.GEMINI_EMBEDDING_MODEL;
  public static readonly vectorDimensions = EMBEDDING_DIMENSIONS;
  public static readonly embeddingModelId = `${env.GEMINI_EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`;

  private static readonly circuitBreaker = new CircuitBreaker({
    name: 'GeminiSemanticEmbeddings',
    failureThreshold: 3,
    resetTimeoutMs: 15000,
    successThreshold: 2,
  });

  private static readonly bulkhead = new Bulkhead({
    name: 'SemanticEmbeddingPool',
    maxConcurrent: 2,
    maxQueue: 10,
    timeoutMs: 30000,
  });

  public static async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text], 'query');
    return embedding;
  }

  public static async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const result: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + MAX_BATCH_SIZE);
      result.push(...(await this.embedBatch(batch, 'document')));
    }
    return result;
  }

  private static async embedBatch(
    texts: string[],
    task: 'query' | 'document'
  ): Promise<number[][]> {
    if (texts.some((text) => !text.trim())) {
      throw new Error('Não é possível gerar embedding para texto vazio.');
    }

    const cacheKeys = task === 'document'
      ? texts.map((text) => `${this.embeddingModelId}\0${text}`)
      : [];
    const uncachedIndexes: number[] = [];
    const embeddings: Array<number[] | undefined> = new Array(texts.length);

    if (task === 'document') {
      texts.forEach((text, index) => {
        const cached = documentEmbeddingCache.get(cacheKeys[index]);
        if (cached) {
          embeddings[index] = cached;
        } else {
          uncachedIndexes.push(index);
        }
      });
    } else {
      uncachedIndexes.push(...texts.map((_, index) => index));
    }

    if (uncachedIndexes.length > 0) {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'mock-key-for-tests-and-dev') {
        throw new Error('Chave GEMINI_API_KEY necessária para gerar embeddings RAG.');
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: 30000 },
      });
      const response = await this.bulkhead.execute(() =>
        this.circuitBreaker.execute(() =>
          ai.models.embedContent({
            model: this.modelName,
            contents: uncachedIndexes.map((index) => texts[index].trim().slice(0, 12000)),
            config: {
              taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
              outputDimensionality: EMBEDDING_DIMENSIONS,
              httpOptions: { timeout: 30000 },
            },
          })
        )
      );
      const parsed = embeddingResponseSchema.parse(response);
      if (parsed.embeddings.length !== uncachedIndexes.length) {
        throw new Error(
          `Gemini retornou ${parsed.embeddings.length} embeddings para ${uncachedIndexes.length} textos.`
        );
      }

      parsed.embeddings.forEach((item, resultIndex) => {
        const normalized = normalizeVector(item.values);
        const textIndex = uncachedIndexes[resultIndex];
        embeddings[textIndex] = normalized;
        if (task === 'document') {
          this.cacheDocumentEmbedding(cacheKeys[textIndex], normalized);
        }
      });
    }

    return embeddings.map((embedding) => {
      if (!embedding) {
        throw new Error('Gemini não retornou embedding para um dos textos solicitados.');
      }
      return embedding;
    });
  }

  private static cacheDocumentEmbedding(key: string, embedding: number[]): void {
    if (documentEmbeddingCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = documentEmbeddingCache.keys().next().value;
      if (oldestKey) {
        documentEmbeddingCache.delete(oldestKey);
      }
    }
    documentEmbeddingCache.set(key, embedding);
  }
}
