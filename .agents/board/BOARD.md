# 📋 Conform.AI - Backlog & Roadmap (GitHub Projects #3)
> **Ciclo de Vida do Pipeline `/plan` (`.agents/rules/plan-pipeline.md`)**  
> **Product Owner & Curadoria Regulatória:** `@compliance-specialist`  
> **Data de Atualização:** 10 de Novembro de 2026  
> **Branch Atual:** `fix/backlog-sprint0-sprint1-security-ai` | **Commit:** `3d32ed1`

---

## 🚦 Visão Geral das Colunas do Board

| Status do Board | Total de Tarefas | Tarefas Mapeadas |
|---|:---:|---|
| 📌 **Backlog** | 2 | T18 (Golden Set RAG), T19 (Docs/Licença) |
| 🔨 **In Progress** | 0 | — |
| 👀 **In review** | 17 | **T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17** |
| 🚀 **Done** | 0 | *(Aguardando aprovação de PR e merge)* |

---

## 📌 Detalhamento das Tarefas Movidas para `In review`

### 🛡️ Épico A: Segurança Crítica (Sprint 0 - P0)

#### [T01] Remover admin padrão (admin123456) e reset de senha a cada boot
* **Responsáveis:** `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/config/env.ts`: Zod `superRefine` bloqueando senhas padrão conhecidas e exigindo mínimo de 12 caracteres em produção.
  * `dashboard/src/shared/autoMigrate.ts`: Preservação incondicional do `passwordHash` e credenciais de administradores existentes no banco.
* **Critério de Aceite:** `tsc` aprovado; `authAndResilience.test.ts` validado com rejeição de senhas fracas.

#### [T02] SSRF: saída HTTP segura e restrição estrita de targetUrl
* **Responsáveis:** `@architect`, `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/shared/security.ts`: `safeHttpGet` com suporte estrito a IPv6 (RFC 6052, ULA, link-local), revalidação DNS salto a salto e `maxRedirects: 3`.
  * `dashboard/src/services/scraperService.ts`: Interceptação no Puppeteer (`page.setRequestInterception`) e substituição de `axios.get` por `safeHttpGet`.
  * `dashboard/src/controllers/agentController.ts`: CLIENT bloqueado ao tentar auditar targetUrl externa (403 `ARBITRARY_TARGET_URL_FORBIDDEN`).
* **Critério de Aceite:** `scraperBatch.test.ts` (10/10) e `apiValidation.test.ts` aprovados.

#### [T03] Rotacionar segredos, remover .env dos pacotes e varrer histórico
* **Responsáveis:** `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `.gitignore` e `.dockerignore` (raiz, dashboard e dashboard-web) atualizados com regra estrita para bloquear `.env*`.
  * `.env.example` e `dashboard/.env.example`: Segredos reais removidos e substituídos por placeholders seguros.

#### [T04] XSS armazenado via websiteUrl e whitelist de campos editáveis pelo CLIENT
* **Responsáveis:** `@backend-specialist`, `@frontend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/controllers/clientController.ts`: `websiteUrl` validado via Zod com protocolo `http://` ou `https://`. `PUT /clients/:id` bloqueia alteração de `status`, `cnpj` e responsáveis técnicos por CLIENT (403 `CLIENT_FIELD_FORBIDDEN`).
  * `dashboard-web/src/utils/urlSecurity.ts`: Criado helper `safeHttpUrl()` e aplicado em `ClientsPage.tsx`, `CustomerDashboardPage.tsx` e `ScrapingPage.tsx`.

#### [T05] Isolamento multi-tenant em /agents e /scraped-pages
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/controllers/agentController.ts`: `listModules` e `getModuleById` filtram por tenant e suprimem `systemPrompt` para o perfil `Role.CLIENT`.
  * `dashboard/src/controllers/scrapedPageController.ts`: `getCompatibleAgents` isola agentes privados de outros clientes.

---

### ⚙️ Épico B: Sessão e Hardening (Sprint 1 - P1)

#### [T06] Ciclo de vida de sessão: logout efetivo, reuso de refresh token e single-flight
* **Responsáveis:** `@backend-specialist`, `@frontend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard-web/src/services/api.ts`: Interceptor com fila única (*single-flight mutex*) para renovações de sessão concorrentes em status 401.
  * `dashboard-web/src/context/AuthContext.tsx`: `logout` notifica `/auth/logout` no backend antes de expurgar o storage local.
  * `dashboard/src/controllers/authController.ts`: Revogação via hash SHA-256 no banco de dados.

#### [T07] Rate Limiting diferenciado por rota
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/routes/authRoutes.ts`: Limiter estrito contra brute force (10 reqs/15 min) para login/register/forgot-password e limiter flexível (60 reqs/15 min) para refresh.
  * `dashboard/src/routes/scrapedPageRoutes.ts` e `dashboard/src/routes/agentRoutes.ts`: Rate limiters dedicados para scraping e disparo de auditorias.

#### [T08] E-mails: escapar HTML de conteúdo gerado e corrigir destinatários
* **Responsáveis:** `@backend-specialist` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/services/emailService.ts`: Implementada sanitização com `escapeHtml()` para `clientName`, `targetUrl`, `verdict` e `summary`. Bloqueado envio para e-mail mock (`contato@clinica.com`).
  * `dashboard/src/controllers/clientController.ts`: Fallback hardcoded `contato@clinica.com` removido.

#### [T09] Limites de payload, /system/status sem vazamento e rate limit atrás de proxy
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/app.ts`: Limite global de payload reduzido para `100kb`. Rota `/scraped-pages/upload` aceita até `20mb`.
  * `dashboard/src/controllers/systemController.ts`: Respostas em produção ocultam `err.message` e detalhes de conexão do Mongo/Redis.

#### [T10] Modelos de IA: restringir baseUrl/edição a ADMIN e validar endpoints
* **Responsáveis:** `@backend-specialist`, `@ai-engineer` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/routes/modelRoutes.ts`: Rotas de criação, alteração, ativação e exclusão restritas exclusivamente a `Role.ADMIN`.
  * `dashboard/src/controllers/modelController.ts`: Validação de `baseUrl` contra SSRF.

---

### 🔬 Épico C: IA, RAG e Conformidade (Sprint 1 & 2 - P1/P2)

#### [T11] Grounding do artigo citado e catálogo normativo com vigência/revogação
* **Responsáveis:** `@ai-engineer`, `@backend-specialist`, `@architect` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/shared/reconciliationTypes.ts`: Zod schema `violationSchema` com obrigatoriedade estrita de `normArticle` e `normCode`.
  * `dashboard/src/shared/aiGuardrails.ts`: Expurgadas violações com artigos inexistentes ou normas revogadas.

#### [T12] Detecção de ausência de CRM e RQE com severidade GRAVE/CRÍTICA
* **Responsáveis:** `@ai-engineer`, `@backend-specialist` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/services/ai/heuristicProvider.ts`: Ausência de CRM e especialidade anunciada sem RQE classificadas com severidade `GRAVE` ou `CRITICA` fundamentadas no Art. 1º e Art. 2º da Resolução CFM nº 2.336/2023.

#### [T13] Defesa em camadas contra prompt injection
* **Responsáveis:** `@ai-engineer` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/services/ai/geminiProvider.ts` e `ollamaProvider.ts`: Delimitação do conteúdo auditado em tags XML `<document_to_audit>` com diretriz explícita de dado passivo e não executável.

#### [T14] Normalização de status do laudo e tolerância a falhas de inferência
* **Responsáveis:** `@ai-engineer`, `@backend-specialist` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/services/auditExecutionService.ts` e `agentController.ts`: Transição garantida para `FAILED` com gravação em `SystemLog`, sem deixar execuções presas em `QUEUED`/`RUNNING`.

#### [T15] Auditoria de Imagens Docker e Integridade do Docker Compose (Anti-Crash)
* **Responsáveis:** `@devops-engineer`, `@qa-engineer` | Gate: `@security-reviewer`
* **Status:** `In review`
* **Evidência no Código:**
  * `docker-compose.yml`: Injeção de `ADMIN_EMAIL`, `ADMIN_PASSWORD` obrigatória e `CORS_ORIGIN` restrito em produção. Alinhamento de healthcheck leve `/health` com tolerância e retries.
  * `dashboard/src/__tests__/dockerIntegrity.test.ts`: Suíte automatizada com 8 testes cobrindo integridade sintática, dependências `depends_on`, validação Zod `envSchema` de produção, healthchecks e consistência com `.env.example`.

#### [T16] Idempotência do seed e migrações
* **Responsáveis:** `@architect`, `@backend-specialist` | Gate: `@security-reviewer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard/src/shared/autoMigrate.ts`: Removida injeção forçada de `contato@clinica.com` na autocura de clientes legados.

#### [T17] Testes de regressão de segurança e gates de validação
* **Responsáveis:** `@qa-engineer` | Gate: `@security-reviewer`
* **Status:** `In review`
* **Evidência no Código:**
  * `dashboard`: 15 arquivos de testes e **114 testes unitários/integração 100% verdes**.
  * `dashboard-web`: 4 arquivos de testes e **11 testes unitários 100% verdes**.
  * Total consolidado: **125 testes automatizados passando 100%**.
