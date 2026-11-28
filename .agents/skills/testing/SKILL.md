---
name: testing
description: Engenharia de testes automatizados com Vitest, testes unitários, testes de integração de APIs e validação comportamental BDD/Gherkin.
---

# 🧪 Skill: Testing & Quality Assurance

Esta skill estabelece os padrões e práticas de testes automatizados para o ecossistema ConformIA.

## 🎯 Padrões Obrigatórios
1. **100% de Sucesso na Suíte:**
   - Nenhum pull request ou avanço de estágio pode ser efetuado com testes falhando.
2. **Gate Obrigatório de Pipeline CI Pré-PR (Espelhamento `.github/workflows/ci-deploy.yml`):**
   - **ANTES** de qualquer `git commit` final, `git push` ou abertura/atualização de Pull Request, é **obrigatório** executar localmente todos os gates de validação do GitHub Actions e garantir `exit code 0` em todos:
     1. `npm run prisma:generate` (sempre que `schema.prisma` ou tipos do Prisma forem afetados)
     2. `npm run typecheck` (`tsc --noEmit` tanto em `dashboard` quanto em `dashboard-web`)
     3. `npm test` (`vitest` em `dashboard` e `dashboard-web`)
     4. `npm run build` (`tsc` em `dashboard` e `tsc && vite build` em `dashboard-web`)
   - **Atenção em Callbacks Puppeteer no Backend (`dashboard`):** O `dashboard/tsconfig.json` compila para Node.js sem `lib: ["dom"]`. Dentro de `page.evaluate`, `page.evaluateHandle` ou `page.waitForFunction`, **nunca** referencie globais de navegador (`document`, `window`, `Event`, `navigator`) diretamente — acesse via `(globalThis as any).document`, `(globalThis as any).window`, etc., evitando falhas `TS2584` / `TS2304` no `npm run typecheck`.
3. **Isolamento e Mocks:**
   - Utilizar mocks declarativos com `vi.mock` para o Prisma ORM e chamadas externas de rede, garantindo execuções rápidas e determinísticas.
4. **Cenários de Fronteira e Resiliência:**
   - Testar estados de Circuit Breaker (CLOSED, OPEN, HALF_OPEN).
   - Testar saturação de fila no Bulkhead.
   - Testar guardrails anti-alucinação com evidências forjadas e normas fictícias.
   - Testar expiração de 1 hora de tokens e fluxo de renovação.

## 🛠️ Comandos de Execução e Validação Pré-PR
```bash
# Gate completo da pipeline CI (OBRIGATÓRIO antes de push / PR)
npm run typecheck
npm test
npm run build

# Execução da suíte completa de testes do backend
npm --prefix dashboard test

# Execução direcionada de arquivo
npm --prefix dashboard test -- src/__tests__/aiGuardrails.test.ts
```
