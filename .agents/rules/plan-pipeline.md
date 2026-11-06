---
description: "Pipeline obrigatório com ciclo de vida no GitHub Projects e Git executado sequencialmente quando o comando /plan for acionado."
---

# 🚀 Pipeline de Execução Obrigatória: `/plan` & Ciclo de Vida do Board

Sempre que o comando `/plan` for acionado, o assistente DEVE obrigatoriamente seguir a sequência estrita de estágios, agentes e transições no GitHub Projects Board:

## 1. Estágio 1: Product Owner Regulatória & Backlog (@compliance-specialist)
- Decompor o requisito em Épicos e Histórias de Usuário (*Como... quero... para...*).
- Alinhar com as normas do CFM (Res. 2.336/2023), ANS, ANVISA e LGPD.
- Criar a issue formal no GitHub com `gh issue create`.
- **Ação no Board:** Mover a tarefa para a coluna **`Backlog`** do projeto.

## 2. Estágio 2: Arquitetura & Codificação Full-Stack (@software-architect + Time de Engenharia)
- `@software-architect`: Diagramas Mermaid, contratos Zod e schema Prisma/MongoDB.
- `@backend-engineer`, `@ai-software-engineer` e `@frontend-engineer`: Desenvolvimento de endpoints, workers, RAG e telas React.
- **Ação no Board:** Ao iniciar o desenvolvimento do código aprovado, mover a tarefa para **`In Progress`** (Em Andamento).

## 3. Estágio 3: Auditoria de Segurança & DevSecOps (@security-engineer)
- Auditoria OWASP Top 10 (NoSQL Injection, SSRF, Rate Limiting, RBAC/Multi-tenancy).
- **Quality Gate:** Se reprovado, a tarefa permanece em **`In Progress`** e retorna para refatoração no Estágio 2. Se aprovado, avança para QA.

## 4. Estágio 4: Engenharia de Testes, QA & Review (@test-specialist)
- Elaborar cenários BDD Gherkin e testes automatizados unitários/integração para Backend e Frontend.
- Garantir 100% de sucesso na execução da suíte de testes.
- **Ação no Board:** Após o QA gerar os testes e validar os cenários, **mover obrigatoriamente a issue para a coluna `Review` (Code Review)**.

## 5. Estágio 5: Branch Git & Rastreabilidade (@software-architect + @backend-engineer)
- Ao final das tarefas, criar uma branch dedicada no Git: `git checkout -b feature/issue-<ID>-<slug>`.
- Realizar commits referenciando as tarefas: `git commit -m "... (refs #<ID>)"`.
- Atrelar formalmente a branch e os commits às issues no GitHub.
