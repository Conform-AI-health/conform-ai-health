import { beforeEach, describe, expect, it, vi } from 'vitest';

const { seedStore } = vi.hoisted(() => ({
  seedStore: {
    norms: [] as Array<Record<string, any>>,
    chunks: [] as Array<Record<string, any>>,
  },
}));

vi.mock('../config/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: 'admin-1' })),
    },
    norm: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => {
        const record = { id: `norm-${seedStore.norms.length + 1}`, ...data };
        seedStore.norms.push(record);
        return record;
      }),
      update: vi.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    normChunk: {
      count: vi.fn(async () => 0),
      createMany: vi.fn(async ({ data }) => {
        seedStore.chunks.push(...data);
        return { count: data.length };
      }),
    },
    scrapedPage: {
      upsert: vi.fn(),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    agentDefinition: {
      upsert: vi.fn(async () => ({})),
    },
    aiModelConfig: {
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import { prisma } from '../config/prisma.js';
import { runInitialSeed } from '../shared/autoMigrate.js';

describe('initial norm catalog seed', () => {
  beforeEach(() => {
    seedStore.norms.length = 0;
    seedStore.chunks.length = 0;
    vi.clearAllMocks();
  });

  it('stores the official catalog in norms/norms_chunk and removes its legacy scraped-page copies', async () => {
    await runInitialSeed();

    expect(prisma.norm.create).toHaveBeenCalledTimes(5);
    expect(prisma.normChunk.createMany).toHaveBeenCalledTimes(4);
    expect(seedStore.chunks).toHaveLength(8);
    expect(seedStore.norms.some((norm) => norm.normId === 'CFM-RES-2336-2023')).toBe(true);
    expect(seedStore.chunks.some((chunk) => chunk.normCode === 'CFM-RES-2336-2023')).toBe(true);
    expect(seedStore.chunks.every((chunk) => chunk.embedding.length === 0)).toBe(true);
    expect(seedStore.chunks.every((chunk) => JSON.parse(chunk.contextoSemantico).embedding_model === 'PENDING')).toBe(true);
    expect(prisma.scrapedPage.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          url: expect.objectContaining({ in: expect.arrayContaining([
            'https://normas.conformia.med.br/cfm-2336-art-01',
          ]) }),
        }),
      })
    );
    expect(prisma.scrapedPage.upsert).not.toHaveBeenCalled();
  });
});
