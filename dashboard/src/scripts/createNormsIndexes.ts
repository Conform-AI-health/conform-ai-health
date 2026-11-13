import { prisma } from '../config/prisma.js';

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
  console.log('ℹ️ [Atlas Vector Search] Definição recomendada para o índice vetorial em norms_chunk.embedding:');
  console.log(
    JSON.stringify(
      {
        name: 'vector_index_norms_chunk',
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: 768,
              similarity: 'cosine',
            },
            { type: 'filter', path: 'tags' },
            { type: 'filter', path: 'normId' },
          ],
        },
      },
      null,
      2
    )
  );
}

if (process.argv[1]?.includes('createNormsIndexes')) {
  ensureNormsMongoIndexes()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Erro ao criar índices:', err.message);
      process.exit(1);
    });
}
