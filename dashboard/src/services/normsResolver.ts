import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { getRedisConnection } from '../config/redis.js';
import { NORMS_CATALOG, NormChunk } from '../data/normsCatalog.js';
import { cosineSimilarity, SemanticEmbeddingService } from './semanticEmbeddingService.js';

const DEFAULT_MAX_RAG_CANDIDATE_CHUNKS = 10000;
const DEFAULT_RAG_TOP_K = 8;

export interface NormRetrievalResult {
  norms: ResolvedNorm[];
  status:
    | 'READY'
    | 'NO_SCOPE'
    | 'NO_MATCH'
    | 'UNINDEXED'
    | 'EMBEDDING_UNAVAILABLE'
    | 'CANDIDATE_LIMIT_EXCEEDED';
  candidatesCount: number;
  source?:
    | 'MongoDB (norms/norms_chunk)'
    | 'NORMS_CATALOG'
    | 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]'
    | 'NORMS_CATALOG [Fallback Léxico/Tags]';
  diagnostics?: NormRetrievalDiagnostics;
}

export interface NormRetrievalDiagnostics {
  expectedEmbeddingModel: string;
  activeChunksCount: number;
  indexedChunksCount: number;
  missingEmbeddingCount: number;
  invalidDimensionCount: number;
  modelMismatchCount: number;
  missingModelMetadataCount: number;
  missingNormParentCount: number;
}

export interface CanonicalNormIdentifier {
  authority: 'CFM' | 'ANS' | 'ANVISA' | 'LGPD' | 'LEI_FEDERAL' | 'OUTRO';
  type: 'RESOLUCAO' | 'LEI' | 'DECRETO' | 'PORTARIA' | 'INSTRUCAO_NORMATIVA';
  number: string;
  year?: number;
  article?: string;
  isRevoked: boolean;
}

export function parseCanonicalIdentifier(codeOrTitle: string, tags: string[] = []): CanonicalNormIdentifier {
  const text = `${codeOrTitle} ${tags.join(' ')}`.toUpperCase();
  let authority: CanonicalNormIdentifier['authority'] = 'OUTRO';
  if (text.includes('CFM')) authority = 'CFM';
  else if (text.includes('ANS')) authority = 'ANS';
  else if (text.includes('ANVISA')) authority = 'ANVISA';
  else if (text.includes('LGPD') || text.includes('13.709') || text.includes('13709')) authority = 'LGPD';
  else if (text.includes('LEI')) authority = 'LEI_FEDERAL';

  let type: CanonicalNormIdentifier['type'] = 'RESOLUCAO';
  if (text.includes('LEI')) type = 'LEI';
  else if (text.includes('DECRETO')) type = 'DECRETO';
  else if (text.includes('PORTARIA')) type = 'PORTARIA';

  const numMatch = codeOrTitle.match(/(?:N[ºo°]?\s*|RES(?:OLUÇÃO)?\.?\s*|LEI\s*)?([0-9]{1,5}(?:\.[0-9]{3})?)(?:\/|-)?([0-9]{2,4})?/i);
  const number = numMatch ? numMatch[1].replace('.', '') : '0';
  const year = numMatch && numMatch[2] ? (numMatch[2].length === 2 ? 2000 + parseInt(numMatch[2], 10) : parseInt(numMatch[2], 10)) : undefined;

  // T31: Vigência canônica fundamentada em identificação formal de normas extintas ou tags explícitas de metadados
  const isExplicitlyRevokedTag = tags.some((t) => {
    const upper = t.trim().toUpperCase();
    return upper === 'REVOGADO' || upper === 'REVOGADA' || upper === 'STATUS:REVOGADA';
  });
  const isKnownRevokedNorm = authority === 'CFM' && number === '1974' && (!year || year === 2011);
  const isRevoked = isExplicitlyRevokedTag || isKnownRevokedNorm;

  return { authority, type, number, year, isRevoked };
}

export interface ResolvedNorm {
  id: string;
  normCode: string;
  source: string;
  title: string;
  content: string;
  tags: string[];
  article?: string;
  severityDefault?: string;
  canonical?: CanonicalNormIdentifier;
  relevanceScore?: number;
}

interface RankedNormCandidate {
  norm: ResolvedNorm;
  embedding: number[];
  normalizedSearchText?: string;
  lowerTags?: string[];
}

const LEXICAL_STOP_WORDS = new Set([
  'para', 'com', 'uma', 'uns', 'umas', 'dos', 'das', 'que', 'por', 'como', 'sobre',
  'entre', 'sem', 'sua', 'seu', 'nas', 'nos', 'mais', 'pelo', 'pela', 'esta', 'este',
  'the', 'and', 'for', 'with', 'from', 'this', 'that',
]);

function parseChunkMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractQueryTerms(query: string): string[] {
  return Array.from(new Set(normalizeText(query).match(/[a-z0-9]{4,}/g) || []))
    .filter((term) => !LEXICAL_STOP_WORDS.has(term))
    .slice(0, 100);
}

function lexicalScoreFromTerms(queryTerms: string[], normalizedContent: string): number {
  if (queryTerms.length === 0 || !normalizedContent) {
    return 0;
  }
  let matched = 0;
  for (let i = 0; i < queryTerms.length; i++) {
    if (normalizedContent.includes(queryTerms[i])) {
      matched++;
    }
  }
  return matched / queryTerms.length;
}

function rankCandidates(
  candidates: RankedNormCandidate[],
  queryText: string,
  queryEmbedding: number[],
  topK: number,
  targetTags: string[] = []
): ResolvedNorm[] {
  const normalizedTargetTags = new Set(targetTags.map((t) => t.toLowerCase().trim()));
  const queryTerms = extractQueryTerms(queryText);
  const hasSemantic = queryEmbedding.length > 0;
  return candidates
    .map(({ norm, embedding, normalizedSearchText, lowerTags }) => {
      const semanticScore = hasSemantic ? Math.max(0, cosineSimilarity(queryEmbedding, embedding)) : 0;
      const contentNorm = normalizedSearchText ?? normalizeText(`${norm.title}\n${norm.content}`);
      const lexical = lexicalScoreFromTerms(queryTerms, contentNorm);
      const normTagsLower = lowerTags ?? norm.tags.map((t) => t.toLowerCase().trim());
      let tagMatches = 0;
      for (let i = 0; i < normTagsLower.length; i++) {
        if (normalizedTargetTags.has(normTagsLower[i])) {
          tagMatches++;
        }
      }
      const tagBonus = tagMatches > 0 ? Math.min(0.20, tagMatches * 0.05) : 0;
      const combinedScore = hasSemantic
        ? semanticScore * 0.70 + lexical * 0.20 + tagBonus
        : lexical * 0.70 + tagBonus + (tagMatches > 0 ? 0.10 : 0.01);
      return {
        ...norm,
        relevanceScore: Number(combinedScore.toFixed(4)),
      };
    })
    .sort((left, right) => (right.relevanceScore || 0) - (left.relevanceScore || 0))
    .slice(0, topK);
}

interface CandidateChunkRow {
  id: string;
  normId: string;
  normCode: string;
  chunkIndex: number;
  conteudoChunk: string;
  contextoSemantico: string | null;
  embedding: number[];
  tags: string[];
}

const VECTOR_SEARCH_RETRY_AFTER_MS = 10 * 60 * 1000;
let vectorSearchUnavailableUntil = 0;

function ejsonId(value: unknown): string {
  if (value && typeof value === 'object' && '$oid' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).$oid);
  }
  return String(value ?? '');
}

function ejsonNumber(value: unknown): number {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Number(obj.$numberDouble ?? obj.$numberInt ?? obj.$numberLong ?? obj.$numberDecimal ?? NaN);
  }
  return Number(value);
}

/**
 * Busca vetorial nativa no MongoDB Atlas ($vectorSearch) restrita às normas vigentes do escopo.
 * Retorna null quando desabilitada, indisponível (ex: Mongo não-Atlas, índice ausente) ou sem resultados,
 * para que o chamador use a busca por força bruta em memória.
 */
export async function searchChunksWithAtlasVector(
  queryEmbedding: number[],
  normIds: string[],
  topK: number
): Promise<CandidateChunkRow[] | null> {
  if (env.RAG_VECTOR_SEARCH_ENABLED !== 'true' || queryEmbedding.length === 0 || normIds.length === 0) {
    return null;
  }
  if (Date.now() < vectorSearchUnavailableUntil) {
    return null;
  }
  try {
    const limit = Math.min(200, topK * 8);
    const docs = (await prisma.normChunk.aggregateRaw({
      pipeline: [
        {
          $vectorSearch: {
            index: env.RAG_VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: Math.min(10000, limit * 20),
            limit,
            filter: { normId: { $in: normIds.map((id) => ({ $oid: id })) } },
          },
        },
        {
          $project: {
            normId: 1,
            normCode: 1,
            chunkIndex: 1,
            conteudoChunk: 1,
            contextoSemantico: 1,
            embedding: 1,
            tags: 1,
          },
        },
      ],
    })) as unknown as Array<Record<string, unknown>>;

    if (!Array.isArray(docs) || docs.length === 0) {
      return null;
    }
    return docs.map((doc) => ({
      id: ejsonId(doc._id),
      normId: ejsonId(doc.normId),
      normCode: String(doc.normCode ?? ''),
      chunkIndex: ejsonNumber(doc.chunkIndex),
      conteudoChunk: String(doc.conteudoChunk ?? ''),
      contextoSemantico: typeof doc.contextoSemantico === 'string' ? doc.contextoSemantico : null,
      embedding: Array.isArray(doc.embedding) ? doc.embedding.map(ejsonNumber) : [],
      tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    }));
  } catch (error) {
    vectorSearchUnavailableUntil = Date.now() + VECTOR_SEARCH_RETRY_AFTER_MS;
    console.warn(
      `⚠️ [NormsResolver] Atlas $vectorSearch indisponível (${
        error instanceof Error ? error.message : String(error)
      }). Usando busca vetorial em memória por ${VECTOR_SEARCH_RETRY_AFTER_MS / 60000} min.`
    );
    return null;
  }
}

interface CorpusSignatureMeta {
  signature: string;
  expectedEmbeddingModel: string;
  vigenteNormsCount: number;
  totalChunksCount: number;
  indexedChunksCount: number;
  fetchedAt: number;
}

interface ServerSideScoredChunk {
  id: string;
  normId: string;
  normCode: string;
  chunkIndex: number;
  conteudoChunk: string;
  contextoSemantico: string | null;
  tags: string[];
  embeddingLen: number;
  sim: number;
}

const RAG_TOPK_MEMORY_MAX = 250;
const RAG_TOPK_TTL_SECONDS = 3600;
const CORPUS_SIG_TTL_MS = 20_000;
const REDIS_RAG_TOPK_PREFIX = 'conformia:rag:topk:';

let cachedSignatureMeta: CorpusSignatureMeta | null = null;
const ragTopKMemoryCache = new Map<string, { expiresAt: number; result: NormRetrievalResult }>();

function getSafeRagRedis() {
  if (env.NODE_ENV === 'test') return null;
  try {
    const redis = getRedisConnection();
    return redis && redis.status === 'ready' ? redis : null;
  } catch {
    return null;
  }
}

function setRagTopKMemory(key: string, result: NormRetrievalResult): void {
  if (ragTopKMemoryCache.size >= RAG_TOPK_MEMORY_MAX && !ragTopKMemoryCache.has(key)) {
    const oldest = ragTopKMemoryCache.keys().next().value;
    if (oldest) ragTopKMemoryCache.delete(oldest);
  }
  ragTopKMemoryCache.set(key, {
    expiresAt: Date.now() + RAG_TOPK_TTL_SECONDS * 1000,
    result,
  });
}

async function getCorpusSignatureFast(): Promise<CorpusSignatureMeta> {
  const now = Date.now();
  const expectedModel = SemanticEmbeddingService.embeddingModelId;
  if (
    cachedSignatureMeta &&
    cachedSignatureMeta.expectedEmbeddingModel === expectedModel &&
    now - cachedSignatureMeta.fetchedAt < CORPUS_SIG_TTL_MS
  ) {
    return cachedSignatureMeta;
  }

  const [vigenteNormsCount, latestNorm, totalChunksCount, indexedCountRes] = await Promise.all([
    prisma.norm.count({ where: { status: 'VIGENTE' } }),
    prisma.norm.findFirst({
      where: { status: 'VIGENTE' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, updatedAt: true },
    }),
    prisma.normChunk.count(),
    prisma
      .$runCommandRaw({
        count: 'norms_chunk',
        query: { 'embedding.0': { $exists: true } },
      })
      .catch(() => null),
  ]);

  const indexedChunksCount =
    indexedCountRes && typeof indexedCountRes === 'object' && 'n' in (indexedCountRes as any)
      ? Math.max(0, ejsonNumber((indexedCountRes as any).n))
      : 0;

  const signature = `${expectedModel}|${vigenteNormsCount}|${latestNorm?.id || 'none'}|${latestNorm?.updatedAt?.toISOString() || '0'}|${totalChunksCount}|${indexedChunksCount}`;
  cachedSignatureMeta = {
    signature,
    expectedEmbeddingModel: expectedModel,
    vigenteNormsCount,
    totalChunksCount,
    indexedChunksCount,
    fetchedAt: now,
  };
  return cachedSignatureMeta;
}

function parseServerSideShortlistDocs(docs: unknown): ServerSideScoredChunk[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((doc: any) => ({
    id: ejsonId(doc._id),
    normId: ejsonId(doc.normId),
    normCode: String(doc.normCode ?? ''),
    chunkIndex: ejsonNumber(doc.chunkIndex),
    conteudoChunk: String(doc.conteudoChunk ?? ''),
    contextoSemantico: typeof doc.contextoSemantico === 'string' ? doc.contextoSemantico : null,
    tags: Array.isArray(doc.tags) ? doc.tags.map(String) : [],
    embeddingLen: doc.embeddingLen !== undefined ? ejsonNumber(doc.embeddingLen) : SemanticEmbeddingService.vectorDimensions,
    sim: doc.sim !== undefined ? ejsonNumber(doc.sim) : 0,
  }));
}

async function queryServerSideVectorShortlist(
  queryEmbedding: number[],
  searchTags: string[],
  shortlistLimit: number
): Promise<ServerSideScoredChunk[]> {
  // 1º estágio: Índice HNSW nativo do MongoDB Atlas ($vectorSearch) sem retornar o campo embedding (~80ms)
  if (env.RAG_VECTOR_SEARCH_ENABLED === 'true' && Date.now() >= vectorSearchUnavailableUntil) {
    try {
      const vectorDocs = await prisma.normChunk.aggregateRaw({
        pipeline: [
          {
            $vectorSearch: {
              index: env.RAG_VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: Math.min(2000, shortlistLimit * 16),
              limit: shortlistLimit,
              filter: { tags: { $in: searchTags } },
            },
          },
          {
            $project: {
              normId: 1,
              normCode: 1,
              chunkIndex: 1,
              conteudoChunk: 1,
              contextoSemantico: 1,
              tags: 1,
              embeddingLen: { $size: '$embedding' },
              sim: { $meta: 'vectorSearchScore' },
            },
          },
        ],
      });
      const parsed = parseServerSideShortlistDocs(vectorDocs);
      if (parsed.length > 0) {
        return parsed;
      }
    } catch (err) {
      vectorSearchUnavailableUntil = Date.now() + 60_000;
      console.warn(
        `⚠️ [NormsResolver] Atlas $vectorSearch indisponível ou em indexação (${
          err instanceof Error ? err.message : String(err)
        }). Executando cálculo vetorial Server-Side ($reduce) sem tráfego de vetores.`
      );
    }
  }

  // 2º estágio: Cálculo de similaridade em bloco DENTRO do servidor MongoDB ($reduce) sem trafegar embeddings (~1.2s)
  const buildReducePipeline = (matchStage: Record<string, any>) => [
    { $match: matchStage },
    {
      $project: {
        normId: 1,
        normCode: 1,
        chunkIndex: 1,
        conteudoChunk: 1,
        contextoSemantico: 1,
        tags: 1,
        embeddingLen: { $size: '$embedding' },
        sim: {
          $cond: [
            { $eq: [{ $size: '$embedding' }, queryEmbedding.length] },
            {
              $reduce: {
                input: { $range: [0, queryEmbedding.length] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    {
                      $multiply: [
                        { $arrayElemAt: ['$embedding', '$$this'] },
                        { $arrayElemAt: [queryEmbedding, '$$this'] },
                      ],
                    },
                  ],
                },
              },
            },
            -1,
          ],
        },
      },
    },
    { $sort: { sim: -1 } },
    { $limit: shortlistLimit },
  ];

  const byChunkTags = parseServerSideShortlistDocs(
    await prisma.normChunk.aggregateRaw({
      pipeline: buildReducePipeline({
        'embedding.0': { $exists: true },
        tags: { $in: searchTags },
      }),
    })
  );
  if (byChunkTags.length > 0) {
    return byChunkTags;
  }

  // Caso as tags estejam apenas no documento pai (norms), filtra pelos IDs das normas vigentes correspondentes
  const matchingNorms = await prisma.norm.findMany({
    where: {
      status: 'VIGENTE',
      tags: { hasSome: searchTags },
    },
    select: { id: true },
    take: 500,
  });
  if (matchingNorms.length === 0) {
    return [];
  }

  return parseServerSideShortlistDocs(
    await prisma.normChunk.aggregateRaw({
      pipeline: buildReducePipeline({
        'embedding.0': { $exists: true },
        normId: { $in: matchingNorms.map((n) => ({ $oid: n.id })) },
      }),
    })
  );
}

async function retrieveRelevantByServerSideBlocks(
  cleanTags: string[],
  searchTags: string[],
  queryText: string,
  safeTopK: number
): Promise<NormRetrievalResult | null> {
  if (
    env.NODE_ENV === 'test' ||
    typeof (prisma as any).$runCommandRaw !== 'function' ||
    typeof (prisma.normChunk as any)?.aggregateRaw !== 'function' ||
    typeof (prisma.norm as any)?.count !== 'function' ||
    typeof (prisma.norm as any)?.findFirst !== 'function'
  ) {
    return null;
  }

  const sig = await getCorpusSignatureFast();
  if (sig.vigenteNormsCount === 0) {
    return null; // Sem normas no MongoDB -> permite fallback para NORMS_CATALOG
  }

  const baseDiagnostics: NormRetrievalDiagnostics = {
    expectedEmbeddingModel: sig.expectedEmbeddingModel,
    activeChunksCount: sig.totalChunksCount,
    indexedChunksCount: sig.indexedChunksCount,
    missingEmbeddingCount: Math.max(0, sig.totalChunksCount - sig.indexedChunksCount),
    invalidDimensionCount: 0,
    modelMismatchCount: 0,
    missingModelMetadataCount: 0,
    missingNormParentCount: 0,
  };

  if (sig.indexedChunksCount === 0) {
    return {
      norms: [],
      status: 'UNINDEXED',
      candidatesCount: sig.totalChunksCount,
      diagnostics: baseDiagnostics,
    };
  }

  const querySlice = queryText.slice(0, 8000);
  const sortedTagsKey = [...cleanTags].sort().join(',');
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${sig.signature}\0${sortedTagsKey}\0${safeTopK}\0${querySlice}`, 'utf8')
    .digest('hex');

  // Camada L1: Memória (~0.1ms)
  const memHit = ragTopKMemoryCache.get(cacheKey);
  if (memHit) {
    if (memHit.expiresAt > Date.now()) {
      return memHit.result;
    }
    ragTopKMemoryCache.delete(cacheKey);
  }

  // Camada L2: Redis (~3ms, persiste entre restarts dos containers api/worker)
  const redis = getSafeRagRedis();
  const redisKey = `${REDIS_RAG_TOPK_PREFIX}${cacheKey}`;
  if (redis) {
    try {
      const raw = await Promise.race([
        redis.get(redisKey),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 400)),
      ]);
      if (raw) {
        const parsed = JSON.parse(raw) as NormRetrievalResult;
        if (parsed && Array.isArray(parsed.norms)) {
          setRagTopKMemory(cacheKey, parsed);
          return parsed;
        }
      }
    } catch {
      // Ignora indisponibilidade do Redis
    }
  }

  const shortlistLimit = Math.min(40, Math.max(16, safeTopK * 4));
  let shortlist: ServerSideScoredChunk[] = [];
  let usedLexicalFallback = false;

  try {
    const queryEmbedding = await SemanticEmbeddingService.embedQuery(querySlice);
    shortlist = await queryServerSideVectorShortlist(queryEmbedding, searchTags, shortlistLimit);
  } catch (embErr) {
    usedLexicalFallback = true;
    console.warn(
      `⚠️ [NormsResolver] Embedding indisponível (${
        embErr instanceof Error ? embErr.message : String(embErr)
      }). Executando shortlist léxica Server-Side sem tráfego de vetores.`
    );
    const lexRes = (await prisma.$runCommandRaw({
      find: 'norms_chunk',
      filter: {
        'embedding.0': { $exists: true },
        tags: { $in: searchTags },
      },
      limit: 160,
      batchSize: 160,
      singleBatch: true,
      projection: {
        _id: 1,
        normId: 1,
        normCode: 1,
        chunkIndex: 1,
        conteudoChunk: 1,
        contextoSemantico: 1,
        tags: 1,
      },
    })) as any;
    shortlist = parseServerSideShortlistDocs(lexRes?.cursor?.firstBatch || []);
  }

  if (shortlist.length === 0) {
    return {
      norms: [],
      status: usedLexicalFallback ? 'EMBEDDING_UNAVAILABLE' : 'NO_MATCH',
      candidatesCount: sig.indexedChunksCount,
      diagnostics: baseDiagnostics,
    };
  }

  // Busca metadados APENAS das normas-pai presentes na shortlist (~5 a 20 documentos leves, < 15ms)
  const uniqueNormIds = Array.from(new Set(shortlist.map((c) => c.normId).filter(Boolean)));
  const parentNorms = await prisma.norm.findMany({
    where: {
      id: { in: uniqueNormIds },
      status: 'VIGENTE',
    },
    select: {
      id: true,
      normId: true,
      orgao: true,
      status: true,
      ementaHigienizada: true,
      tags: true,
    },
  });
  const parentById = new Map(parentNorms.map((n) => [n.id, n]));

  const normalizedTargetTags = new Set(cleanTags);
  const queryTerms = extractQueryTerms(querySlice);
  const diagnostics: NormRetrievalDiagnostics = { ...baseDiagnostics };
  const scoredNorms: ResolvedNorm[] = [];

  for (const chunk of shortlist) {
    if (
      !chunk.conteudoChunk.trim() ||
      (chunk.tags || []).some((tag) => tag.toUpperCase().includes('REVOGAD'))
    ) {
      continue;
    }
    const parent = parentById.get(chunk.normId);
    if (!parent) {
      continue;
    }
    if ((parent.tags || []).some((t) => t.trim().toUpperCase().includes('REVOGAD'))) {
      continue;
    }

    const metadata = parseChunkMetadata(chunk.contextoSemantico);
    if (chunk.embeddingLen !== SemanticEmbeddingService.vectorDimensions) {
      diagnostics.invalidDimensionCount += 1;
      continue;
    }
    if (
      typeof metadata.embedding_model === 'string' &&
      metadata.embedding_model !== 'PENDING_REINDEX' &&
      metadata.embedding_model !== sig.expectedEmbeddingModel
    ) {
      diagnostics.modelMismatchCount += 1;
      continue;
    }

    const heading =
      typeof metadata.heading_context === 'string'
        ? metadata.heading_context
        : parent.ementaHigienizada || parent.normId;
    const article =
      typeof metadata.article === 'string' ? metadata.article : `Chunk ${chunk.chunkIndex}`;
    const title =
      typeof metadata.norm_title === 'string'
        ? metadata.norm_title
        : parent.ementaHigienizada || parent.normId;
    const fullTitle = `${title} — ${heading}`;
    const resolvedTags = chunk.tags.length > 0 ? chunk.tags : parent.tags;

    const lexical = lexicalScoreFromTerms(queryTerms, normalizeText(`${fullTitle}\n${chunk.conteudoChunk}`));
    const tagMatches = resolvedTags.filter((t) => normalizedTargetTags.has(t.toLowerCase().trim())).length;
    const tagBonus = tagMatches > 0 ? Math.min(0.20, tagMatches * 0.05) : 0;
    const semanticScore = usedLexicalFallback ? 0 : Math.max(0, Number.isFinite(chunk.sim) ? chunk.sim : 0);
    const combinedScore = !usedLexicalFallback
      ? semanticScore * 0.70 + lexical * 0.20 + tagBonus
      : lexical * 0.70 + tagBonus + (tagMatches > 0 ? 0.10 : 0.01);

    scoredNorms.push({
      id: chunk.id,
      normCode: parent.normId,
      source: parent.orgao || 'REGULATORIO',
      title: fullTitle,
      article,
      content: chunk.conteudoChunk,
      tags: resolvedTags,
      canonical: parseCanonicalIdentifier(parent.normId, parent.tags),
      relevanceScore: Number(combinedScore.toFixed(4)),
    });
  }

  if (diagnostics.modelMismatchCount > 0 && scoredNorms.length === 0) {
    return {
      norms: [],
      status: 'UNINDEXED',
      candidatesCount: sig.indexedChunksCount,
      diagnostics,
    };
  }

  const ranked = scoredNorms
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, safeTopK);

  const finalResult: NormRetrievalResult = {
    norms: ranked,
    status: ranked.length > 0 ? 'READY' : 'NO_MATCH',
    candidatesCount: sig.indexedChunksCount,
    source: usedLexicalFallback
      ? 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]'
      : 'MongoDB (norms/norms_chunk)',
    diagnostics,
  };

  if (ranked.length > 0) {
    setRagTopKMemory(cacheKey, finalResult);
    if (redis) {
      void Promise.race([
        redis.set(redisKey, JSON.stringify(finalResult), 'EX', RAG_TOPK_TTL_SECONDS),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]).catch(() => {});
    }
  }

  return finalResult;
}

export function resetVectorSearchAvailability(): void {
  vectorSearchUnavailableUntil = 0;
}

export class NormsResolver {
  public static invalidateCache(): void {
    cachedSignatureMeta = null;
    ragTopKMemoryCache.clear();
    const redis = getSafeRagRedis();
    if (redis) {
      void (async () => {
        try {
          let cursor = '0';
          do {
            const [nextCursor, keys] = await redis.scan(
              cursor,
              'MATCH',
              `${REDIS_RAG_TOPK_PREFIX}*`,
              'COUNT',
              100
            );
            cursor = nextCursor;
            if (keys.length > 0) {
              await redis.del(...keys).catch(() => {});
            }
          } while (cursor !== '0');
        } catch {
          // Ignora falha de Redis
        }
      })();
    }
  }

  /**
   * Recupera somente chunks vigentes da taxonomia solicitada e os ranqueia pelo conteúdo auditado.
   */
  public static async retrieveRelevantByTags(
    tags: string[],
    queryText: string,
    topK = DEFAULT_RAG_TOP_K
  ): Promise<NormRetrievalResult> {
    const cleanTags = Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
    if (cleanTags.length === 0) {
      return { norms: [], status: 'NO_SCOPE', candidatesCount: 0 };
    }
    if (!queryText.trim()) {
      return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
    }

    const safeTopK = Math.min(16, Math.max(1, Math.floor(topK)));
    const searchTags = Array.from(new Set(cleanTags.flatMap((tag) => [tag.toUpperCase(), tag])));

    // Opção 4: Processamento Vetorial Server-Side em Bloco ($vectorSearch / $reduce sem tráfego de vetores) + Cache Top-K (Memória + Redis)
    try {
      const serverSideResult = await retrieveRelevantByServerSideBlocks(
        cleanTags,
        searchTags,
        queryText,
        safeTopK
      );
      if (serverSideResult) {
        return serverSideResult;
      }
    } catch (serverErr) {
      console.warn(
        `⚠️ [NormsResolver] Aviso no pipeline Server-Side (${
          serverErr instanceof Error ? serverErr.message : String(serverErr)
        }). Prosseguindo com consulta direta.`
      );
    }

    const dbNorms = await prisma.norm.findMany({
      where: {
        status: 'VIGENTE',
        tags: { hasSome: searchTags },
      },
      select: {
        id: true,
        normId: true,
        orgao: true,
        status: true,
        ementaHigienizada: true,
        tags: true,
      },
    });

    let candidates: RankedNormCandidate[] = [];
    let dbDiagnostics: NormRetrievalDiagnostics | undefined;
    let precomputedQueryEmbedding: number[] | null = null;

    if (dbNorms.length > 0) {
      const maxCandidateChunks = env.RAG_MAX_CANDIDATE_CHUNKS || DEFAULT_MAX_RAG_CANDIDATE_CHUNKS;
      const normById = new Map(dbNorms.map((norm) => [norm.id, norm]));
      let vectorChunks: CandidateChunkRow[] | null = null;
      if (env.RAG_VECTOR_SEARCH_ENABLED === 'true') {
        try {
          precomputedQueryEmbedding = await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
          vectorChunks = await searchChunksWithAtlasVector(
            precomputedQueryEmbedding,
            dbNorms.map((norm) => norm.id),
            safeTopK
          );
          if (vectorChunks) {
            // O shortlist do Atlas não enxerga chunks de outro modelo; checa o escopo inteiro sem carregar vetores
            const scopeMetadata = await prisma.normChunk.findMany({
              where: { normId: { in: dbNorms.map((norm) => norm.id) } },
              take: maxCandidateChunks,
              select: { contextoSemantico: true },
            });
            const hasModelMismatch = scopeMetadata.some(({ contextoSemantico }) => {
              const model = parseChunkMetadata(contextoSemantico).embedding_model;
              return typeof model === 'string' && !model.startsWith('PENDING')
                && model !== SemanticEmbeddingService.embeddingModelId;
            });
            if (hasModelMismatch) {
              vectorChunks = null;
            }
          }
        } catch {
          precomputedQueryEmbedding = null;
        }
      }
      const chunks: CandidateChunkRow[] = vectorChunks ?? await prisma.normChunk.findMany({
        where: { normId: { in: dbNorms.map((norm) => norm.id) } },
        take: maxCandidateChunks,
        select: {
          id: true,
          normId: true,
          normCode: true,
          chunkIndex: true,
          conteudoChunk: true,
          contextoSemantico: true,
          embedding: true,
          tags: true,
        },
      });

      if (chunks.length >= maxCandidateChunks) {
        console.warn(
          `⚠️ [NormsResolver] Grande volume de normas (${chunks.length} chunks). RAG processará os ${maxCandidateChunks} chunks prioritários para manter a auditoria ágil sem interrupção.`
        );
      }

      const activeChunks = chunks.filter(
        (chunk) =>
          chunk.conteudoChunk.trim().length > 0 &&
          !(chunk.tags || []).some((tag) => tag.toUpperCase().includes('REVOGAD'))
      );
      if (activeChunks.length === 0) {
        return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
      }

      const diagnostics: NormRetrievalDiagnostics = {
        expectedEmbeddingModel: SemanticEmbeddingService.embeddingModelId,
        activeChunksCount: activeChunks.length,
        indexedChunksCount: 0,
        missingEmbeddingCount: 0,
        invalidDimensionCount: 0,
        modelMismatchCount: 0,
        missingModelMetadataCount: 0,
        missingNormParentCount: 0,
      };

      candidates = activeChunks.flatMap((chunk) => {
        const parent = normById.get(chunk.normId);
        const metadata = parseChunkMetadata(chunk.contextoSemantico);
        const embedding = Array.isArray(chunk.embedding) ? chunk.embedding : [];
        let isIndexed = true;
        if (!parent) {
          diagnostics.missingNormParentCount += 1;
          isIndexed = false;
        }

        // Chunks pendentes de vetor ou vazios são apenas missingEmbeddingCount (não modelMismatch)
        const isPendingOrEmpty =
          embedding.length === 0 ||
          metadata.embedding_model === 'PENDING_REINDEX';

        if (isPendingOrEmpty) {
          diagnostics.missingEmbeddingCount += 1;
          isIndexed = false;
        } else if (embedding.length !== SemanticEmbeddingService.vectorDimensions) {
          diagnostics.invalidDimensionCount += 1;
          isIndexed = false;
        } else if (typeof metadata.embedding_model !== 'string' || !metadata.embedding_model) {
          diagnostics.missingModelMetadataCount += 1;
          isIndexed = false;
        } else if (metadata.embedding_model !== SemanticEmbeddingService.embeddingModelId) {
          diagnostics.modelMismatchCount += 1;
          isIndexed = false;
        }
        if (!isIndexed || !parent) {
          return [];
        }
        diagnostics.indexedChunksCount += 1;

        const heading = typeof metadata.heading_context === 'string'
          ? metadata.heading_context
          : parent.ementaHigienizada || parent.normId;
        const article = typeof metadata.article === 'string'
          ? metadata.article
          : `Chunk ${chunk.chunkIndex}`;
        const title = typeof metadata.norm_title === 'string'
          ? metadata.norm_title
          : parent.ementaHigienizada || parent.normId;
        return [{
          embedding,
          norm: {
            id: chunk.id,
            normCode: parent.normId,
            source: parent.orgao || 'REGULATORIO',
            title: `${title} — ${heading}`,
            article,
            content: chunk.conteudoChunk,
            tags: chunk.tags.length > 0 ? chunk.tags : parent.tags,
            canonical: parseCanonicalIdentifier(parent.normId, parent.tags),
          },
        }];
      });

      if (diagnostics.indexedChunksCount === 0 || diagnostics.modelMismatchCount > 0) {
        return {
          norms: [],
          status: 'UNINDEXED',
          candidatesCount: activeChunks.length,
          diagnostics,
        };
      }

      if (diagnostics.missingEmbeddingCount > 0) {
        console.warn(
          `⚠️ [NormsResolver] Recuperação RAG resiliente: ${diagnostics.indexedChunksCount}/${activeChunks.length} chunks indexados. ${diagnostics.missingEmbeddingCount} chunks recém-inseridos estão pendentes de vetor. Prosseguindo auditoria com os ${candidates.length} chunks indexados disponíveis.`
        );
      }
      dbDiagnostics = diagnostics;
    } else {
      const localNorms = NORMS_CATALOG.filter((norm) => {
        const isRevoked = norm.validity?.isRevoked === true || norm.id.includes('REVOGADA');
        const matchesTag = cleanTags.some(
          (tag) =>
            norm.source.toLowerCase() === tag ||
            norm.normCode.toLowerCase().includes(tag) ||
            norm.keywords.some((keyword) => keyword.toLowerCase().includes(tag))
        );
        return !isRevoked && matchesTag;
      });
      if (localNorms.length === 0) {
        return { norms: [], status: 'NO_MATCH', candidatesCount: 0 };
      }
      try {
        const localTexts = localNorms.map((norm) => `${norm.title}\n${norm.content}`);
        const embeddings = await SemanticEmbeddingService.embedDocuments(localTexts);
        candidates = localNorms.map((norm, index) => ({
          embedding: embeddings[index],
          norm: {
            id: norm.id,
            normCode: norm.normCode,
            source: norm.source,
            title: norm.title,
            article: norm.article,
            content: norm.content,
            tags: [norm.source.toUpperCase(), ...norm.keywords],
            severityDefault: norm.severityDefault,
            canonical: parseCanonicalIdentifier(norm.normCode, [norm.source, ...norm.keywords]),
          },
        }));
      } catch (error) {
        console.warn(
          `[NormsResolver] Embedding local indisponível; contexto normativo não será ampliado: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          norms: [],
          status: 'EMBEDDING_UNAVAILABLE',
          candidatesCount: localNorms.length,
        };
      }
    }

    try {
      const queryEmbedding = precomputedQueryEmbedding
        ?? await SemanticEmbeddingService.embedQuery(queryText.slice(0, 8000));
      const rankedNorms = rankCandidates(candidates, queryText, queryEmbedding, safeTopK, cleanTags);
      return {
        norms: rankedNorms,
        status: rankedNorms.length > 0 ? 'READY' : 'NO_MATCH',
        candidatesCount: candidates.length,
        source: dbNorms.length > 0 ? 'MongoDB (norms/norms_chunk)' : 'NORMS_CATALOG',
        ...(dbNorms.length > 0 && dbDiagnostics ? { diagnostics: dbDiagnostics } : {}),
      };
    } catch (error) {
      console.warn(
        `⚠️ [NormsResolver] Recuperação semântica via embedding indisponível (${
          error instanceof Error ? error.message : String(error)
        }). Ativando fallback resiliente por relevância léxica e tags sobre os ${candidates.length} chunks disponíveis.`
      );
      if (candidates.length > 0) {
        const rankedNorms = rankCandidates(candidates, queryText, [], safeTopK, cleanTags);
        if (rankedNorms.length > 0) {
          return {
            norms: rankedNorms,
            status: 'READY',
            candidatesCount: candidates.length,
            source: dbNorms.length > 0
              ? 'MongoDB (norms/norms_chunk) [Fallback Léxico/Tags]'
              : 'NORMS_CATALOG [Fallback Léxico/Tags]',
            ...(dbNorms.length > 0 && dbDiagnostics ? { diagnostics: dbDiagnostics } : {}),
          };
        }
      }
      return {
        norms: [],
        status: 'EMBEDDING_UNAVAILABLE',
        candidatesCount: candidates.length,
      };
    }
  }

  /**
   * Resolução Dinâmica de Normas no Banco de Dados (via Tags).
   * Consulta normas vigentes e seus chunks RAG nas coleções `norms` e `norms_chunk`.
   */
  public static async resolveByTags(tags?: string[]): Promise<ResolvedNorm[]> {
    if (!tags || tags.length === 0) {
      // T31: Sem tags informadas, não assume arbitrariamente CFM; retorna array vazio para integridade do escopo
      console.log('🔍 [NormsResolver] Nenhuma tag informada. Escopo regulatório mantido neutro/vazio.');
      return [];
    }

    const cleanTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const searchTags = [
      ...tags.map((t) => t.trim().toUpperCase()),
      ...cleanTags,
    ];

    console.log(`🔍 [NormsResolver] Consultando normas no banco de dados para as tags: ${JSON.stringify(tags)}`);

    const resolved: Map<string, ResolvedNorm> = new Map();

    // 1. Usa os documentos mestres e seus fragmentos semânticos; scraped_pages não compõe o contexto RAG.
    const dbNorms = await prisma.norm.findMany({
      where: {
        status: 'VIGENTE',
        tags: {
          hasSome: searchTags,
        },
      },
      select: {
        id: true,
        normId: true,
        orgao: true,
        status: true,
        ementaHigienizada: true,
        tags: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            conteudoChunk: true,
            tags: true,
          },
        },
      },
    });

    console.log(`📚 [NormsResolver] ${dbNorms.length} normas recuperadas das coleções 'norms' e 'norms_chunk'.`);

    for (const item of dbNorms) {
      const itemTags = item.tags || [];
      const isRevogada = item.status !== 'VIGENTE' || itemTags.some((t) => {
        const upper = t.trim().toUpperCase();
        return upper === 'REVOGADO' || upper.includes('REVOGAD');
      });

      if (isRevogada) {
        console.log(`🚫 [NormsResolver] Norma desconsiderada da auditoria por estar revogada: "${item.normId}".`);
        continue;
      }

      const activeChunks = item.chunks.filter(
        (chunk) =>
          chunk.conteudoChunk.trim().length > 0 &&
          !(chunk.tags || []).some((tag) => tag.trim().toUpperCase().includes('REVOGAD'))
      );
      if (activeChunks.length === 0) {
        continue;
      }

      resolved.set(item.id, {
        id: item.id,
        normCode: item.normId,
        source: item.orgao || 'REGULATORIO',
        title: item.ementaHigienizada || item.normId,
        content: activeChunks.map((chunk) => chunk.conteudoChunk).join('\n\n'),
        tags: itemTags,
        canonical: parseCanonicalIdentifier(item.normId, itemTags),
      });
    }

    const hasDatabaseNorms = resolved.size > 0;

    if (!hasDatabaseNorms) {
      // Fallbacks locais são usados somente quando o banco ainda não contém normas/chunks para as tags.
      for (const chunk of NORMS_CATALOG) {
        const isChunkRevogado = chunk.validity?.isRevoked === true || chunk.id.includes('REVOGADA');
        if (isChunkRevogado) {
          continue;
        }

        const matches = cleanTags.some(
          (t) =>
            chunk.source.toLowerCase() === t ||
            chunk.normCode.toLowerCase().includes(t) ||
            chunk.keywords.some((k) => k.toLowerCase().includes(t))
        );

        if (matches) {
          resolved.set(chunk.id, {
            id: chunk.id,
            normCode: chunk.normCode,
            source: chunk.source,
            title: chunk.title,
            article: chunk.article,
            content: `### ${chunk.normCode} - ${chunk.article}: ${chunk.title}\n\n**Dispositivo:** ${chunk.content}\n\n**Orientação Corretiva:** ${chunk.correctiveGuidance}`,
            tags: [chunk.source.toUpperCase(), ...chunk.keywords],
            severityDefault: chunk.severityDefault,
            canonical: parseCanonicalIdentifier(chunk.normCode, [chunk.source, ...chunk.keywords]),
          });
        }
      }

      // Consulta complementar em arquivos físicos da pasta 'normas/' caso existam.
      try {
        const normasDirs = [
          path.resolve(process.cwd(), 'normas'),
          path.resolve(process.cwd(), '..', 'normas'),
          path.resolve(__dirname, '..', '..', '..', 'normas'),
        ];

        for (const dir of normasDirs) {
          if (fs.existsSync(dir)) {
            const files = this.scanMarkdownFiles(dir);
            for (const filePath of files) {
              const fileName = path.basename(filePath).toLowerCase();
              const matchesTag = cleanTags.some(
                (t) => fileName.includes(t) || filePath.toLowerCase().includes(path.sep + t)
              );
              if (matchesTag) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const isFileRevogado =
                  fileName.includes('revogad') ||
                  fileContent.toLowerCase().includes('revogado expressamente') ||
                  fileContent.toLowerCase().includes('revogada expressamente');
                if (isFileRevogado) {
                  console.log(`🚫 [NormsResolver] Arquivo local ignorado por revogação expressa: ${fileName}`);
                  continue;
                }

                const key = `file:${fileName}`;
                if (!resolved.has(key)) {
                  resolved.set(key, {
                    id: key,
                    normCode: fileName.replace('.md', '').toUpperCase(),
                    source: cleanTags[0]?.toUpperCase() || 'NORMAS_MD',
                    title: fileName,
                    content: fileContent,
                    tags: cleanTags,
                    canonical: parseCanonicalIdentifier(fileName, cleanTags),
                  });
                }
              }
            }
          }
        }
      } catch {
        // Ignorar erros na leitura física
      }
    }

    const result = Array.from(resolved.values());
    console.log(`⚖️ [NormsResolver] Total de ${result.length} normas ativas recuperadas dinamicamente para o contexto.`);
    return result;
  }

  /**
   * C05: Gera um snapshot estruturado das normas vigentes aplicadas na auditoria.
   * Preserva rastreabilidade inalterável das versões, publicações e integridade SHA-256.
   */
  public static createNormsSnapshot(norms: ResolvedNorm[]): string {
    const snapshotItems = norms.map((n) => ({
      id: n.id,
      normCode: n.normCode,
      source: n.source,
      article: n.article || null,
      canonical: n.canonical || null,
      contentLength: n.content?.length || 0,
      contentHash: crypto.createHash('sha256').update(n.content || '', 'utf8').digest('hex'),
      tags: n.tags,
    }));

    return JSON.stringify({
      snapshotGeneratedAt: new Date().toISOString(),
      totalNormsCount: snapshotItems.length,
      norms: snapshotItems,
    });
  }

  private static scanMarkdownFiles(dir: string): string[] {
    let results: string[] = [];
    try {
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of list) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(this.scanMarkdownFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch {
      // pasta inacessível
    }
    return results;
  }
}

export const createNormsSnapshot = NormsResolver.createNormsSnapshot.bind(NormsResolver);

