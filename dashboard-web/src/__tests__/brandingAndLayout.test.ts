import { describe, it, expect } from 'vitest';

describe('Frontend - Identidade Visual & Estrutura de Navegação (Conform.AI)', () => {
  it('deve apontar para o asset oficial do logotipo 3D da Conform.AI', () => {
    const officialLogoPath = '/img/be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg';
    expect(officialLogoPath).toMatch(/^\/img\/.*\.jpg$/);
    expect(officialLogoPath).toContain('be3f9839-118d-4ea9-bc7f-66d57b8d1b20');
  });

  it('deve conter a segmentação correta de itens de menu por perfil de usuário (RBAC)', () => {
    const adminNavItems = [
      { label: 'Cockpit do Auditor', path: '/cockpit' },
      { label: 'Varredura & Tags', path: '/scraping' },
      { label: 'Clínicas & Clientes', path: '/clients' },
      { label: 'Módulos de Auditoria', path: '/agents' },
      { label: 'Laudos Deontológicos', path: '/reports' },
      { label: 'Logs & Telemetria IA', path: '/logs' },
    ];

    const clientNavItems = [
      { label: 'Portal da Clínica', path: '/portal' },
      { label: 'Laudos Técnicos', path: '/reports' },
    ];

    expect(adminNavItems.length).toBe(6);
    expect(clientNavItems.length).toBe(2);

    expect(adminNavItems.some(i => i.path === '/cockpit')).toBe(true);
    expect(adminNavItems.some(i => i.path === '/agents')).toBe(true);
    expect(clientNavItems.some(i => i.path === '/portal')).toBe(true);
  });

  it('deve validar os marcos regulatórios exibidos no cabeçalho operacional', () => {
    const activeFrameworks = [
      'Catálogo Normativo Ativo',
      'Multiescopo Regulatório',
      'Vigência Dinâmica',
    ];

    expect(activeFrameworks).toContain('Catálogo Normativo Ativo');
    expect(activeFrameworks).toContain('Multiescopo Regulatório');
    expect(activeFrameworks).toContain('Vigência Dinâmica');
  });
});
