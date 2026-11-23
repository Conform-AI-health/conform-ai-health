import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NormsResolver } from '../services/normsResolver.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

// Mock do prisma para simular banco de dados sem dependência de conexão externa
vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    normChunk: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    agentModule: {
      findFirst: vi.fn(),
    },
    agentDefinition: {
      findFirst: vi.fn(),
    },
    aiModelConfig: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../services/semanticEmbeddingService.js', () => ({
  cosineSimilarity: vi.fn(() => 0.95),
  SemanticEmbeddingService: {
    modelName: 'gemini-embedding-001',
    vectorDimensions: 768,
    embeddingModelId: 'gemini-embedding-001:768',
    embedQuery: vi.fn(async () => new Array(768).fill(0.1)),
    embedDocuments: vi.fn(async (texts: string[]) => texts.map(() => new Array(768).fill(0.1))),
    resetCircuitBreaker: vi.fn(),
  },
}));

describe('Desacoplamento Normativo Dinâmico & Catálogo Ativo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('NormsResolver', () => {
    it('deve manter o escopo regulatório neutro/vazio quando chamado sem tags (T31)', async () => {
      const resolved = await NormsResolver.resolveByTags([]);
      expect(resolved).toEqual([]);
    });

    it('deve resolver dinamicamente normas para uma tag específica de conselho ou órgão', async () => {
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([
        {
          id: 'cfo-norm-1',
          normId: 'CFO-RES-196-2019',
          orgao: 'CFO',
          status: 'VIGENTE',
          ementaHigienizada: 'Resolução CFO 196/2019',
          tags: ['ODONTOLOGIA', 'CFO'],
          chunks: [{ conteudoChunk: 'Regras de publicidade odontológica.', tags: ['ODONTOLOGIA', 'CFO'] }],
        } as any,
      ]);

      const resolved = await NormsResolver.resolveByTags(['ODONTOLOGIA']);
      expect(resolved.some((n) => n.title.includes('Resolução CFO'))).toBe(true);
      expect(resolved.some((n) => n.content.includes('Regras de publicidade odontológica.'))).toBe(true);
      expect(resolved).toHaveLength(1);
    });

    it('deve propagar falhas ao consultar norms/norms_chunk em vez de mascará-las com fallback', async () => {
      vi.mocked(prisma.norm.findMany).mockRejectedValueOnce(new Error('Banco normativo indisponível'));

      await expect(NormsResolver.resolveByTags(['CFM'])).rejects.toThrow(
        'Banco normativo indisponível'
      );
    });

    it('deve filtrar e expurgar normas revogadas mesmo em novos órgãos cadastrados', async () => {
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([
        {
          id: 'norm-revogada',
          normId: 'ORG-RES-1-2020',
          orgao: 'ORG',
          status: 'REVOGADA',
          ementaHigienizada: 'Norma Antiga Revogada',
          tags: ['SAUDE', 'REVOGADO'],
          chunks: [{ conteudoChunk: 'Texto de norma sem efeito jurídico.', tags: ['REVOGADO'] }],
        } as any,
      ]);

      const resolved = await NormsResolver.resolveByTags(['SAUDE']);
      expect(resolved.some((n) => n.id === 'norm-revogada')).toBe(false);
    });
  });

  describe('ReconciliationEngine - Escopo e recuperação RAG', () => {
    it('deve substituir o placeholder por uma referência ao contexto RAG sem injetar o catálogo integral', async () => {
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.agentModule.findFirst).mockResolvedValueOnce({
        id: 'agent-custom-1',
        name: 'Auditor de Vigilância Geral',
        code: 'vigilancia-geral',
        description: 'Especialista em auditoria sanitária e de dados.',
        tags: ['ANVISA', 'LGPD'],
        regulatoryFramework: 'Vigilância Sanitária e Dados',
        systemPrompt: 'INÍCIO DO PROMPT\nNORMAS:\n{normasVigentesDoEscopo}\nFIM DO PROMPT',
        targetNorms: ['ANVISA', 'LGPD'],
      } as any);

      const context = await ReconciliationEngine.resolveAgentContext('agent-custom-1');
      expect(context.systemPrompt).toContain('INÍCIO DO PROMPT');
      expect(context.systemPrompt).toContain('FIM DO PROMPT');
      expect(context.systemPrompt).not.toContain('{normasVigentesDoEscopo}');
      expect(context.systemPrompt).toContain('NORMAS RECUPERADAS');
      expect(context.activeNorms).toEqual([]);
      expect(context.retrievalStatus).toBe('NO_QUERY');
    });

    it('deve substituir {CONTEUDO_DAS_NORMAS_MD} pelos chunks normativos quando houver normas recuperadas', async () => {
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([
        {
          id: 'norm-cfm-2336',
          normId: 'CFM-RES-2336-2023',
          tipo: 'RESOLUCAO',
          numero: '2336',
          ano: '2023',
          status: 'VIGENTE',
          ementaHigienizada: 'Publicidade médica e redes sociais.',
          tags: ['CFM', 'PUBLICIDADE'],
        } as any,
      ]);

      vi.mocked(prisma.normChunk.findMany).mockResolvedValueOnce([
        {
          id: 'c1',
          normId: 'norm-cfm-2336',
          normCode: 'CFM-RES-2336-2023',
          chunkIndex: 1,
          conteudoChunk: 'Art. 9º É vedado publicar fotos de antes e depois.',
          contextoSemantico: JSON.stringify({
            heading_context: 'Art. 9º',
            embedding_model: SemanticEmbeddingService.embeddingModelId,
          }),
          embedding: new Array(768).fill(0.1),
          tags: ['CFM', 'PUBLICIDADE'],
        } as any,
      ]);

      vi.mocked(prisma.agentModule.findFirst).mockResolvedValueOnce({
        id: 'agent-dermatologico',
        name: 'Dermatológico',
        code: 'dermatologico',
        tags: ['CFM', 'PUBLICIDADE'],
        regulatoryFramework: 'Deontologia CFM',
        systemPrompt: 'Base de Conhecimento Oficial:\n{CONTEUDO_DAS_NORMAS_MD}\nDiretrizes de Análise.',
      } as any);

      const context = await ReconciliationEngine.resolveAgentContext('agent-dermatologico', 'fotos de antes e depois');
      expect(context.systemPrompt).not.toContain('{CONTEUDO_DAS_NORMAS_MD}');
      expect(context.systemPrompt).toContain('Res. CFM 2.336/23');
      expect(context.systemPrompt).toContain('Artigo 14');
      expect(context.systemPrompt).toContain('Antes e Depois');
    });

    it('não deve anexar normas quando o agente não tiver consultado uma página', async () => {
      vi.mocked(prisma.norm.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.agentModule.findFirst).mockResolvedValueOnce({
        id: 'agent-custom-2',
        name: 'Auditor Sem Placeholder',
        code: 'auditor-padrao',
        tags: ['ANS'],
        regulatoryFramework: 'Saúde Suplementar',
        systemPrompt: 'Você é um auditor de planos de saúde.',
      } as any);

      const context = await ReconciliationEngine.resolveAgentContext('agent-custom-2');
      expect(context.systemPrompt).not.toContain('CATÁLOGO NORMATIVO VIGENTE DO ESCOPO:');
      expect(context.systemPrompt).toContain('Você é um auditor de planos de saúde.');
      expect(context.activeNorms).toEqual([]);
    });

    it('deve manter contexto sem normas quando não há agente ou tags de escopo', async () => {
      vi.mocked(prisma.agentDefinition.findFirst).mockResolvedValueOnce(null);

      const fallbackContext = await ReconciliationEngine.resolveAgentContext();
      expect(fallbackContext.name).toBe('Auditor Deontológico ConformIA');
      expect(fallbackContext.activeNorms).toEqual([]);
      expect(fallbackContext.retrievalStatus).toBe('NO_SCOPE');
    });
  });
});
