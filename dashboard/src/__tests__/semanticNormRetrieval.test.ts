import { beforeEach, describe, expect, it, vi } from 'vitest';

const { norms, chunks, embedQuery, embedDocuments } = vi.hoisted(() => ({
  norms: [
    {
      id: 'norm-cfm',
      normId: 'CFM-RES-2336-2023',
      orgao: 'CFM',
      status: 'VIGENTE',
      ementaHigienizada: 'Publicidade médica',
      tags: ['CFM'],
    },
  ],
  chunks: [
    {
      id: 'chunk-relevant',
      normId: 'norm-cfm',
      normCode: 'CFM-RES-2336-2023',
      chunkIndex: 1,
      conteudoChunk: 'A publicidade médica deve identificar o profissional e informar o CRM.',
      contextoSemantico: JSON.stringify({
        article: 'Art. 1º',
        heading_context: 'Identificação profissional',
        embedding_model: 'gemini-embedding-001:2',
      }),
      embedding: [1, 0],
      tags: ['CFM'],
    },
    {
      id: 'chunk-unrelated',
      normId: 'norm-cfm',
      normCode: 'CFM-RES-2336-2023',
      chunkIndex: 2,
      conteudoChunk: 'Regras sobre outro tema sem relação com identificação.',
      contextoSemantico: JSON.stringify({
        article: 'Art. 20',
        heading_context: 'Tema distinto',
        embedding_model: 'gemini-embedding-001:2',
      }),
      embedding: [0, 1],
      tags: ['CFM'],
    },
  ],
  embedQuery: vi.fn(async () => [1, 0]),
  embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => [1, 0])),
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findMany: vi.fn(async () => norms),
    },
    normChunk: {
      findMany: vi.fn(async () => chunks),
    },
  },
}));

vi.mock('../services/semanticEmbeddingService.js', () => ({
  SemanticEmbeddingService: {
    modelName: 'gemini-embedding-001',
    vectorDimensions: 2,
    embeddingModelId: 'gemini-embedding-001:2',
    embedQuery,
    embedDocuments,
  },
  cosineSimilarity: (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + value * right[index], 0),
}));

import { prisma } from '../config/prisma.js';
import { NormsResolver } from '../services/normsResolver.js';

describe('Semantic tag-scoped norm retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ranks only active chunks in the agent tag scope and returns top-K', async () => {
    const result = await NormsResolver.retrieveRelevantByTags(
      ['cfm'],
      'CRM e identificação profissional',
      1
    );

    expect(prisma.norm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'VIGENTE',
          tags: { hasSome: expect.arrayContaining(['CFM', 'cfm']) },
        }),
      })
    );
    expect(result.status).toBe('READY');
    expect(result.norms).toHaveLength(1);
    expect(result.norms[0].id).toBe('chunk-relevant');
    expect(result.norms[0].relevanceScore).toBeGreaterThan(0.7);
  });

  it('does not query or broaden the corpus when the agent has no regulatory tags', async () => {
    const result = await NormsResolver.retrieveRelevantByTags([], 'conteúdo médico');

    expect(result).toEqual({ norms: [], status: 'NO_SCOPE', candidatesCount: 0 });
    expect(prisma.norm.findMany).not.toHaveBeenCalled();
    expect(embedQuery).not.toHaveBeenCalled();
  });

  it('returns an unindexed status instead of using stale pseudo-embeddings', async () => {
    chunks[0].contextoSemantico = JSON.stringify({
      embedding_model: 'deterministic-sha256-768d',
    });

    const result = await NormsResolver.retrieveRelevantByTags(['CFM'], 'CRM');

    expect(result.status).toBe('UNINDEXED');
    expect(result.norms).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      expectedEmbeddingModel: 'gemini-embedding-001:2',
      activeChunksCount: 2,
      indexedChunksCount: 1,
      modelMismatchCount: 1,
      missingEmbeddingCount: 0,
    });
    expect(embedQuery).not.toHaveBeenCalled();
  });
});
