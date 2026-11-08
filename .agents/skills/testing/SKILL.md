---
name: testing
description: Engenharia de testes automatizados com Vitest, testes unitários, testes de integração de APIs e validação comportamental BDD/Gherkin.
---

# 🧪 Skill: Testing & Quality Assurance

Esta skill estabelece os padrões e práticas de testes automatizados para o ecossistema ConformIA.

## 🎯 Padrões Obrigatórios
1. **100% de Sucesso na Suíte:**
   - Nenhum pull request ou avanço de estágio pode ser efetuado com testes falhando.
2. **Isolamento e Mocks:**
   - Utilizar mocks declarativos com `vi.mock` para o Prisma ORM e chamadas externas de rede, garantindo execuções rápidas e determinísticas.
3. **Cenários de Fronteira e Resiliência:**
   - Testar estados de Circuit Breaker (CLOSED, OPEN, HALF_OPEN).
   - Testar saturação de fila no Bulkhead.
   - Testar guardrails anti-alucinação com evidências forjadas e normas fictícias.
   - Testar expiração de 1 hora de tokens e fluxo de renovação.

## 🛠️ Comandos de Execução
```bash
# Execução da suíte completa de testes
npm --prefix dashboard test

# Execução direcionada de arquivo
npm --prefix dashboard test -- src/__tests__/aiGuardrails.test.ts
```
