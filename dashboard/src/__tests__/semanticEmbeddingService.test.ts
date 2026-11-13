import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbedContent } = vi.hoisted(() => ({
  mockEmbedContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { embedContent: mockEmbedContent },
  })),
}));

vi.mock('../config/env.js', () => ({
  env: {
    GEMINI_API_KEY: 'test-gemini-api-key',
    GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  },
}));

import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';

describe('SemanticEmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Gemini retrieval task types and returns normalized vectors', async () => {
    const values = Array(768).fill(0);
    values[0] = 3;
    values[1] = 4;
    mockEmbedContent.mockResolvedValueOnce({ embeddings: [{ values }] });

    const vector = await SemanticEmbeddingService.embedQuery('CRM and professional identity');

    expect(mockEmbedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: ['CRM and professional identity'],
      config: {
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 768,
        httpOptions: { timeout: 30000 },
      },
    });
    expect(vector.slice(0, 2)).toEqual([0.6, 0.8]);
    expect(vector).toHaveLength(768);
  });

  it('batches document embeddings and requests the retrieval-document task type', async () => {
    const values = Array(768).fill(1);
    mockEmbedContent
      .mockResolvedValueOnce({
        embeddings: Array.from({ length: 32 }, () => ({ values })),
      })
      .mockResolvedValueOnce({ embeddings: [{ values }] });

    const vectors = await SemanticEmbeddingService.embedDocuments(
      Array.from({ length: 33 }, (_, index) => `norm chunk ${index}`)
    );

    expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    expect(mockEmbedContent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        config: expect.objectContaining({ taskType: 'RETRIEVAL_DOCUMENT' }),
      })
    );
    expect(vectors).toHaveLength(33);
    expect(vectors.every((vector) => vector.length === 768)).toBe(true);
  });

  it('rejects invalid provider output instead of producing a fallback vector', async () => {
    mockEmbedContent.mockResolvedValueOnce({ embeddings: [] });

    await expect(SemanticEmbeddingService.embedQuery('audit query')).rejects.toThrow();
  });
});
