import { describe, it, expect } from 'vitest';

describe('Frontend - Configurações de Tags e Contexto Deontológico', () => {
  const REGULATORY_TAG_OPTIONS = [
    { id: 'CFM', label: 'CFM (Deontologia Médica)' },
    { id: 'LGPD', label: 'LGPD (Proteção de Dados)' },
    { id: 'ANVISA', label: 'ANVISA (Vigilância Sanitária)' },
    { id: 'ANS', label: 'ANS (Saúde Suplementar)' },
    { id: 'REVOGADO', label: 'REVOGADO (Sem Vigência)' },
  ];

  it('deve conter as tags regulatórias e de status deontológico do ecossistema de saúde', () => {
    const tagIds = REGULATORY_TAG_OPTIONS.map((t) => t.id);
    expect(tagIds).toContain('CFM');
    expect(tagIds).toContain('LGPD');
    expect(tagIds).toContain('ANVISA');
    expect(tagIds).toContain('ANS');
    expect(tagIds).toContain('REVOGADO');
  });

  it('deve calcular corretamente a compatibilidade de contexto para renderização de agentes', () => {
    const pageTags = ['CFM', 'ANS'];

    const agent1 = { name: 'Auditor CFM', tags: ['CFM'] };
    const agent2 = { name: 'Auditor LGPD', tags: ['LGPD'] };
    const agent3 = { name: 'Auditor ANS', tags: ['ANS'] };

    const compatible1 = agent1.tags.some((t) => pageTags.includes(t));
    const compatible2 = agent2.tags.some((t) => pageTags.includes(t));
    const compatible3 = agent3.tags.some((t) => pageTags.includes(t));

    expect(compatible1).toBe(true);
    expect(compatible2).toBe(false);
    expect(compatible3).toBe(true);
  });
});

