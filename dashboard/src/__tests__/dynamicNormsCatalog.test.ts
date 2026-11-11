import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NormsResolver } from '../services/normsResolver.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { prisma } from '../config/prisma.js';
import { NORMS_CATALOG } from '../data/normsCatalog.js';

// Mock do prisma para simular banco de dados sem dependência de conexão externa
vi.mock('../config/prisma.js', () => ({
  prisma: {
    scrapedPage: {
      findMany: vi.fn(),
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
      vi.mocked(prisma.scrapedPage.findMany).mockResolvedValueOnce([
        {
          id: 'cfo-norm-1',
          url: 'https://cfo.org.br/resolucao-196',
          title: 'Resolução CFO 196/2019',
          cleanMarkdown: 'Regras de publicidade odontológica.',
          tags: ['ODONTOLOGIA', 'CFO'],
        } as any,
      ]);

      const resolved = await NormsResolver.resolveByTags(['ODONTOLOGIA']);
      expect(resolved.some((n) => n.title.includes('Resolução CFO'))).toBe(true);
    });

    it('deve filtrar e expurgar normas revogadas mesmo em novos órgãos cadastrados', async () => {
      vi.mocked(prisma.scrapedPage.findMany).mockResolvedValueOnce([
        {
          id: 'norm-revogada',
          url: 'https://orgao.gov.br/norma-antiga',
          title: 'Norma Antiga Revogada',
          cleanMarkdown: 'Texto de norma sem efeito jurídico.',
          tags: ['SAUDE', 'REVOGADO'],
        } as any,
      ]);

      const resolved = await NormsResolver.resolveByTags(['SAUDE']);
      expect(resolved.some((n) => n.id === 'norm-revogada')).toBe(false);
    });
  });

  describe('ReconciliationEngine - Injeção de Contexto {normasVigentesDoEscopo}', () => {
    it('deve substituir o placeholder {normasVigentesDoEscopo} pelo catálogo normativo formatado', async () => {
      vi.mocked(prisma.scrapedPage.findMany).mockResolvedValueOnce([]);
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
      expect(context.systemPrompt).toMatch(/\[.*\]/); // Contém os códigos de norma injetados
    });

    it('deve anexar a seção CATÁLOGO NORMATIVO VIGENTE DO ESCOPO quando o template não tiver o placeholder explícito', async () => {
      vi.mocked(prisma.scrapedPage.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.agentModule.findFirst).mockResolvedValueOnce({
        id: 'agent-custom-2',
        name: 'Auditor Sem Placeholder',
        code: 'auditor-padrao',
        tags: ['ANS'],
        regulatoryFramework: 'Saúde Suplementar',
        systemPrompt: 'Você é um auditor de planos de saúde.',
      } as any);

      const context = await ReconciliationEngine.resolveAgentContext('agent-custom-2');
      expect(context.systemPrompt).toContain('CATÁLOGO NORMATIVO VIGENTE DO ESCOPO:');
      expect(context.systemPrompt).toContain('Você é um auditor de planos de saúde.');
    });

    it('deve fornecer fallback resiliente sem targetNorms engessados quando nenhum agente for especificado', async () => {
      vi.mocked(prisma.agentDefinition.findFirst).mockResolvedValueOnce(null);

      const fallbackContext = await ReconciliationEngine.resolveAgentContext();
      expect(fallbackContext.name).toBe('Auditor Deontológico ConformIA');
      expect(fallbackContext.systemPrompt).toContain('Catálogo Normativo Ativo');
      expect(fallbackContext.systemPrompt).toContain('CATÁLOGO NORMATIVO VIGENTE DO ESCOPO:');
    });
  });
});
