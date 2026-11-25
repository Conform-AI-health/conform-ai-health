import { describe, it, expect } from 'vitest';
import { DeontologicalTaxonomyService } from '../services/deontologicalTaxonomyService.js';

describe('⚖️ DeontologicalTaxonomyService — Taxonomia Multi-Normativa em Saúde', () => {
  describe('1. Eixo Formação, Residência Médica, RQE e Especialidades (CME / Conselhos)', () => {
    it('deve inferir tags de especialidades, RQE, residência e CME sem disparar publicidade ou cirurgia ambulatorial', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-CME-SPECIALTIES-01',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa:
          'Homologa ato conjunto que estabelece a relação e quadro de especialidades médicas e áreas de atuação aprovadas pela Comissão Mista de Especialidades (CME), fixando critérios para emissão do Registro de Qualificação de Especialista (RQE) e programas de residência médica.',
        content: `
          Artigo 1º: Reconhecer as especialidades médicas aprovadas no âmbito da Comissão Mista de Especialidades.
          Anexo Normativo (Tabela Completa de Especialidades do País):
          - Anestesiologia
          - Cirurgia Geral
          - Cirurgia Plástica
          - Dermatologia
          - Oftalmologia
          - Pediatria
        `,
      });

      // Metadados estruturais
      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.normTypeTag).toBe('RESOLUCAO');
      expect(result.statusTag).toBe('VIGENTE');

      // Macro-tema principal
      expect(result.macroTema).toBe('FORMACAO_E_ESPECIALIDADES');

      // Tags temáticas esperadas do eixo de formação/qualificação
      expect(result.thematicTags).toContain('RQE');
      expect(result.thematicTags).toContain('ESPECIALIDADES_MEDICAS');
      expect(result.thematicTags).toContain('AREAS_DE_ATUACAO');
      expect(result.thematicTags).toContain('RESIDENCIA_MEDICA');
      expect(result.thematicTags).toContain('COMISSAO_MISTA_DE_ESPECIALIDADES');

      // Anti-falsos positivos críticos exigidos:
      // 1. Não deve classificar como cirurgia ambulatorial apenas por citar cirurgia geral no anexo
      expect(result.thematicTags).not.toContain('CIRURGIA_AMBULATORIAL');
      // 2. Não deve classificar como publicidade médica apenas por citar RQE
      expect(result.thematicTags).not.toContain('PUBLICIDADE_MEDICA');
      // 3. Com a taxonomia aberta, especialidades expressamente citadas podem ser acolhidas
      expect(result.thematicTags).toContain('ANESTESIOLOGIA');
    });
  });

  describe('2. Eixo Prática Clínica, Procedimentos e Cirurgia Ambulatorial', () => {
    it('deve inferir cirurgia ambulatorial, anestesiologia, SRPA e UTI móvel em cenário clínico de porte cirúrgico', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-CLINICAL-PROC-02',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa:
          'Regulamenta a realização de procedimentos em ambiente ambulatorial e consultórios, definindo unidades de tipo I, II e III, exigências de porte cirúrgico, anestesia local e sedação com leito de recuperação pós-anestésica (SRPA), obtenção de termo de consentimento livre e esclarecido (TCLE) e ambulância de suporte avançado (UTI móvel) para remoção e segurança do paciente.',
        content:
          'Art. 1º Estabelecer os critérios técnicos para a prática de cirurgia ambulatorial com porte cirúrgico.\nArt. 2º É obrigatória a disponibilidade de leito de recuperação pós-anestésica e protocolo de remoção assistida.',
        includeGovernanceTags: true,
      });

      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.normTypeTag).toBe('RESOLUCAO');
      expect(result.statusTag).toBe('VIGENTE');
      expect(result.macroTema).toBe('PRATICA_CLINICA_E_PROCEDIMENTOS');

      expect(result.thematicTags).toContain('CIRURGIA_AMBULATORIAL');
      expect(result.thematicTags).toContain('ANESTESIOLOGIA');
      expect(result.thematicTags).toContain('SRPA');
      expect(result.thematicTags).toContain('UTI_MOVEL');
      expect(result.thematicTags).toContain('CONSENTIMENTO_INFORMADO');
      expect(result.thematicTags).toContain('SEGURANCA_PACIENTE');

      // Tags de governança solicitadas explicitamente
      expect(result.allTags).toContain('RAG_READY');
      expect(result.allTags).toContain('NORMAS_OFFICIAL');
    });

    it('anti-falso positivo: menção genérica a cirurgião ou cirurgia sem contexto ambulatorial NÃO deve disparar CIRURGIA_AMBULATORIAL', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-SURGEON-GENERIC-03',
        orgao: 'CFM',
        tipo: 'PARECER',
        ementa: 'Consulta sobre competências e responsabilidade ética do médico cirurgião no ambiente de plantão hospitalar geral.',
      });

      expect(result.thematicTags).not.toContain('CIRURGIA_AMBULATORIAL');
    });
  });

  describe('3. Eixo Publicidade e Propaganda Médica em Redes Sociais', () => {
    it('deve inferir publicidade médica, antes e depois, sensacionalismo e redes sociais', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-ADVERTISING-04',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa:
          'Regulamenta a publicidade médica e propaganda na divulgação de atos médicos em redes sociais, estabelecendo critérios para antes e depois, obrigatoriedade de identificação com CRM e RQE no anúncio, vedação ao sensacionalismo e descontos de black friday.',
      });

      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.macroTema).toBe('PUBLICIDADE_E_PROPAGANDA');
      expect(result.thematicTags).toContain('PUBLICIDADE_MEDICA');
      expect(result.thematicTags).toContain('ANTES_E_DEPOIS');
      expect(result.thematicTags).toContain('IDENTIFICACAO_CRM_RQE');
      expect(result.thematicTags).toContain('SENSACIONALISMO');
      expect(result.thematicTags).toContain('PRECO_PROMOCAO');
      expect(result.thematicTags).toContain('REDES_SOCIAIS');
    });
  });

  describe('4. Eixo Saúde Digital e Telemedicina', () => {
    it('deve inferir telemedicina, teleconsulta e prontuário eletrônico', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-DIGITAL-HEALTH-05',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa:
          'Regulamenta a prática da telemedicina e teleconsulta médica a distância, emissão de receita digital e prontuário eletrônico com assinatura ICP-Brasil.',
      });

      expect(result.jurisdictionTag).toBe('CFM');
      expect(result.macroTema).toBe('SAUDE_DIGITAL_E_TELEMEDICINA');
      expect(result.thematicTags).toContain('TELEMEDICINA');
      expect(result.thematicTags).toContain('TELECONSULTA');
      expect(result.thematicTags).toContain('PRONTUARIO_ELETRONICO');
    });
  });

  describe('5. Eixo Vigilância Sanitária e Produtos de Saúde (ANVISA)', () => {
    it('deve inferir registro sanitário da ANVISA e vedações de cosméticos com alegações curativas', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-SANITARY-06',
        orgao: 'ANVISA',
        tipo: 'RDC',
        ementa:
          'Dispõe sobre normas sanitárias da ANVISA para rotulagem de cosméticos e proíbe a atribuição de propriedades terapêuticas e cura definitiva em produtos sem registro sanitário.',
      });

      expect(result.jurisdictionTag).toBe('ANVISA');
      expect(result.normTypeTag).toBe('RDC');
      expect(result.macroTema).toBe('VIGILANCIA_SANITARIA_E_PRODUTOS');
      expect(result.thematicTags).toContain('REGISTRO_ANVISA');
      expect(result.thematicTags).toContain('COSMETICOS_CURATIVOS');
    });
  });

  describe('6. Eixo Saúde Suplementar e Planos de Saúde (ANS)', () => {
    it('deve inferir saúde suplementar e rede credenciada', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-PLANS-07',
        orgao: 'ANS',
        tipo: 'RESOLUCAO',
        ementa:
          'Regulamenta a divulgação de rede credenciada de operadoras de planos de saúde e cumprimento do rol de procedimentos obrigatórios da ANS.',
      });

      expect(result.jurisdictionTag).toBe('ANS');
      expect(result.macroTema).toBe('SAUDE_SUPLEMENTAR_E_PLANOS');
      expect(result.thematicTags).toContain('REDE_CREDENCIADA');
    });
  });

  describe('7. Eixo Privacidade e Proteção de Dados (LGPD em Saúde) e Regex Estrita do Art. 11', () => {
    it('deve inferir dados sensíveis quando houver artigo 11 no contexto da LGPD e dados de saúde', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-LGPD-DATA-08',
        orgao: 'LGPD',
        tipo: 'LEI',
        ementa:
          'Lei Geral de Proteção de Dados Pessoais (LGPD). Estabelece a disciplina do tratamento de dados pessoais sensíveis sobre a saúde pelo artigo 11 e exigência de política de privacidade clara.',
      });

      expect(result.jurisdictionTag).toBe('LGPD');
      expect(result.normTypeTag).toBe('LEI');
      expect(result.macroTema).toBe('PRIVACIDADE_E_DADOS_SENSIVEIS');
      expect(result.thematicTags).toContain('DADOS_SENSIVEIS_SAUDE');
    });

    it('anti-falso positivo: citação de artigo 11 em ato administrativo comum NÃO deve disparar dados sensíveis', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-ADMIN-ACT-09',
        orgao: 'CFM',
        tipo: 'PORTARIA',
        ementa: 'Dispõe sobre o horário de atendimento da secretaria administrativa do conselho.',
        content: 'Artigo 11. Esta portaria entra em vigor na data de sua publicação, revogadas as disposições em contrário.',
      });

      expect(result.thematicTags).not.toContain('DADOS_SENSIVEIS_SAUDE');
      expect(result.macroTema).not.toBe('PRIVACIDADE_E_DADOS_SENSIVEIS');
    });
  });

  describe('8. Eixo Odontologia e Harmonização Orofacial (CFO)', () => {
    it('deve classificar atos odontológicos sob jurisdição CFO com tag HARMONIZACAO_OROFACIAL', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-ODONTO-10',
        orgao: 'CFO',
        tipo: 'RESOLUCAO',
        ementa:
          'Reconhece a Harmonização Orofacial (HOF) como especialidade odontológica do cirurgião-dentista regularmente inscrito no CRO.',
      });

      expect(result.jurisdictionTag).toBe('CFO');
      expect(result.macroTema).toBe('ODONTOLOGIA_E_PROCEDIMENTOS');
      expect(result.thematicTags).toContain('HARMONIZACAO_OROFACIAL');
    });
  });

  describe('9. Gestão Estrita de Vigência vs. Revogação (Sem IDs Hardcoded)', () => {
    it('deve marcar norma como REVOGADA e suprimir VIGENTE quando constar status ou declaração expressa de revogação', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-REVOKED-EXPRESS-11',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Declarada revogada expressamente por resolução posterior. Manual desatualizado tornado sem efeito.',
        status: 'REVOGADA',
      });

      expect(result.statusTag).toBe('REVOGADA');
      expect(result.allTags).toContain('REVOGADA');
      expect(result.allTags).not.toContain('VIGENTE');
    });

    it('deve manter norma como VIGENTE quando não houver qualquer indício ou status de revogação', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-ACTIVE-EFFECT-12',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Critérios regulares de conduta em plena eficácia jurídica.',
        status: 'EM_VIGOR',
      });

      expect(result.statusTag).toBe('VIGENTE');
      expect(result.allTags).toContain('VIGENTE');
      expect(result.allTags).not.toContain('REVOGADA');
    });
  });

  describe('10. Taxonomia Limpa: Metadados Estruturais vs Tags de Governança', () => {
    it('não deve injetar artificialmente RAG_READY e NORMAS_OFFICIAL quando não solicitadas', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-CLEAN-TAXONOMY-13',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Norma de reconhecimento do quadro de especialidades médicas e áreas de atuação.',
        includeGovernanceTags: false,
      });

      expect(result.allTags).not.toContain('RAG_READY');
      expect(result.allTags).not.toContain('NORMAS_OFFICIAL');
      expect(result.allTags).not.toContain('RAG');
    });

    it('deve preservar tags customizadas pré-existentes sem duplicação', () => {
      const result = DeontologicalTaxonomyService.inferTags({
        normId: 'SYNTH-DOC-CUSTOM-TAGS-14',
        orgao: 'CFM',
        tipo: 'RESOLUCAO',
        ementa: 'Regulamenta critérios de auditoria clínica assistencial.',
        currentTags: ['CUSTOM_AUDIT_TAG', 'SETOR_REGULATORIO', 'CFM', 'VIGENTE'],
      });

      expect(result.allTags).toContain('CUSTOM_AUDIT_TAG');
      expect(result.allTags).toContain('SETOR_REGULATORIO');
      const cfmCount = result.allTags.filter((t) => t === 'CFM').length;
      expect(cfmCount).toBe(1);
    });
  });
});
