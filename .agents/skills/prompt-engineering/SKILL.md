---
name: prompt-engineering
description: Engenharia de Prompts Deontológicos, Structured Outputs, Grounding Mandatório e Mitigação de Alucinações em Modelos de Linguagem para Saúde.
---

# ✍️ Skill: Prompt Engineering & Structured Outputs

Esta skill orienta a construção de prompts de sistema, instruções de ancoragem e contratos de saída para modelos fundacionais no ConformIA.

## 🎯 Princípios Fundamentais
1. **Contrato de Saída Estruturado:**
   - Exigir sempre formato JSON validado por Zod (`structuredAuditContractSchema`), contendo `audit_id`, `risk_level`, `confidence`, `findings` e `requires_human_review`.
2. **Grounding Mandatório:**
   - Inserir diretrizes invioláveis que proíbem o modelo de inventar normas, leis ou números de artigos que não estejam no rol de contexto.
3. **Presunção de Conformidade (In Dubio Pro Reo):**
   - Caso uma conduta médica não viole explicitamente nenhuma norma fornecida, a IA deve classificar como `CONFORME` com nota 100.
4. **Evidência Fática Obrigatória:**
   - O campo `evidence` deve conter transcrição literal ou paráfrase fidedigna da página auditada.

## 🛠️ Exemplo de Contrato
```json
{
  "audit_id": "AUD-001",
  "risk_level": "HIGH",
  "confidence": 0.94,
  "findings": [
    {
      "description": "Ausência de informação obrigatória de CRM",
      "regulation": "CFM",
      "article": "Art. 1º, § 1º",
      "evidence": "Nenhum número de identificação profissional (CRM) identificado no material auditado.",
      "source_version": "2023",
      "recommendation": "Incluir CRM e UF no cabeçalho ou rodapé do material.",
      "requires_human_review": false
    }
  ]
}
```
