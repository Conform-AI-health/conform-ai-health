import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NormsResolver } from '../services/normsResolver.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

// Mock do prisma para simular banco de dados sem dependência de conexão externa
vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
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
