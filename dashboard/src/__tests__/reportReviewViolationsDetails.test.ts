import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportRepository } from '../repositories/reportRepository.js';
import { ReportService } from '../services/reportService.js';
import { ReportController } from '../controllers/reportController.js';
import { prisma } from '../config/prisma.js';

vi.mock('../config/prisma.js', () => ({
  prisma: {
    auditReport: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('⚖️ Revisão de Laudos — Detalhamento de Apontamentos & Violações Regulatórias (@compliance-specialist)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ReportRepository.findMany deve selecionar detectedText, correctiveAdvice e e-mails da clínica', async () => {
    (prisma.auditReport.findMany as any).mockResolvedValue([]);

    await ReportRepository.findMany({
      where: { status: 'COMPLETED' as any },
      includeClient: true,
      includeViolations: true,
    });

    expect(prisma.auditReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          client: expect.objectContaining({
            select: expect.objectContaining({
              email: true,
              users: { select: { email: true } },
            }),
          }),
          violations: expect.objectContaining({
            select: expect.objectContaining({
              id: true,
              severity: true,
              normCode: true,
              normArticle: true,
              detectedText: true,
              correctiveAdvice: true,
              resolved: true,
            }),
          }),
        }),
      })
    );
  });

  it('ReportController.getPendingReview deve retornar os 2 apontamentos com evidência, recomendação, vigência e reconciliação via structuredContract', async () => {
    (prisma.auditReport.count as any).mockResolvedValue(1);
    (prisma.auditReport.findMany as any).mockResolvedValue([
      {
        id: 'rep-review-2v',
        targetUrl: 'https://clinicaestetica.med.br',
        status: 'COMPLETED',
        reviewStatus: 'PENDING_REVIEW',
        auditorReviewed: false,
        verdict: 'NAO_CONFORME',
        score: 45,
        summary: 'Foram identificadas 2 infrações de publicidade médica.',
        normSnapshots: JSON.stringify([
          { normCode: 'Resolução CFM 2.336/2023', status: 'VIGENTE', isRevoked: false },
        ]),
        structuredContract: JSON.stringify({
          audit_id: 'rep-review-2v',
          risk_level: 'CRITICAL',
          confidence: 0.94,
          findings: [
            {
              description: 'Ausência de RQE ao anunciar especialidade médica',
              regulation: 'Resolução CFM 2.336/2023',
              article: 'Art. 4º',
              evidence: 'Especialista em Dermatologia Estética Avançada',
              source_version: '2023',
              recommendation: 'Incluir número do RQE registrado no CRM ao lado da especialidade.',
              requires_human_review: true,
            },
            {
              description: 'Promessa de resultado garantido',
              regulation: 'Resolução CFM 2.336/2023',
              article: 'Art. 14, II',
              evidence: 'Resultado 100% garantido já na primeira sessão!',
              source_version: '2023',
              recommendation: 'Remover expressões superlativas ou promessa de resultado infalível.',
              requires_human_review: true,
            },
          ],
        }),
        violations: [
          {
            id: 'v-1',
            severity: 'CRITICA',
            normCode: 'Resolução CFM 2.336/2023',
            normArticle: 'Art. 4º',
            detectedText: 'Especialista em Dermatologia Estética Avançada',
            correctiveAdvice: 'Incluir número do RQE registrado no CRM ao lado da especialidade.',
            resolved: false,
          },
          {
            id: 'v-2',
            severity: 'GRAVE',
            normCode: 'Resolução CFM 2.336/2023',
            normArticle: 'Art. 14, II',
            // Simula registro parcial hidratado a partir do structuredContract.findings[1]
            detectedText: null,
            correctiveAdvice: null,
            resolved: false,
          },
        ],
        client: {
          id: 'cli-1',
          name: 'Clínica Estética',
          email: 'diretoria@clinicaestetica.med.br',
        },
      },
    ]);

    const req: any = { query: { page: '1', limit: '20' } };
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await ReportController.getPendingReview(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    const returnedViolations = payload.data[0].violations;

    expect(returnedViolations).toHaveLength(2);
    expect(returnedViolations[0]).toEqual(
      expect.objectContaining({
        id: 'v-1',
        severity: 'CRITICA',
        normCode: 'Resolução CFM 2.336/2023',
        normArticle: 'Art. 4º',
        detectedText: 'Especialista em Dermatologia Estética Avançada',
        correctiveAdvice: 'Incluir número do RQE registrado no CRM ao lado da especialidade.',
        validityStatus: 'VIGENTE',
        requiresHumanReview: true,
      })
    );
    expect(returnedViolations[1]).toEqual(
      expect.objectContaining({
        id: 'v-2',
        severity: 'GRAVE',
        detectedText: 'Resultado 100% garantido já na primeira sessão!',
        correctiveAdvice: 'Remover expressões superlativas ou promessa de resultado infalível.',
        description: 'Promessa de resultado garantido',
        validityStatus: 'VIGENTE',
        requiresHumanReview: true,
      })
    );
  });

  it('ReportService.exportMarkdown deve exportar o trecho de evidência, vigência e recomendação corretiva reais', async () => {
    (prisma.auditReport.findUnique as any).mockResolvedValue({
      id: 'rep-export-999999',
      targetUrl: 'https://clinicaexemplo.med.br',
      createdAt: new Date('2026-11-26T12:00:00Z'),
      verdict: 'PARCIALMENTE_CONFORME',
      score: 70,
      status: 'COMPLETED',
      summary: 'Laudo com 1 apontamento.',
      client: { name: 'Clínica Exemplo', crmResponsavel: '12345', crmUf: 'SP' },
      violations: [
        {
          id: 'v-exp-1',
          severity: 'GRAVE',
          normCode: 'LGPD (Lei 13.709/2018)',
          normArticle: 'Art. 11',
          detectedText: 'Formulário coleta histórico clínico sem termo de consentimento.',
          correctiveAdvice: 'Inserir aviso de privacidade e consentimento destacado no formulário.',
          resolved: false,
        },
      ],
    });

    const exported = await ReportService.exportMarkdown('rep-export-999999', { role: 'AUDITOR' });

    expect(exported.content).toContain('Formulário coleta histórico clínico sem termo de consentimento.');
    expect(exported.content).toContain('Inserir aviso de privacidade e consentimento destacado no formulário.');
    expect(exported.content).toContain('**Situação de Vigência:** VIGENTE');
    expect(exported.content).not.toContain('Sem descrição.');
    expect(exported.content).not.toContain('Sem recomendação.');
  });
});
