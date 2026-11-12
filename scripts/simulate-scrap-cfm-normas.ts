import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { TextEncodingSanitizer } from '../dashboard/src/shared/textEncodingSanitizer.js';
import { generateSemanticChunks } from '../dashboard/src/services/smartScraperService.js';
import { generateDeterministicEmbedding } from '../dashboard/src/services/regulatoryScraperService.js';

// Carrega variáveis de ambiente tanto do backend quanto da raiz
const rootEnvPath = path.resolve(process.cwd(), '.env');
const dashboardEnvPath = path.resolve(process.cwd(), 'dashboard', '.env');

if (fs.existsSync(dashboardEnvPath)) {
  dotenv.config({ path: dashboardEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

// Inicializa Prisma Client para a coleção MongoDB
const prisma = new PrismaClient({
  log: ['error'],
});

export interface CliOptions {
  dir: string;
  limit?: number;
  batchSize: number;
  dryRun: boolean;
  force: boolean;
  checkDb: boolean;
  category?: string;
  saveJson?: string;
  maxChunkTokens: number;
  overlapTokens: number;
}

export interface ParsedNormaMetadata {
  id: string;
  idNormaCfm?: string;
  orgao: string;
  tipo: string;
  numero: string;
  ano: string;
  dataPublicacao?: string;
  status: string;
  ementaOriginal: string;
  ementa: string;
  macroTema?: string;
  tags: string[];
  destaques?: Record<string, boolean>;
  urlOriginal: string;
  urlPdfOriginal?: string;
  sha256Conteudo?: string;
}

export interface ScrapedNormaDocument {
  filePath: string;
  metadata: ParsedNormaMetadata;
  rawFileContent: string;
  content: string;
  cleanContent: string;
  chunks: string[];
  totalChunks: number;
  tokensCount: number;
  ragMetadata: {
    chunkingSugerido: boolean;
    tamanhoMaximoChunk: number;
    sobreposicaoChunk: number;
    contextoSemantico: string;
    totalChunks: number;
  };
}

/**
 * Faz o parsing robusto do frontmatter YAML dos arquivos Markdown de normas
 */
export function parseNormaMarkdown(fileContent: string, fallbackId: string): { metadata: ParsedNormaMetadata; content: string } {
  let frontmatterBlock = '';
  let contentBlock = fileContent;

  const match = fileContent.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]+([\s\S]*)$/);
  if (match) {
    frontmatterBlock = match[1];
    contentBlock = match[2];
  }

  const rawMeta: Record<string, any> = {};

  if (frontmatterBlock) {
    const lines = frontmatterBlock.split(/\r?\n/);
    let currentKey = '';
    let isMultiLine = false;
    let multiLineVal = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (isMultiLine && (line.startsWith('  ') || line.startsWith('\t'))) {
        multiLineVal += ' ' + line.trim();
        continue;
      } else if (isMultiLine) {
        rawMeta[currentKey] = multiLineVal.trim();
        isMultiLine = false;
        currentKey = '';
      }

      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && !line.startsWith(' ') && !line.startsWith('-')) {
        const key = line.slice(0, colonIdx).trim();
        let val = line.slice(colonIdx + 1).trim();

        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1);
        }

        if (val === '' && i + 1 < lines.length && (lines[i + 1].startsWith('  ') || lines[i + 1].startsWith('\t'))) {
          currentKey = key;
          isMultiLine = true;
          multiLineVal = '';
        } else {
          rawMeta[key] = val;
        }
      }
    }

    if (isMultiLine && currentKey) {
      rawMeta[currentKey] = multiLineVal.trim();
    }
  }

  const cleanEmenta = TextEncodingSanitizer.sanitizeAndRepairText(rawMeta.ementa || '');
  const cleanMacroTema = TextEncodingSanitizer.sanitizeAndRepairText(rawMeta.macro_tema || '');
  const cleanTipo = TextEncodingSanitizer.sanitizeAndRepairText(rawMeta.tipo || 'Norma').toUpperCase();
  const rawNumero = String(rawMeta.numero || '').replace(/['"]/g, '').trim();
  const rawAno = String(rawMeta.ano || '').replace(/['"]/g, '').trim();
  const cleanStatus = TextEncodingSanitizer.sanitizeAndRepairText(rawMeta.status || 'Vigente');
  const cleanId = rawMeta.id ? String(rawMeta.id).trim() : fallbackId;
  const cleanUrl = rawMeta.url_original || `https://sistemas.cfm.org.br/normas/visualizar/${cleanTipo.toLowerCase()}s/BR/${rawAno}/${rawNumero}`;
  const cleanBodyContent = TextEncodingSanitizer.sanitizeAndRepairText(contentBlock.trim());

  const metadata: ParsedNormaMetadata = {
    id: cleanId,
    idNormaCfm: rawMeta.id_norma_cfm,
    orgao: rawMeta.orgao || 'CFM',
    tipo: cleanTipo,
    numero: rawNumero,
    ano: rawAno,
    dataPublicacao: rawMeta.data_publicacao,
    status: cleanStatus,
    ementaOriginal: rawMeta.ementa || '',
    ementa: cleanEmenta,
    macroTema: cleanMacroTema,
    tags: Array.isArray(rawMeta.tags) ? rawMeta.tags : [],
    urlOriginal: cleanUrl,
    urlPdfOriginal: rawMeta.url_pdf_original,
    sha256Conteudo: rawMeta.sha256_conteudo,
  };

  return {
    metadata,
    content: cleanBodyContent,
  };
}

/**
 * Varre recursivamente o diretório procurando arquivos .md
 */
export function findMarkdownFilesRecursively(dirPath: string, categoryFilter?: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (categoryFilter) {
        const rel = path.relative(dirPath, fullPath).toLowerCase();
        if (rel.includes(categoryFilter.toLowerCase()) || categoryFilter.toLowerCase().includes(entry.name.toLowerCase())) {
          results.push(...findMarkdownFilesRecursively(fullPath));
        } else {
          results.push(...findMarkdownFilesRecursively(fullPath, categoryFilter));
        }
      } else {
        results.push(...findMarkdownFilesRecursively(fullPath));
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Processa um único arquivo de norma aplicando higienização e chunking semântico RAG
 */
export function processNormaFile(
  filePath: string,
  maxChunkTokens: number = 512,
  overlapTokens: number = 64
): ScrapedNormaDocument {
  const rawBytes = fs.readFileSync(filePath);
  const rawText = TextEncodingSanitizer.decodeBufferWithAutoEncoding(rawBytes);

  const fallbackId = path.basename(filePath, path.extname(filePath));
  const { metadata, content } = parseNormaMarkdown(rawText, fallbackId);
  const cleanContent = TextEncodingSanitizer.sanitizeAndRepairText(content);
  const chunks = generateSemanticChunks(cleanContent, maxChunkTokens, overlapTokens);
  const tokensCount = Math.ceil(cleanContent.length / 4);

  const contextoSemantico = metadata.ementa
    ? `Objeto Regulatório: ${metadata.ementa}`
    : `${metadata.orgao} ${metadata.tipo} nº ${metadata.numero}/${metadata.ano} (${metadata.status})`;

  return {
    filePath,
    metadata,
    rawFileContent: rawText,
    content,
    cleanContent,
    chunks,
    totalChunks: chunks.length,
    tokensCount,
    ragMetadata: {
      chunkingSugerido: true,
      tamanhoMaximoChunk: maxChunkTokens,
      sobreposicaoChunk: overlapTokens,
      contextoSemantico,
      totalChunks: chunks.length,
    },
  };
}

/**
 * Monta o documento formatado em Markdown com cabeçalho RAG de auditoria deontológica
 */
export function buildRagMarkdown(doc: ScrapedNormaDocument): string {
  const meta = doc.metadata;
  return [
    `# [${meta.orgao}] ${meta.tipo} Nº ${meta.numero}/${meta.ano} - ${meta.status.toUpperCase()}`,
    '',
    `- **ID da Norma:** ${meta.id}`,
    `- **Órgão Emissor:** ${meta.orgao}`,
    `- **Tipo Normativo:** ${meta.tipo}`,
    `- **Número/Ano:** ${meta.numero}/${meta.ano}`,
    `- **Data de Publicação:** ${meta.dataPublicacao || 'N/A'}`,
    `- **Status de Vigência:** ${meta.status}`,
    `- **Macro Tema:** ${meta.macroTema || 'Geral'}`,
    `- **Link Oficial:** [Acessar Documento Oficial no CFM](${meta.urlOriginal})`,
    meta.urlPdfOriginal ? `- **PDF Oficial:** [Download do PDF](${meta.urlPdfOriginal})` : '',
    `- **Contexto Semântico RAG:** ${doc.ragMetadata.contextoSemantico}`,
    `- **Particionamento RAG:** ${doc.totalChunks} chunk(s) (Janela: ${doc.ragMetadata.tamanhoMaximoChunk} tokens, Overlap: ${doc.ragMetadata.sobreposicaoChunk} tokens)`,
    '',
    '---',
    '',
    '## Ementa Oficial',
    meta.ementa ? `> ${meta.ementa}` : '_Ementa não informada._',
    '',
    '## Conteúdo Integral Higienizado',
    doc.cleanContent,
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Parseia argumentos de linha de comando
 */
export function parseCommandLineArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dir: 'C:\\Users\\frede\\OneDrive\\Documentos\\cfm-normas\\normas',
    batchSize: 25,
    dryRun: false,
    force: false,
    checkDb: false,
    maxChunkTokens: 512,
    overlapTokens: 64,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if ((arg === '--dir' || arg === '-d') && i + 1 < argv.length) {
      options.dir = argv[++i];
    } else if ((arg === '--limit' || arg === '-l') && i + 1 < argv.length) {
      options.limit = parseInt(argv[++i], 10);
    } else if ((arg === '--batch-size' || arg === '-b') && i + 1 < argv.length) {
      options.batchSize = Math.max(1, parseInt(argv[++i], 10));
    } else if ((arg === '--chunk-size') && i + 1 < argv.length) {
      options.maxChunkTokens = parseInt(argv[++i], 10);
    } else if ((arg === '--chunk-overlap') && i + 1 < argv.length) {
      options.overlapTokens = parseInt(argv[++i], 10);
    } else if ((arg === '--category' || arg === '-c') && i + 1 < argv.length) {
      options.category = argv[++i];
    } else if (arg === '--save-json' && i + 1 < argv.length) {
      options.saveJson = argv[++i];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--check-db' || arg === '--check') {
      options.checkDb = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
⚖️  Conform.AI — Ingestão & Simulação de Scraping Local com Chunking RAG
Uso: tsx scripts/simulate-scrap-cfm-normas.ts [opções]

Opções:
  -d, --dir <caminho>       Diretório contendo as normas (padrão: C:\\Users\\frede\\OneDrive\\Documentos\\cfm-normas\\normas)
  -l, --limit <n>           Limitar processamento a N arquivos (ideal para testes)
  -b, --batch-size <n>      Tamanho do lote de inserção concorrente no MongoDB (padrão: 25)
  --chunk-size <n>          Tamanho máximo do chunk semântico em tokens (padrão: 512)
  --chunk-overlap <n>       Sobreposição do chunk semântico em tokens (padrão: 64)
  -c, --category <nome>     Filtrar por subpasta (ex: resolucoes, pareceres, recomendacoes)
  --dry-run                 Executa a leitura, higienização e chunking sem gravar no MongoDB
  -f, --force               Atualiza normas mesmo se já cadastradas no banco
  --check-db                Verifica e exibe as versões salvas nas coleções 'norms' e 'norms_chunk'
  --save-json <caminho>     Exporta os documentos processados e chunks para um arquivo JSON consolidado
  -h, --help                Exibe esta mensagem de ajuda
`);
}

/**
 * Consulta e valida se ambas as versões (Original e Higienizada) estão salvas nas coleções 'norms' e 'norms_chunk'
 */
export async function checkSavedVersionsInDb(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🔍 [AUDITORIA DE BANCO DE DADOS: COLEÇÕES norms E norms_chunk]');
  console.log('='.repeat(80));

  try {
    const totalNorms = await (prisma as any).norm.count();
    const totalChunks = await (prisma as any).normChunk.count();

    console.log(`📊 Coleção 'norms'       : ${totalNorms} documento(s) cadastrado(s)`);
    console.log(`🧱 Coleção 'norms_chunk' : ${totalChunks} chunk(s) cadastrado(s)`);

    if (totalNorms === 0) {
      console.log('\n⚠️  Ainda não há registros na coleção "norms". Execute o script sem a flag --dry-run para popular o banco.');
      return;
    }

    const sampleNorms = await (prisma as any).norm.findMany({
      take: 2,
      orderBy: { createdAt: 'desc' },
      include: {
        chunks: {
          take: 3,
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });

    for (let i = 0; i < sampleNorms.length; i++) {
      const n = sampleNorms[i];
      console.log(`\n📌 Amostra ${i + 1}/${sampleNorms.length}: [${n.normId}] ${n.tipo} nº ${n.numero}/${n.ano}`);
      console.log(`   - ID no MongoDB       : ${n.id}`);
      console.log(`   - Status de Vigência  : ${n.status}`);
      console.log(`   - URL Oficial         : ${n.urlOriginal}`);
      console.log(`   - Arquivo Local       : ${n.filePathOriginal || 'N/A'}`);
      console.log(`   - Hash SHA-256        : ${n.sha256Original || 'N/A'}`);
      console.log(`   - Total Chunks Salvos : ${n.totalChunks}`);

      console.log('\n   📝 COMPARAÇÃO DE EMENTAS:');
      console.log(`      [Original Bruta] : ${n.ementaOriginal || '(Sem ementa original)'}`);
      console.log(`      [Higienizada]    : ${n.ementaHigienizada || '(Sem ementa higienizada)'}`);

      console.log('\n   📄 COMPARAÇÃO DO CONTEÚDO (Primeiros 180 caracteres):');
      console.log(`      [Versão 1 - Bruta Original] : ${JSON.stringify(n.conteudoOriginalBruto.slice(0, 180))}...`);
      console.log(`      [Versão 2 - Higienizada]    : ${JSON.stringify(n.conteudoHigienizado.slice(0, 180))}...`);

      console.log(`\n   🧱 CHUNKS NA COLEÇÃO 'norms_chunk' (Exibindo ${n.chunks.length} de ${n.totalChunks}):`);
      for (const ch of n.chunks) {
        console.log(`      ▪️ Bloco ${ch.chunkIndex}/${ch.totalChunks} (${ch.tokensEstimados} tokens, ${ch.caracteresCount} chars, Embedding: ${ch.embedding?.length || 0} dims):`);
        console.log(`         "${ch.conteudoChunk.slice(0, 120).replace(/\r?\n/g, ' ')}..."`);
      }
      console.log('-'.repeat(80));
    }

    console.log('\n✅ Auditoria concluída: As coleções "norms" e "norms_chunk" estão estruturadas e armazenando ambas as versões com sucesso!');
  } catch (err: any) {
    console.error('❌ Erro consultando o banco:', err?.message || err);
  }
}

/**
 * Função executiva principal
 */
export async function runIngestion(options: CliOptions) {
  const startTime = Date.now();
  console.log('='.repeat(80));
  console.log('🚀 [SIMULADOR DE SCRAPING & RAG CHUNKING CFM]');
  console.log(`📂 Diretório Alvo : ${options.dir}`);
  console.log(`⚙️  Modo de Execução: ${options.dryRun ? '🟡 DRY-RUN (Sem gravação no banco)' : '🟢 PRODUÇÃO (Persistindo no MongoDB)'}`);
  console.log(`📦 Tamanho do Lote: ${options.batchSize} arquivos por bloco concorrente`);
  console.log(`📐 Chunking RAG   : Janela ${options.maxChunkTokens} tokens | Overlap ${options.overlapTokens} tokens`);
  if (options.limit) console.log(`🔢 Limite Definido: Máximo de ${options.limit} arquivos`);
  if (options.category) console.log(`🏷️  Filtro Categoria: ${options.category}`);
  if (options.force) console.log(`⚡ Modo Force     : Sobrescreve registros já existentes`);
  console.log('='.repeat(80));

  if (!fs.existsSync(options.dir)) {
    console.error(`❌ Diretório não encontrado: ${options.dir}`);
    process.exit(1);
  }

  console.log('\n🔍 Escaneando diretório em busca de arquivos Markdown (.md)...');
  let files = findMarkdownFilesRecursively(options.dir, options.category);
  console.log(`📄 Total de arquivos encontrados: ${files.length}`);

  if (options.limit && options.limit > 0) {
    files = files.slice(0, options.limit);
    console.log(`✂️  Limitando execução aos primeiros ${files.length} arquivos.`);
  }

  if (files.length === 0) {
    console.log('ℹ️  Nenhum arquivo para processar.');
    return;
  }

  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalChunksGenerated = 0;

  const exportedDocs: any[] = [];
  const totalBatches = Math.ceil(files.length / options.batchSize);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchFiles = files.slice(batchIdx * options.batchSize, (batchIdx + 1) * options.batchSize);
    const batchStartTime = Date.now();

    console.log(
      `\n⏳ [Lote ${batchIdx + 1}/${totalBatches}] Processando arquivos ${batchIdx * options.batchSize + 1} até ${
        batchIdx * options.batchSize + batchFiles.length
      }...`
    );

    const promises = batchFiles.map(async (filePath) => {
      try {
        const doc = processNormaFile(filePath, options.maxChunkTokens, options.overlapTokens);
        totalChunksGenerated += doc.totalChunks;

        if (options.saveJson) {
          exportedDocs.push({
            id: doc.metadata.id,
            orgao: doc.metadata.orgao,
            tipo: doc.metadata.tipo,
            numero: doc.metadata.numero,
            ano: doc.metadata.ano,
            status: doc.metadata.status,
            ementa: doc.metadata.ementa,
            macroTema: doc.metadata.macroTema,
            urlOriginal: doc.metadata.urlOriginal,
            urlPdfOriginal: doc.metadata.urlPdfOriginal,
            totalChunks: doc.totalChunks,
            tokensEstimados: doc.tokensCount,
            chunks: doc.chunks,
          });
        }

        if (options.dryRun) {
          totalProcessed++;
          totalCreated++;
          return;
        }

        const combinedTags = Array.from(
          new Set([
            doc.metadata.orgao.toUpperCase(),
            doc.metadata.tipo.toUpperCase(),
            `ANO_${doc.metadata.ano}`,
            doc.metadata.status.toUpperCase(),
            ...(doc.metadata.macroTema ? [doc.metadata.macroTema.toUpperCase()] : []),
            'RAG_READY',
            'LOCAL_INGESTION',
          ])
        );

        const cleanMarkdown = buildRagMarkdown(doc);

        // 1. Persistência na coleção 'norms' (mestre)
        let normDbId = '';
        const existingNorm = await (prisma as any).norm.findUnique({
          where: { normId: doc.metadata.id },
        });

        if (existingNorm) {
          normDbId = existingNorm.id;
          if (options.force) {
            await (prisma as any).norm.update({
              where: { id: existingNorm.id },
              data: {
                idNormaCfm: doc.metadata.idNormaCfm,
                orgao: doc.metadata.orgao,
                tipo: doc.metadata.tipo,
                numero: doc.metadata.numero,
                ano: doc.metadata.ano,
                status: doc.metadata.status,
                dataPublicacao: doc.metadata.dataPublicacao,
                ementaOriginal: doc.metadata.ementaOriginal,
                ementaHigienizada: doc.metadata.ementa,
                macroTema: doc.metadata.macroTema,
                urlOriginal: doc.metadata.urlOriginal,
                urlPdfOriginal: doc.metadata.urlPdfOriginal,
                filePathOriginal: doc.filePath,
                sha256Original: doc.metadata.sha256Conteudo,
                conteudoOriginalBruto: doc.rawFileContent,
                conteudoHigienizado: doc.cleanContent,
                cleanMarkdown,
                totalChunks: doc.totalChunks,
                tokensEstimados: doc.tokensCount,
                tags: combinedTags,
                metadadosRAG: JSON.stringify(doc.ragMetadata),
              },
            });

            await (prisma as any).normChunk.deleteMany({
              where: { normId: normDbId },
            });
            totalUpdated++;
          } else {
            totalSkipped++;
          }
        } else {
          const createdNorm = await (prisma as any).norm.create({
            data: {
              normId: doc.metadata.id,
              idNormaCfm: doc.metadata.idNormaCfm,
              orgao: doc.metadata.orgao,
              tipo: doc.metadata.tipo,
              numero: doc.metadata.numero,
              ano: doc.metadata.ano,
              status: doc.metadata.status,
              dataPublicacao: doc.metadata.dataPublicacao,
              ementaOriginal: doc.metadata.ementaOriginal,
              ementaHigienizada: doc.metadata.ementa,
              macroTema: doc.metadata.macroTema,
              urlOriginal: doc.metadata.urlOriginal,
              urlPdfOriginal: doc.metadata.urlPdfOriginal,
              filePathOriginal: doc.filePath,
              sha256Original: doc.metadata.sha256Conteudo,
              conteudoOriginalBruto: doc.rawFileContent,
              conteudoHigienizado: doc.cleanContent,
              cleanMarkdown,
              totalChunks: doc.totalChunks,
              tokensEstimados: doc.tokensCount,
              tags: combinedTags,
              metadadosRAG: JSON.stringify(doc.ragMetadata),
            },
          });
          normDbId = createdNorm.id;
          totalCreated++;
        }

        // 2. Persistência na coleção 'norms_chunk' com vetores de embedding
        if ((!existingNorm || options.force) && normDbId && doc.chunks.length > 0) {
          const chunkRecords = doc.chunks.map((chunkContent, idx) => ({
            normId: normDbId,
            normCode: doc.metadata.id,
            chunkIndex: idx + 1,
            totalChunks: doc.totalChunks,
            conteudoChunk: chunkContent,
            tokensEstimados: Math.ceil(chunkContent.length / 4),
            caracteresCount: chunkContent.length,
            contextoSemantico: doc.ragMetadata.contextoSemantico,
            overlapTokens: options.overlapTokens,
            maxChunkTokens: options.maxChunkTokens,
            embedding: generateDeterministicEmbedding(chunkContent, 768),
            tags: combinedTags,
          }));

          await (prisma as any).normChunk.createMany({
            data: chunkRecords,
          });
        }

        totalProcessed++;
      } catch (err: any) {
        totalErrors++;
        console.error(`❌ Erro processando ${filePath}:`, err?.message || err);
      }
    });

    await Promise.all(promises);

    const batchDuration = (Date.now() - batchStartTime) / 1000;
    const progressPct = (((batchIdx + 1) / totalBatches) * 100).toFixed(1);
    console.log(
      `✅ Lote ${batchIdx + 1}/${totalBatches} concluído em ${batchDuration.toFixed(2)}s | Progresso: ${progressPct}% | Chunks acumulados: ${totalChunksGenerated}`
    );
  }

  if (options.saveJson && exportedDocs.length > 0) {
    const jsonPath = path.resolve(process.cwd(), options.saveJson);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(exportedDocs, null, 2), 'utf-8');
    console.log(`\n💾 Exportação JSON salva com sucesso em: ${jsonPath}`);
  }

  const totalTimeSeconds = (Date.now() - startTime) / 1000;
  const docsPerSec = (totalProcessed / Math.max(0.001, totalTimeSeconds)).toFixed(1);

  console.log('\n' + '='.repeat(80));
  console.log('📊 [RELATÓRIO FINAL DE INGESTÃO E CHUNKING RAG]');
  console.log('='.repeat(80));
  console.log(`📁 Total de arquivos escaneados : ${files.length}`);
  console.log(`✅ Documentos processados       : ${totalProcessed}`);
  console.log(`✨ Novos inseridos em 'norms'   : ${totalCreated}`);
  console.log(`🔄 Atualizados (--force)        : ${totalUpdated}`);
  console.log(`⏭️  Pulados (Já existentes)     : ${totalSkipped}`);
  console.log(`🧱 Total Chunks em 'norms_chunk': ${totalChunksGenerated}`);
  console.log(`❌ Falhas / Erros de parsing    : ${totalErrors}`);
  console.log(`⏱️  Tempo Total de Execução      : ${totalTimeSeconds.toFixed(2)}s (${docsPerSec} docs/s)`);
  console.log('='.repeat(80) + '\n');
}

// Execução direta via CLI
if (process.argv[1] && process.argv[1].includes('simulate-scrap-cfm-normas')) {
  const options = parseCommandLineArgs(process.argv);
  const action = options.checkDb ? checkSavedVersionsInDb() : runIngestion(options);

  action
    .catch((err) => {
      console.error('💥 Erro fatal no executor de normas:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
