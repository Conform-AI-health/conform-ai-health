import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';

/**
 * Script de Criação de Índices no MongoDB para `norms` e `norms_chunk`
 * Execução: npx tsx src/scripts/createNormsIndexes.ts
 */
export async function ensureNormsMongoIndexes(): Promise<void> {
  console.log('🔧 [MongoDB Indexes] Criando índices para as coleções norms e norms_chunk...');

  // 1. Índices na coleção `norms`
  await prisma.$runCommandRaw({
    createIndexes: 'norms',
    indexes: [
      {
        key: { urlOriginal: 1, sha256Original: 1 },
        name: 'idx_norms_source_url_content_hash_unique',
        unique: true,
      },
      {
        key: { tipo: 1, ano: -1, numero: 1 },
        name: 'idx_norms_type_year_number',
      },
      {
        key: { status: 1 },
        name: 'idx_norms_status',
      },
      {
        key: { ementaHigienizada: 'text', cleanMarkdown: 'text' },
        name: 'idx_norms_fulltext_title_summary',
        default_language: 'portuguese',
      },
    ],
  });

  // 2. Índices na coleção `norms_chunk`
  await prisma.$runCommandRaw({
    createIndexes: 'norms_chunk',
    indexes: [
      {
        key: { normId: 1, chunkIndex: 1 },
        name: 'idx_norm_chunks_norm_id_chunk_index',
        unique: true,
      },
      {
        key: { normCode: 1, tags: 1 },
        name: 'idx_norm_chunks_filters',
      },
    ],
  });

  console.log('✅ [MongoDB Indexes] Índices B-Tree e Text criados com sucesso em norms e norms_chunk.');

  // 3. Índice Atlas Vector Search (usado quando RAG_VECTOR_SEARCH_ENABLED=true)
  const vectorIndex = {
    name: env.RAG_VECTOR_INDEX_NAME,
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: SemanticEmbeddingService.vectorDimensions,
          similarity: 'cosine',
        },
        { type: 'filter', path: 'tags' },
        { type: 'filter', path: 'normId' },
      ],
    },
  };
  try {
    await prisma.$runCommandRaw({ createSearchIndexes: 'norms_chunk', indexes: [vectorIndex] });
    console.log(`✅ [Atlas Vector Search] Índice ${vectorIndex.name} solicitado em norms_chunk.embedding.`);
  } catch (err: any) {
    console.warn(
      `ℹ️ [Atlas Vector Search] Não foi possível criar o índice automaticamente (${err.message}). ` +
        'Crie manualmente no Atlas com a definição abaixo:'
    );
    console.log(JSON.stringify(vectorIndex, null, 2));
  }
}

if (process.argv[1]?.includes('createNormsIndexes')) {
  ensureNormsMongoIndexes()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Erro ao criar índices:', err.message);
      process.exit(1);
    });
}
