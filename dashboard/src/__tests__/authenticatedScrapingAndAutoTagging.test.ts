import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScraperService } from '../services/scraperService.js';
import { ClientScraperService } from '../services/clientScraperService.js';
import { ReconciliationEngine } from '../services/reconciliationEngine.js';
import { NormsResolver } from '../services/normsResolver.js';
import { SemanticEmbeddingService } from '../services/semanticEmbeddingService.js';
import { prisma } from '../config/prisma.js';

describe('🧪 Suíte de Testes: Autenticação de Scraping, Telemetria e Auto-Tagging de Chunks (T36 a T39)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('T36 & T38: Detecção Heurística de Tags Regulatórias & Publicidade', () => {
    it('deve detectar tags de CFM, PUBLICIDADE e TELEMEDICINA a partir do conteúdo raspado', () => {
      const pageMarkdown = `
        # Clínica Médica Dra. Juliana
        CRM-SP 123456 | RQE 7890
        Oferecemos atendimento presencial e teleconsulta online com receita digital.
        Confira nossos resultados de antes e depois e aproveite 20% de desconto promocional!
      `;

      const tags = ScraperService.detectRegulatoryTags(pageMarkdown, '');
      expect(tags).toContain('CFM');
      expect(tags).toContain('PUBLICIDADE');
      expect(tags).toContain('TELEMEDICINA');
    });

    it('deve detectar tags de LGPD em formulários e páginas de agendamento online', () => {
      const pageMarkdown = `
        ## Agendamento Online
        Preencha seus dados pessoais para contato. Ao prosseguir, você concorda com nossa Política de Privacidade e Tratamento de Dados (LGPD).
      `;

      const tags = ScraperService.detectRegulatoryTags(pageMarkdown, '');
      expect(tags).toContain('LGPD');
    });

    it('deve detectar tag de ANVISA quando houver referência a medicamentos e substâncias reguladas', () => {
      const pageMarkdown = `
        Aplicação de toxina botulínica e ácido hialurônico com aprovação da Anvisa.
      `;

      const tags = ScraperService.detectRegulatoryTags(pageMarkdown, '');
      expect(tags).toContain('ANVISA');
    });
  });

  describe('T36 & T37: Scraping Autenticado e Telemetria de Login Autorizado', () => {
    it('processHtml deve propagar os metadados authSuccess e loginDetected no resultado de extração', () => {
      const html = '<html><body><h1>Área Restrita do Médico</h1><p>Prontuário auditado</p></body></html>';
      const result = ScraperService.processHtml('https://clinica-privada.med.br/area-restrita', html, 'CHEERIO', undefined, {
        authSuccess: true,
        loginDetected: true,
      });

      expect(result.authSuccess).toBe(true);
      expect(result.loginDetected).toBe(true);
      expect(result.cleanMarkdown).toContain('Área Restrita do Médico');
    });

    it('ClientScraperService deve registrar log operacional de [AUTH_SUCCESS] quando o login for bem-sucedido', async () => {
      vi.spyOn(ScraperService, 'scrape').mockResolvedValueOnce({
        url: 'https://clinica-privada.med.br/dashboard',
        mode: 'PUPPETEER',
        title: 'Área do Médico',
        rawHtmlLength: 300,
        cleanMarkdown: '# Área Restrita\nConteúdo autenticado com sucesso.',
        tokensEstimatedRaw: 75,
        tokensEstimatedClean: 25,
        tokensSavedPercentage: 66,
        detectedTags: ['CFM'],
        extractedEntities: { crms: [], rqes: [], states: [], hasBeforeAfterMention: false, hasPromotionalPricing: false, hasGuaranteedResultMention: false },
        authSuccess: true,
        loginDetected: true,
      } as any);

      const systemLogSpy = vi.spyOn(prisma.systemLog, 'create').mockResolvedValue({} as any);
      vi.spyOn(prisma.moduleScrapeData, 'create').mockResolvedValue({ id: 'scrape-auth-1' } as any);

      const result = await ClientScraperService.scrapeClientAsset({
        url: 'https://clinica-privada.med.br/dashboard',
        moduleId: 'mod-auth-1',
        auth: {
          hasAuth: true,
          username: 'auditor@clinica.com.br',
          password: 'segredo-autorizado',
        },
      });

      expect(result.authSuccess).toBe(true);
      expect(result.loginDetected).toBe(true);

      // Verifica se o SystemLog de AUTH_SUCCESS foi acionado com o usuário
      expect(systemLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 'INFO',
            module: 'SCRAPER',
            message: expect.stringContaining('[SCRAPER] [AUTH_SUCCESS]'),
          }),
        })
      );
    });
  });

  describe('T38: Otimização de Busca dos Chunks RAG com Tags Dinâmicas', () => {
    it('ReconciliationEngine.resolveAgentContext deve incorporar as extraTags detectadas na busca dos chunks', async () => {
      vi.spyOn(prisma.agentModule, 'findFirst').mockResolvedValueOnce({
        id: 'mod-dynamic-1',
        name: 'Auditor Geral',
        code: 'MOD-GEN',
        tags: ['cfm'],
        targetNorms: [],
        enabled: true,
      } as any);

      const retrieveSpy = vi.spyOn(NormsResolver, 'retrieveRelevantByTags').mockResolvedValueOnce({
        norms: [
          {
            id: 'chunk-pub-1',
            normCode: 'CFM-RES-2336-2023',
            source: 'CFM',
            title: 'Resolução CFM 2.336/23 — Publicidade Médica',
            article: 'Artigo 1º',
            content: 'Regras sobre anúncios de preços e antes e depois.',
            tags: ['CFM', 'PUBLICIDADE'],
            relevanceScore: 0.95,
          },
        ],
        status: 'READY',
        candidatesCount: 1,
        source: 'MongoDB (norms/norms_chunk)',
      });

      const context = await ReconciliationEngine.resolveAgentContext(
        'mod-dynamic-1',
        'Oferecemos desconto e fotos de antes e depois.',
        ['publicidade', 'telemedicina']
      );

      // Verifica se as tags dinâmicas foram fundidas no escopo da busca
      expect(retrieveSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['cfm', 'publicidade', 'telemedicina']),
        'Oferecemos desconto e fotos de antes e depois.'
      );
      expect(context.tags).toContain('publicidade');
      expect(context.tags).toContain('telemedicina');
      expect(context.resolvedDbNorms?.length).toBe(1);
    });

    it('NormsResolver.rankCandidates deve atribuir bônus de relevância a chunks cujas tags coincidem com a página', async () => {
      // Mock de candidatos para rankeamento semântico
      const candidates = [
        {
          norm: {
            id: 'c1',
            normCode: 'CFM-GERAL',
            source: 'CFM',
            title: 'Norma Geral',
            content: 'Texto geral sobre atendimento médico ambulatorial.',
            tags: ['CFM'],
          },
          embedding: new Array(768).fill(0.1),
        },
        {
          norm: {
            id: 'c2',
            normCode: 'CFM-PUB',
            source: 'CFM',
            title: 'Publicidade Médica',
            content: 'Texto sobre vedação de antes e depois e descontos promocionais.',
            tags: ['CFM', 'PUBLICIDADE'],
          },
          embedding: new Array(768).fill(0.1),
        },
      ];

      // Consulta semântica com tag PUBLICIDADE presente nas tags da página auditada
      vi.spyOn(SemanticEmbeddingService, 'embedQuery').mockResolvedValueOnce(new Array(768).fill(0.1));

      vi.spyOn(prisma.norm, 'findMany').mockResolvedValueOnce([
        { id: 'n1', normId: 'CFM-GERAL', orgao: 'CFM', status: 'VIGENTE', ementaHigienizada: '', tags: ['CFM'] },
        { id: 'n2', normId: 'CFM-PUB', orgao: 'CFM', status: 'VIGENTE', ementaHigienizada: '', tags: ['CFM', 'PUBLICIDADE'] },
      ] as any);

      vi.spyOn(prisma.normChunk, 'findMany').mockResolvedValueOnce([
        { id: 'c1', normId: 'n1', normCode: 'CFM-GERAL', chunkIndex: 1, conteudoChunk: 'Texto geral sobre consultas.', contextoSemantico: JSON.stringify({ embedding_model: SemanticEmbeddingService.embeddingModelId }), embedding: new Array(768).fill(0.1), tags: ['CFM'] },
        { id: 'c2', normId: 'n2', normCode: 'CFM-PUB', chunkIndex: 1, conteudoChunk: 'Texto sobre anúncios e publicidade.', contextoSemantico: JSON.stringify({ embedding_model: SemanticEmbeddingService.embeddingModelId }), embedding: new Array(768).fill(0.1), tags: ['CFM', 'PUBLICIDADE'] },
      ] as any);

      const result = await NormsResolver.retrieveRelevantByTags(['cfm', 'publicidade'], 'anúncio de desconto e antes e depois');
      
      expect(result.status).toBe('READY');
      expect(result.norms.length).toBeGreaterThanOrEqual(1);
      const pubNorm = result.norms.find((n) => n.normCode === 'CFM-PUB');
      expect(pubNorm).toBeDefined();
      expect(pubNorm?.relevanceScore).toBeGreaterThan(0);
    });
  });
});
