import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NormController } from '../controllers/normController.js';
import { prisma } from '../config/prisma.js';
import { OllamaTaxonomyService } from '../services/ollamaTaxonomyService.js';
import { AIProviderFactory } from '../services/ai/aiProviderFactory.js';

// Mock do prisma
vi.mock('../config/prisma.js', () => ({
  prisma: {
    norm: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('NormController — Geração de Tags Temáticas via IA (POST /norms/:normId/generate-tags)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar HTTP 404 quando a norma não for encontrada no acervo', async () => {
    vi.mocked(prisma.norm.findFirst).mockResolvedValue(null as any);

    const req: any = {
      params: { normId: 'NORMA-INEXISTENTE' },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await NormController.generateThematicTags(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('não encontrada') })
    );
  });

  it('deve gerar tags via IA com política --clean e persistir no MongoDB com --apply', async () => {
    const mockNorm = {
      id: '507f1f77bcf86cd799439011',
      normId: 'CFM-RES-2472-2026',
      orgao: 'CFM',
      tipo: 'RESOLUCAO',
      numero: '2472',
      ano: '2026',
      ementaHigienizada: 'Homologa a Portaria CME nº 1/2026 sobre especialidades e RQE.',
      cleanMarkdown: 'Conteúdo detalhado das especialidades médicas da CME.',
      tags: ['TAG_ANTIGA_DESATUALIZADA', 'CFM'],
      status: 'VIGENTE',
    };

    vi.mocked(prisma.norm.findFirst).mockResolvedValue(mockNorm as any);

    // Mock do modelo ativo
    vi.spyOn(AIProviderFactory, 'getActiveModelConfig').mockResolvedValue({
      name: 'Ollama Local (Qwen 2.5)',
      provider: 'ollama',
      modelId: 'qwen2.5:7b',
      baseUrl: 'http://localhost:11434',
    } as any);

    // Mock da inferência do OllamaTaxonomyService
    const mockTaxonomyResult = {
      jurisdictionTag: 'CFM',
      normTypeTag: 'RESOLUCAO',
      statusTag: 'VIGENTE' as const,
      macroTema: 'FORMACAO_E_ESPECIALIDADES',
      thematicTags: ['ESPECIALIDADES_MEDICAS', 'RQE', 'COMISSAO_MISTA_DE_ESPECIALIDADES'],
      allTags: ['CFM', 'RESOLUCAO', 'VIGENTE', 'ESPECIALIDADES_MEDICAS', 'RQE', 'COMISSAO_MISTA_DE_ESPECIALIDADES'],
      confidence: 0.98,
      reasoning: 'Classificação temática da relação da CME e registros RQE.',
      provider: 'ollama' as const,
      modelUsed: 'ollama:qwen2.5:7b',
    };

    const inferSpy = vi.spyOn(OllamaTaxonomyService, 'inferTags').mockResolvedValue(mockTaxonomyResult);

    vi.mocked(prisma.norm.update).mockResolvedValue({
      id: mockNorm.id,
      normId: mockNorm.normId,
      tags: mockTaxonomyResult.allTags,
      macroTema: mockTaxonomyResult.macroTema,
      status: mockTaxonomyResult.statusTag,
      updatedAt: new Date(),
    } as any);

    const req: any = {
      params: { normId: 'CFM-RES-2472-2026' },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await NormController.generateThematicTags(req, res, next);

    // Garante que a inferência recebeu currentTags vazio (lógica --clean)
    expect(inferSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        normId: 'CFM-RES-2472-2026',
        currentTags: [], // Limpeza de tags prévias
      }),
      expect.objectContaining({
        baseUrl: 'http://localhost:11434',
        modelId: 'qwen2.5:7b',
      })
    );

    // Garante persistência com update no Prisma (lógica --apply)
    expect(prisma.norm.update).toHaveBeenCalledWith({
      where: { id: mockNorm.id },
      data: {
        tags: mockTaxonomyResult.allTags,
        macroTema: mockTaxonomyResult.macroTema,
        status: mockTaxonomyResult.statusTag,
      },
      select: expect.any(Object),
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        normId: 'CFM-RES-2472-2026',
        macroTema: 'FORMACAO_E_ESPECIALIDADES',
        thematicTags: expect.arrayContaining(['RQE', 'ESPECIALIDADES_MEDICAS']),
      })
    );
  });
});
