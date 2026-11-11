# 🚀 Pipeline de Execução Automatizada: `/plan` & Ciclo de Vida do Board

> **Regra de Ouro:** Quando o comando `/plan` for acionado, o sistema DEVE executar obrigatoriamente a seguinte ordem sequencial de agentes especializados do ConformIA. **Nenhum estágio pode avançar para o seguinte sem a aprovação ou conclusão estruturada do anterior.**

---

## 🏛️ Fluxograma de Governança e Transições no GitHub Projects

```mermaid
flowchart TD
    UserReq["Solicitação do Usuário (/plan)"] --> Stage1["Estágio 1: @compliance-specialist (Product Owner)"]
    Stage1 -->|1. Cria Issue & Move p/ Backlog| BoardBacklog[("📌 Board: Backlog")]
    
    Stage1 --> Stage2["Estágio 2: @software-architect & Engenharia\n(@backend-engineer, @frontend-engineer, @ai-software-engineer)"]
    Stage2 -->|2. Início do Desenvolvimento| BoardInProgress[("🔨 Board: In Progress")]
    
    Stage2 --> Stage3["Estágio 3: @security-engineer (Auditoria OWASP / LGPD)"]
    Stage3 -- 🔴 Reprovado: Risco Detectado -->|Loop de Correção| Stage2
    
    Stage3 -- 🟢 Aprovado: Security Gate OK --> Stage4["Estágio 4: @test-specialist (QA & BDD)"]
    Stage4 -->|3. Testes Gerados & Validados| BoardReview[("👀 Board: Code Review")]
    
    BoardReview --> Stage5["Estágio 5: Finalização Git & Branch\n(Criar branch e atrelar às issues)"]
    Stage5 --> Ready["🚀 Pronto para Merge e Deploy"]
```

---

## 📋 Estágio 1: Agente de Product Owner Regulatória & Requisitos de Negócio
- **Agente Responsável:** `@compliance-specialist` *(apoio técnico de `@software-architect`)*
- **Ações Obrigatórias:**
  1. Analisar a demanda do usuário sob a ótica do Catálogo Normativo Ativo e das Resoluções e Leis vigentes aplicáveis ao escopo selecionado (incluindo marcos de proteção de dados, conselhos profissionais de saúde, ANVISA, ANS e diretrizes deontológicas pertinentes).
  2. Mapear o escopo e decompor em **Épicos** claros e **Histórias de Usuário (User Stories)** no formato:
     - *Como [perfil], quero [ação] para que [benefício de conformidade/negócio].*
  3. Definir **Critérios de Aceitação Deontológica e Funcional** objetivos e mensuráveis.
- **Ação no GitHub Projects Board:**
  - Criar a issue formal via GitHub CLI (`gh issue create`) ou API com labels (`user-story`, `padrão-po`, `compliance`).
  - **Mover a Issue para o Board:** Posicionar o card na coluna **`Backlog`** do projeto `https://github.com/orgs/Conform-AI-health/projects/3/views/1`.
- **Saída:** Backlog de issues estruturadas e registradas na coluna `Backlog`.

---

## ⚙️ Estágio 2: Arquitetura & Engenharia de Software Full-Stack (Codificação)
- **Agentes Responsáveis:**
  - `@software-architect` *(Coordenação Técnica e Arquitetura Global)*
  - `@backend-engineer` *(Backend Node.js, Express, Prisma, BullMQ, Redis, MongoDB)*
  - `@frontend-engineer` *(Frontend React 18, Vite, Tailwind CSS, Componentes de Paginação, Teste de IA e RBAC UI)*
  - `@ai-software-engineer` *(Pipelines RAG, Google Gemini, Ollama, MCP, Structured Outputs)*
- **Ações Obrigatórias:**
  1. **Arquitetura (@software-architect):**
     - Leitura das issues criadas no Estágio 1.
     - Modelagem estrutural (diagramas C4 ou Mermaid) detalhando fluxos síncronos e assíncronos.
     - Modelagem de dados no Prisma Schema (`schema.prisma`) e coleções do MongoDB Atlas, garantindo índices de alta performance e isolamento multi-tenant.
     - Definição dos contratos de API REST com validações estritas em **Zod**.
  2. **Engenharia de Backend & IA (@backend-engineer & @ai-software-engineer):**
     - Estruturação de controllers, services, middlewares e workers BullMQ.
     - Estratégia de RAG e prompting determinístico com *Structured Outputs*.
  3. **Engenharia de Frontend (@frontend-engineer):**
     - Arquitetura de páginas, componentes Tailwind, contextos de autenticação e feedback reativo.
- **Ação no GitHub Projects Board:**
  - Assim que a arquitetura for aprovada e a fase de codificação for iniciada, **mover a tarefa para a coluna `In Progress` (Em Andamento)**.
- **Saída:** Código e especificação técnica implementada vinculada à issue.

---

## 🛡️ Estágio 3: Especialista em Segurança da Informação & DevSecOps
- **Agente Responsável:** `@security-engineer` *(revisão conjunta com `@compliance-specialist`)*
- **Ações Obrigatórias:**
  1. Auditar a arquitetura e o código buscando mitigar riscos do **OWASP Top 10**:
     - Prevenção contra **NoSQL Injection** e validação sanitizada via schemas Zod.
     - Prevenção contra **SSRF** em requisições de web scraping (bloqueio de subredes privadas, localhost e metadata AWS `169.254.169.254`).
     - Blindagem de autenticação: Rate Limiting por IP, hashing Bcrypt (salt 12) e expiração de tokens JWT.
     - Isolamento rigoroso de inquilinos (**Multi-Tenancy Guard**): garantia de que nenhum cliente acesse dados de outro.
     - Conformidade com a **LGPD em Saúde** para tratamento e sigilo de dados sensíveis.
  2. **Quality Gate de Segurança:**
     - 🔴 **Se encontrar vulnerabilidade ou falha de conformidade:** O plano é **rejeitado** e a issue permanece/retorna para **`In Progress`** com o checklist de refatoração mandatório para o Estágio 2.
     - 🟢 **Se aprovado:** Emite o Parecer de Segurança Técnica (*Security Clearance*).
- **Saída:** Parecer de segurança aprovado com zero vulnerabilidades críticas/altas.

---

## 🧪 Estágio 4: Especialista em Testes de Software & QA
- **Agente Responsável:** `@test-specialist`
- **Ações Obrigatórias:**
  1. Converter critérios de aceitação e regras técnicas em **Cenários BDD (Behavior-Driven Development)** estruturados em Gherkin.
  2. Construir e executar a suíte de testes automatizados para ambas as camadas:
     - **Testes Unitários:** Services, helpers de sanitização, parsers e regras de reconciliação.
     - **Testes de Integração Backend:** Endpoints com Supertest, mocks de Prisma/MongoDB e workers.
     - **Testes Frontend:** Componentes React com Vitest e Testing Library.
  3. Validar se a suíte de testes passa com 100% de sucesso (`npm test`).
- **Ação no GitHub Projects Board:**
  - **Após o QA gerar os testes e validar os cenários de aceitação, mover obrigatoriamente a issue para a coluna `Review` (Code Review)** no board `https://github.com/orgs/Conform-AI-health/projects/3/views/1`.
- **Saída:** Suíte de testes automatizados completa e tarefas movidas para `Review`.

---

## 🌿 Estágio 5: Finalização Git, Criação de Branch & Rastreabilidade de Tarefas
- **Agentes Responsáveis:** `@software-architect` & `@backend-engineer` *(com suporte de `@devops-engineer`)*
- **Ações Obrigatórias:**
  1. **Criação da Branch Dedicada:**
     - Ao finalizar a implementação e testes do ciclo, criar uma branch temática padronizada no Git:
       ```bash
       git checkout -b feature/issue-<NUMERO_DA_ISSUE>-<SLUG_DA_TAREFA>
       # Exemplo: git checkout -b feature/issue-10-rag-scraped-pages
       ```
  2. **Atrelar a Branch e Commits às Tarefas:**
     - Todos os commits devem referenciar explicitamente o número da issue correspondente para vincular o histórico no GitHub:
       ```bash
       git commit -m "feat(rag): ingestao de normas e tagging contextual (refs #10, #36)"
       ```
     - Caso o fechamento seja automático pelo Pull Request, utilizar as palavras-chave padrão do GitHub (`Closes #X`, `Fixes #X`).
  3. **Vincular Branch na Issue:**
     - Registrar o nome da branch gerada nos comentários da issue ou via comando `gh issue develop`:
       ```bash
       gh issue develop <NUMERO_DA_ISSUE> --branch "feature/issue-<NUMERO_DA_ISSUE>-<SLUG>"
       ```
- **Saída:** Branch Git isolada, com commits limpos, rastreabilidade completa e vínculo bidirecional com as issues no GitHub Projects.
