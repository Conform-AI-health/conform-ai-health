import { prisma } from '../config/prisma.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';

interface CliOptions {
  normCode: string;
  force: boolean;
  batchSize: number;
  delayMs: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let normCode = 'CFM-RES-2336-2023';
  let force = false;
  let batchSize = 5;
  let delayMs = 2500;

  for (const arg of args) {
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg.startsWith('--batch-size=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) batchSize = parsed;
    } else if (arg.startsWith('--delay=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed >= 0) delayMs = parsed;
    } else if (arg.startsWith('--norm=')) {
      normCode = arg.split('=')[1].trim();
    } else if (!arg.startsWith('-')) {
      normCode = arg.trim();
    }
  }

  return { normCode, force, batchSize, delayMs };
}

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
  metadata.indexed_at = new Date().toISOString();
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
    // Contexto armazenado como texto puro
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

export async function indexSpecificNorm(options: CliOptions): Promise<void> {
  const { normCode, force, batchSize, delayMs } = options;

  console.log(`\n======================================================`);
  console.log(`🔍 [RAG Index] Buscando norma correspondente a: "${normCode}"`);
  console.log(`⚙️ Configurações: batchSize=${batchSize}, delay=${delayMs}ms, force=${force}`);
  console.log(`🤖 Modelo de Embedding: ${SemanticEmbeddingService.embeddingModelId}`);
  console.log(`======================================================\n`);

  // 1. Localizar norma
  let norm = await prisma.norm.findFirst({
    where: { normId: normCode },
  });

  if (!norm) {
    norm = await prisma.norm.findFirst({
      where: { idNormaCfm: normCode },
    });
  }

  if (!norm) {
    norm = await prisma.norm.findFirst({
      where: {
        normId: {
          contains: normCode,
          mode: 'insensitive',
        },
      },
    });
  }

  if (!norm) {
    throw new Error(`❌ Norma "${normCode}" não foi encontrada no banco de dados.`);
  }

  console.log(`✅ Norma encontrada com sucesso:`);
  console.log(`   - ID no MongoDB: ${norm.id}`);
  console.log(`   - Código NormId: ${norm.normId}`);
  console.log(`   - ID CFM:        ${norm.idNormaCfm || 'N/A'}`);
  console.log(`   - Tipo / Número: ${norm.tipo} ${norm.numero}/${norm.ano}`);
  console.log(`   - Status:        ${norm.status}`);
  console.log(`   - Tags atuais:   [${norm.tags.join(', ')}]`);
  console.log(`   - Total Chunks:  ${norm.totalChunks}\n`);

  // 2. Buscar chunks da norma
  const chunks = await prisma.normChunk.findMany({
    where: {
      OR: [
        { normId: norm.id },
        { normCode: norm.normId },
      ],
    },
    orderBy: { chunkIndex: 'asc' },
    select: {
      id: true,
      chunkIndex: true,
      totalChunks: true,
      conteudoChunk: true,
      contextoSemantico: true,
      embedding: true,
    },
  });

  if (chunks.length === 0) {
    throw new Error(
      `⚠️ Nenhum chunk encontrado para a norma ${norm.normId} (ID: ${norm.id}). Verifique se a norma foi chunkada corretamente.`
    );
  }

  console.log(`📦 Chunks encontrados no banco: ${chunks.length}`);

  // 3. Determinar quais chunks precisam ser vetorizados
  const pendingChunks = chunks.filter((chunk) => {
    if (force) return true;
    const hasCorrectModel = getStoredEmbeddingModel(chunk.contextoSemantico) === SemanticEmbeddingService.embeddingModelId;
    const hasValidVector = Array.isArray(chunk.embedding) && chunk.embedding.length === SemanticEmbeddingService.vectorDimensions;
    return !hasCorrectModel || !hasValidVector;
  });

  const alreadyIndexed = chunks.length - pendingChunks.length;
  console.log(`📊 Status dos Embeddings:`);
  console.log(`   - Já vetorizados e compatíveis: ${alreadyIndexed}/${chunks.length}`);
  console.log(`   - Pendentes de vetorização:     ${pendingChunks.length}/${chunks.length}\n`);

  if (pendingChunks.length === 0) {
    console.log(`🎉 Todos os ${chunks.length} chunks da norma ${norm.normId} já estão 100% indexados com embeddings válidos!`);
    
    // Garantir que a tag RAG_READY esteja presente
    if (!norm.tags.includes('RAG_READY')) {
      const updatedTags = Array.from(new Set([...norm.tags, 'RAG_READY']));
      await prisma.norm.update({
        where: { id: norm.id },
        data: { tags: updatedTags },
      });
      console.log(`🏷️ Tag "RAG_READY" adicionada à norma ${norm.normId}.`);
    }
    return;
  }

  // 4. Processar chunks pendentes em lotes
  console.log(`🚀 Iniciando vetorização de ${pendingChunks.length} chunks em lotes de até ${batchSize}...`);
  let successCount = 0;

  for (let i = 0; i < pendingChunks.length; i += batchSize) {
    const batch = pendingChunks.slice(i, i + batchSize);
    const chunkIndexes = batch.map((c) => `#${c.chunkIndex}`).join(', ');
    const progressPct = Math.round(((i) / pendingChunks.length) * 100);

    console.log(`\n[Lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(pendingChunks.length / batchSize)}] (${progressPct}%) Processando chunks: ${chunkIndexes}...`);

    const texts = batch.map((chunk) => getEmbeddingInput(chunk.contextoSemantico, chunk.conteudoChunk));

    let retries = 0;
    const maxRetries = 10;
    let batchSuccess = false;

    while (!batchSuccess && retries < maxRetries) {
      try {
        const embeddings = await SemanticEmbeddingService.embedDocuments(texts);

        // Salvar embeddings no banco para cada chunk do lote
        await Promise.all(
          batch.map((chunk, index) =>
            prisma.normChunk.update({
              where: { id: chunk.id },
              data: {
                embedding: embeddings[index],
                contextoSemantico: updateEmbeddingMetadata(chunk.contextoSemantico),
              },
            })
          )
        );

        successCount += batch.length;
        batchSuccess = true;
        console.log(`   ✅ Lote gravado com sucesso! (${successCount}/${pendingChunks.length} chunks concluídos)`);
      } catch (err: any) {
        const errMessage = String(err?.message || err);
        const isDailyLimitExceeded =
          errMessage.includes('1000 requests per day') ||
          errMessage.includes('limit exceeded on Free Tier') ||
          errMessage.includes('embed_content_free_tier_requests');

        if (isDailyLimitExceeded) {
          console.error(`\n❌ [COTA DIÁRIA ESGOTADA] Limite diário de 1.000 requisições do Gemini Free Tier atingido.`);
          console.error(`   Detalhes: ${errMessage}`);
          console.error(`   Soluções:`);
          console.error(`   1. Aguardar a virada do dia (meia-noite UTC) para reset automático da cota gratuita.`);
          console.error(`   2. Inserir uma GEMINI_API_KEY com cota disponível ou billing ativo no .env.`);
          throw new Error(`Cota diária do Free Tier do Google Gemini esgotada. Chunks salvos até aqui: ${successCount}.`);
        }

        const isRateLimit =
          errMessage.includes('429') ||
          errMessage.includes('RESOURCE_EXHAUSTED') ||
          errMessage.includes('Quota exceeded') ||
          errMessage.includes('CircuitBreakerOpenError') ||
          errMessage.includes('está ABERTO') ||
          err?.status === 429;

        if (isRateLimit) {
          retries++;
          const waitSeconds = 65;
          console.warn(`\n⏳ [429 Rate Limit] Limite de requisições por minuto atingido (tentativa ${retries}/${maxRetries}).`);
          console.warn(`   Aguardando ${waitSeconds}s para renovação da janela do Gemini...`);

          for (let remaining = waitSeconds; remaining > 0; remaining -= 15) {
            const step = Math.min(15, remaining);
            await new Promise((resolve) => setTimeout(resolve, step * 1000));
            console.log(`   ⏱️ Restam ${remaining - step}s...`);
          }

          SemanticEmbeddingService.resetCircuitBreaker();
          console.log(`🔄 Retomando tentativa para o lote...`);
        } else {
          console.error(`❌ Erro inesperado ao gerar embeddings:`, err);
          throw err;
        }
      }
    }

    if (!batchSuccess) {
      throw new Error(`Falha persistente ao indexar lote após ${maxRetries} tentativas.`);
    }

    // Intervalo preventivo entre requisições
    if (i + batchSize < pendingChunks.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // 5. Verificação final
  const refreshedChunks = await prisma.normChunk.findMany({
    where: {
      OR: [
        { normId: norm.id },
        { normCode: norm.normId },
      ],
    },
    select: {
      embedding: true,
      contextoSemantico: true,
    },
  });

  const validChunks = refreshedChunks.filter(
    (c) =>
      Array.isArray(c.embedding) &&
      c.embedding.length === SemanticEmbeddingService.vectorDimensions &&
      getStoredEmbeddingModel(c.contextoSemantico) === SemanticEmbeddingService.embeddingModelId
  );

  console.log(`\n======================================================`);
  console.log(`🏁 [RAG Index] Concluído para ${norm.normId}!`);
  console.log(`   - Chunks válidos com embeddings: ${validChunks.length}/${refreshedChunks.length}`);

  if (validChunks.length === refreshedChunks.length) {
    console.log(`   - Status: 🟢 Embeddings OK (100% vetorizado)`);
    const newTags = Array.from(new Set([...norm.tags, 'RAG_READY']));
    await prisma.norm.update({
      where: { id: norm.id },
      data: { tags: newTags },
    });
    console.log(`   - Tag "RAG_READY" confirmada na norma.`);
  } else {
    console.log(`   - Status: 🟡 Parcial (${validChunks.length}/${refreshedChunks.length})`);
  }
  console.log(`======================================================\n`);
}

// Execução direta via CLI
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('src/scripts/indexSpecificNorm.ts') ||
  process.argv[1]?.replace(/\\/g, '/').endsWith('dist/scripts/indexSpecificNorm.js');

if (isDirectRun) {
  const options = parseArgs();
  indexSpecificNorm(options)
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('\n💥 Erro na execução:', (error as Error).message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
