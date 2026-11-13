import { prisma } from '../config/prisma.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';

const BATCH_SIZE = 32;

function updateEmbeddingMetadata(value: string | null): string {
  let metadata: Record<string, unknown> = {};
  if (value) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      } else {
        metadata.heading_context = value;
      }
    } catch {
      metadata.heading_context = value;
    }
  }
  metadata.embedding_model = SemanticEmbeddingService.embeddingModelId;
  return JSON.stringify(metadata);
}

function getEmbeddingInput(context: string | null, content: string): string {
  if (!context) {
    return content;
  }
  try {
    const parsed: unknown = JSON.parse(context);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const heading = (parsed as Record<string, unknown>).heading_context;
      return `${typeof heading === 'string' ? heading : context}\n${content}`;
    }
  } catch {
    // Older chunks store plain heading text instead of JSON metadata.
  }
  return `${context}\n${content}`;
}

function getStoredEmbeddingModel(context: string | null): string | undefined {
  if (!context) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(context);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const model = (parsed as Record<string, unknown>).embedding_model;
    return typeof model === 'string' ? model : undefined;
  } catch {
    return undefined;
  }
}

async function verifyIndexedChunks(): Promise<{ total: number; pending: number }> {
  let cursorId: string | undefined;
  let total = 0;
  let pending = 0;

  while (true) {
    const batch = await prisma.normChunk.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        contextoSemantico: true,
        embedding: true,
      },
    });
    if (batch.length === 0) {
      break;
    }

    total += batch.length;
    pending += batch.filter(
      (chunk) =>
        getStoredEmbeddingModel(chunk.contextoSemantico) !== SemanticEmbeddingService.embeddingModelId ||
        !Array.isArray(chunk.embedding) ||
        chunk.embedding.length !== SemanticEmbeddingService.vectorDimensions
    ).length;
    cursorId = batch[batch.length - 1].id;
  }

  return { total, pending };
}

export async function reindexNormEmbeddings(): Promise<number> {
  let cursorId: string | undefined;
  let indexedCount = 0;

  console.log(`[RAG Reindex] Iniciando com Gemini ${SemanticEmbeddingService.embeddingModelId}.`);
  while (true) {
    const batch = await prisma.normChunk.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        conteudoChunk: true,
        contextoSemantico: true,
      },
    });
    if (batch.length === 0) {
      break;
    }

    const embeddings = await SemanticEmbeddingService.embedDocuments(
      batch.map((chunk) => getEmbeddingInput(chunk.contextoSemantico, chunk.conteudoChunk))
    );
    await Promise.all(batch.map((chunk, index) =>
      prisma.normChunk.update({
        where: { id: chunk.id },
        data: {
          embedding: embeddings[index],
          contextoSemantico: updateEmbeddingMetadata(chunk.contextoSemantico),
        },
      })
    ));

    indexedCount += batch.length;
    cursorId = batch[batch.length - 1].id;
    console.log(`[RAG Reindex] ${indexedCount} chunks indexados com ${SemanticEmbeddingService.embeddingModelId}.`);
  }

  const verification = await verifyIndexedChunks();
  console.log(
    `[RAG Reindex] Verificação: ${verification.total - verification.pending}/${verification.total} chunks compatíveis; pendentes: ${verification.pending}.`
  );
  if (verification.pending > 0) {
    throw new Error(
      `${verification.pending} de ${verification.total} chunks não ficaram compatíveis com ${SemanticEmbeddingService.embeddingModelId}.`
    );
  }

  return indexedCount;
}

if (process.argv[1]?.includes('reindexNormEmbeddings')) {
  reindexNormEmbeddings()
    .then(async (count) => {
      console.log(`[RAG Reindex] Concluído: ${count} chunks indexados.`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error('[RAG Reindex] Falha ao indexar chunks:', error);
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
