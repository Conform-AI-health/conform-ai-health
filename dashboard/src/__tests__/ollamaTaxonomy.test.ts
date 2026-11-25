import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaTaxonomyService } from '../services/ollamaTaxonomyService.js';
import * as securityModule from '../shared/security.js';

describe('🤖 OllamaTaxonomyService — Inferência Semântica de Tags com Ollama', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Inferência com Sucesso via Ollama (Qwen / LLM Local)', () => {
    it('deve extrair macro-tema e micro-tags para cenário de cirurgia ambulatorial', async () => {
      const mockOllamaResponse = {
        data: {
          response: JSON.stringify({
            jurisdiction: 'CFM',
            normType: 'RESOLUCAO',
            status: 'VIGENTE',
            macroTema: 'PRATICA_CLINICA_E_PROCEDIMENTOS',
            thematicTags: [
              'CIRURGIA_AMBULATORIAL',
              'ANESTESIOLOGIA',
              'SRPA',
              'UTI_MOVEL',
              'CONSENTIMENTO_INFORMADO',
            ],
            confidence: 0.96,
            reasoning: 'O documento regulamenta requisitos sanitários e anestésicos de cirurgias em ambiente ambulatorial.',
          }),
        },
      };

      const postSpy = vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-OLLAMA-PROC-01',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Regulamenta cirurgias ambulatoriais, salas cirúrgicas tipo II e exigência de leito de recuperação anestésica e suporte móvel.',
      });

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(result.provider).toBe('ollama');
      expect(result.modelUsed).toContain('ollama:');
      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.normTypeTag).toBe('RESOLUCAO');
      expect(result.statusTag).toBe('VIGENTE');
      expect(result.macroTema).toBe('PRATICA_CLINICA_E_PROCEDIMENTOS');
      expect(result.thematicTags).toContain('CIRURGIA_AMBULATORIAL');
      expect(result.thematicTags).toContain('ANESTESIOLOGIA');
      expect(result.thematicTags).toContain('SRPA');
      expect(result.thematicTags).toContain('UTI_MOVEL');
      expect(result.thematicTags).toContain('CONSENTIMENTO_INFORMADO');
      expect(result.confidence).toBe(0.96);
    });

    it('deve extrair tags do eixo de Formação, Residência Médica e RQE (CME)', async () => {
      const mockOllamaResponse = {
        data: {
          response: JSON.stringify({
            jurisdiction: 'CFM',
            normType: 'RESOLUCAO',
            status: 'VIGENTE',
            macroTema: 'FORMACAO_E_ESPECIALIDADES',
            thematicTags: [
              'RQE',
              'ESPECIALIDADES_MEDICAS',
              'AREAS_DE_ATUACAO',
              'RESIDENCIA_MEDICA',
              'COMISSAO_MISTA_DE_ESPECIALIDADES',
            ],
            confidence: 0.98,
            reasoning: 'Ato normativo estabelecendo o quadro geral de especialidades médicas e registro de qualificação RQE.',
          }),
        },
      };

      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-OLLAMA-CME-02',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Aprova o quadro de especialidades médicas da Comissão Mista de Especialidades e concessão de RQE.',
      });

      expect(result.provider).toBe('ollama');
      expect(result.macroTema).toBe('FORMACAO_E_ESPECIALIDADES');
      expect(result.thematicTags).toContain('RQE');
      expect(result.thematicTags).toContain('ESPECIALIDADES_MEDICAS');
      expect(result.thematicTags).toContain('AREAS_DE_ATUACAO');
      expect(result.thematicTags).toContain('RESIDENCIA_MEDICA');
      expect(result.thematicTags).toContain('COMISSAO_MISTA_DE_ESPECIALIDADES');
    });

    it('deve extrair tags do eixo de Publicidade Médica e Redes Sociais', async () => {
      const mockOllamaResponse = {
        data: {
          response: JSON.stringify({
            jurisdiction: 'CFM',
            normType: 'RESOLUCAO',
            status: 'VIGENTE',
            macroTema: 'PUBLICIDADE_E_PROPAGANDA',
            thematicTags: [
              'PUBLICIDADE_MEDICA',
              'ANTES_E_DEPOIS',
              'IDENTIFICACAO_CRM_RQE',
              'SENSACIONALISMO',
              'REDES_SOCIAIS',
            ],
            confidence: 0.94,
            reasoning: 'Dispõe sobre comunicação e publicidade de atos médicos e postagens em redes sociais.',
          }),
        },
      };

      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-OLLAMA-PUB-03',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Diretrizes sobre propaganda médica, divulgação em redes sociais e imagens de antes e depois.',
      });

      expect(result.provider).toBe('ollama');
      expect(result.macroTema).toBe('PUBLICIDADE_E_PROPAGANDA');
      expect(result.thematicTags).toContain('PUBLICIDADE_MEDICA');
      expect(result.thematicTags).toContain('ANTES_E_DEPOIS');
      expect(result.thematicTags).toContain('IDENTIFICACAO_CRM_RQE');
    });
  });

  describe('2. Sanitização e Normalização de Saída do LLM', () => {
    it('deve normalizar tags com espaços, caracteres minúsculos e expurgar tags estruturais repetidas', async () => {
      const mockOllamaResponse = {
        data: {
          response: JSON.stringify({
            jurisdiction: 'cfm',
            normType: 'resolucao',
            status: 'vigente',
            macroTema: 'pratica_clinica_e_procedimentos',
            thematicTags: [
              'cirurgia ambulatorial',
              'anestesiologia!',
              'CFM', // Deve ser filtrada de thematicTags pois é jurisdição
              'RESOLUCAO', // Deve ser filtrada pois é normType
              'VIGENTE', // Deve ser filtrada pois é status
              'uti movel',
            ],
            confidence: 0.9,
          }),
        },
      };

      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-OLLAMA-SANITIZE-04',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Procedimento clínico e sedação.',
      });

      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.normTypeTag).toBe('RESOLUCAO');
      expect(result.statusTag).toBe('VIGENTE');
      expect(result.macroTema).toBe('PRATICA_CLINICA_E_PROCEDIMENTOS');

      // Verifica normalização UPPER_SNAKE_CASE
      expect(result.thematicTags).toContain('CIRURGIA_AMBULATORIAL');
      expect(result.thematicTags).toContain('ANESTESIOLOGIA');
      expect(result.thematicTags).toContain('UTI_MOVEL');

      // Não deve conter tags estruturais no array de thematicTags
      expect(result.thematicTags).not.toContain('CFM');
      expect(result.thematicTags).not.toContain('RESOLUCAO');
      expect(result.thematicTags).not.toContain('VIGENTE');
    });

    it('deve fazer parse correto mesmo quando o modelo Ollama envolver a resposta em markdown codeblock', async () => {
      const mockOllamaResponse = {
        data: {
          response: '```json\n{"jurisdiction": "CFM", "normType": "RESOLUCAO", "status": "VIGENTE", "macroTema": "SAUDE_DIGITAL_E_TELEMEDICINA", "thematicTags": ["TELEMEDICINA", "TELECONSULTA"]}\n```',
        },
      };

      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-OLLAMA-MARKDOWN-05',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Regulamenta consultas médicas a distância.',
      });

      expect(result.macroTema).toBe('SAUDE_DIGITAL_E_TELEMEDICINA');
      expect(result.thematicTags).toContain('TELEMEDICINA');
      expect(result.thematicTags).toContain('TELECONSULTA');
    });
  });

  describe('3. Resiliência: Fallback Transparente para Motor Heurístico Determinístico', () => {
    it('deve acionar fallback para classificador léxico quando o servidor Ollama estiver offline', async () => {
      // Simula erro de conexão (ex: Ollama não iniciado na máquina)
      vi.spyOn(securityModule, 'safeHttpPostJson').mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:11434')
      );

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-FALLBACK-06',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa:
          'Dispõe sobre a realização de cirurgias em ambiente ambulatorial, salas cirúrgicas, leito de recuperação pós-anestésica (SRPA) e ambulância tipo D (UTI móvel).',
      });

      // Deve ativar contingência heurística
      expect(result.provider).toBe('heuristic_fallback');
      expect(result.modelUsed).toBe('heuristic:deontological-rules');
      expect(result.reasoning).toContain('Fallback ativado');

      // As tags devem ser inferidas perfeitamente pelo motor léxico
      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.normTypeTag).toBe('RESOLUCAO');
      expect(result.statusTag).toBe('VIGENTE');
      expect(result.macroTema).toBe('PRATICA_CLINICA_E_PROCEDIMENTOS');
      expect(result.thematicTags).toContain('CIRURGIA_AMBULATORIAL');
      expect(result.thematicTags).toContain('SRPA');
      expect(result.thematicTags).toContain('UTI_MOVEL');
    });

    it('deve acionar fallback quando o Ollama retornar texto corrompido sem JSON', async () => {
      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue({
        data: {
          response: 'Erro interno no processamento do modelo sem JSON válido.',
        },
      } as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-FALLBACK-CORRUPT-07',
        orgao: 'ANVISA',
        tipo: 'RDC',
        ementa: 'Estabelece diretrizes de registro sanitário da ANVISA para produtos cosméticos.',
      });

      expect(result.provider).toBe('heuristic_fallback');
      expect(result.jurisdictionTag).toBe('ANVISA');
      expect(result.normTypeTag).toBe('RDC');
      expect(result.macroTema).toBe('VIGILANCIA_SANITARIA_E_PRODUTOS');
      expect(result.thematicTags).toContain('REGISTRO_ANVISA');
    });
  });

  describe('4. Parâmetros de Configuração e Timeout', () => {
    it('deve repassar baseUrl, modelId e timeout customizados para o safeHttpPostJson', async () => {
      const postSpy = vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue({
        data: {
          response: JSON.stringify({
            jurisdiction: 'CFM',
            macroTema: 'FORMACAO_E_ESPECIALIDADES',
            thematicTags: ['RQE'],
          }),
        },
      } as any);

      await OllamaTaxonomyService.inferTags(
        {
          normId: 'SYNTH-DOC-CUSTOM-CONFIG-08',
          orgao: 'CFM',
          ementa: 'Concessão de RQE.',
        },
        {
          baseUrl: 'http://custom-ollama-host:11434',
          modelId: 'custom-qwen:14b',
          timeoutMs: 30000,
          temperature: 0.2,
        }
      );

      expect(postSpy).toHaveBeenCalledWith(
        'http://custom-ollama-host:11434/api/generate',
        expect.objectContaining({
          model: 'custom-qwen:14b',
          format: 'json',
          stream: false,
          options: {
            temperature: 0.2,
          },
        }),
        { timeout: 30000 }
      );
    });
  });

  describe('5. Vocabulário Aberto e Dinâmico para Arquivos Diversos', () => {
    it('deve aceitar macro-temas e tags temáticas abertas e especializadas para documentos de domínios diversos (ex: Bioética e Transplantes)', async () => {
      const mockOllamaResponse = {
        data: {
          response: JSON.stringify({
            jurisdiction: 'CFM',
            normType: 'RESOLUCAO',
            status: 'VIGENTE',
            macroTema: 'BIOETICA_E_DIREITOS_HUMANOS',
            thematicTags: [
              'DIRETIVAS_ANTECIPADAS',
              'TESTAMENTO_VITAL',
              'TERMINALIDADE_VIDA',
              'CUIDADOS_PALIATIVOS',
              'AUTONOMIA_DO_PACIENTE',
            ],
            confidence: 0.99,
            reasoning: 'Regulamentação deontológica das diretivas antecipadas de vontade e ortotanásia.',
          }),
        },
      };

      vi.spyOn(securityModule, 'safeHttpPostJson').mockResolvedValue(mockOllamaResponse as any);

      const result = await OllamaTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-BIOETICA-DIVERSA-09',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Dispõe sobre as diretivas antecipadas de vontade dos pacientes e conduta do médico assistente.',
      });

      // Valida que o macro-tema aberto não foi truncado nem forçado para categoria fixa
      expect(result.macroTema).toBe('BIOETICA_E_DIREITOS_HUMANOS');

      // Valida que todas as tags abertas especializadas foram preservadas
      expect(result.thematicTags).toContain('DIRETIVAS_ANTECIPADAS');
      expect(result.thematicTags).toContain('TESTAMENTO_VITAL');
      expect(result.thematicTags).toContain('TERMINALIDADE_VIDA');
      expect(result.thematicTags).toContain('CUIDADOS_PALIATIVOS');
      expect(result.thematicTags).toContain('AUTONOMIA_DO_PACIENTE');
      expect(result.provider).toBe('ollama');
    });
  });
});
