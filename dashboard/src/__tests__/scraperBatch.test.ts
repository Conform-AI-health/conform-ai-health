import { describe, it, expect } from 'vitest';
import { ScraperService } from '../services/scraperService.js';

describe('🕷️ ScraperService - Varredura em Lote e Diretórios GitHub', () => {
  it('deve reconhecer URLs de árvores do GitHub e extrair parâmetros de caminho', () => {
    const treeUrl = 'https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/resolucoes/1957';
    const parsed = ScraperService.isGitHubTreeUrl(treeUrl);

    expect(parsed.isTree).toBe(true);
    expect(parsed.owner).toBe('md-augustolinhares');
    expect(parsed.repo).toBe('cfm-normas');
    expect(parsed.branch).toBe('main');
    expect(parsed.path).toBe('normas/resolucoes/1957');
  });

  it('deve retornar isTree: false para páginas normais de hospitais/clínicas', () => {
    const normalUrl = 'https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2023/2336';
    const parsed = ScraperService.isGitHubTreeUrl(normalUrl);

    expect(parsed.isTree).toBe(false);
  });

  it('deve reconhecer arquivos blob individuais do GitHub', () => {
    const blobUrl = 'https://github.com/md-augustolinhares/cfm-normas/blob/main/normas/resolucoes/1957/CFM-RES-1-1957.md';
    const parsed = ScraperService.isGitHubBlobUrl(blobUrl);

    expect(parsed.isBlob).toBe(true);
    expect(parsed.owner).toBe('md-augustolinhares');
    expect(parsed.repo).toBe('cfm-normas');
    expect(parsed.branch).toBe('main');
    expect(parsed.path).toBe('normas/resolucoes/1957/CFM-RES-1-1957.md');
  });

  it('deve taguear automaticamente resoluções com termos médicos como CFM', () => {
    const content = '# Resolução CFM nº 1/1957\nO Conselho Federal de Medicina estabelece normas sobre CRM e RQE.';
    const tags = ScraperService.detectRegulatoryTags(content, '');

    expect(tags).toContain('CFM');
  });
});

