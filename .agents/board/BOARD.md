# 📋 Conform.AI - Backlog & Roadmap (GitHub Projects #3)
> **Ciclo de Vida do Pipeline `/plan` (`.agents/rules/plan-pipeline.md`)**  
> **Product Owner & Curadoria Regulatória:** `@compliance-specialist`  
> **Data de Atualização:** 10 de Novembro de 2026  
> **Branch Atual:** `fix/backlog-sprint0-sprint1-security-ai` | **Commit:** `ee7349c`

---

## 🚦 Visão Geral das Colunas do Board

| Status do Board | Total de Tarefas | Tarefas Mapeadas |
|---|:---:|---|
| 📌 **Backlog** | 0 | *(Todas as tarefas migradas para Code Review)* |
| 🔨 **In Progress** | 0 | — |
| 👀 **Code Review** | 26 | **T01 a T19 (Sprint 0/1) + C01 a C07 (Complementares)** |
| 🚀 **Done** | 0 | *(Aguardando aprovação de PR e merge)* |

---

## 📌 Detalhamento das Tarefas Movidas para `Code Review`

### 🛡️ Épico A: Segurança Crítica (Sprint 0 - P0)

#### [T01] Remover admin padrão (admin123456) e reset de senha a cada boot
* **Responsáveis:** `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/config/env.ts`: Zod `superRefine` bloqueando senhas padrão conhecidas e exigindo mínimo de 12 caracteres em produção.
  * `dashboard/src/shared/autoMigrate.ts`: Preservação incondicional do `passwordHash` e credenciais de administradores existentes no banco.
* **Critério de Aceite:** `tsc` aprovado; `authAndResilience.test.ts` validado com rejeição de senhas fracas.

#### [T02] SSRF: saída HTTP segura e restrição estrita de targetUrl
* **Responsáveis:** `@architect`, `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/security.ts`: `safeHttpGet` com suporte estrito a IPv6 (RFC 6052, ULA, link-local), revalidação DNS salto a salto e `maxRedirects: 3`.
  * `dashboard/src/services/scraperService.ts`: Interceptação no Puppeteer (`page.setRequestInterception`) e substituição de `axios.get` por `safeHttpGet`.
  * `dashboard/src/controllers/agentController.ts`: CLIENT bloqueado ao tentar auditar targetUrl externa (403 `ARBITRARY_TARGET_URL_FORBIDDEN`).
* **Critério de Aceite:** `scraperBatch.test.ts` (10/10) e `apiValidation.test.ts` aprovados.

#### [T03] Rotacionar segredos, remover .env dos pacotes e varrer histórico
* **Responsáveis:** `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `.gitignore` e `.dockerignore` (raiz, dashboard e dashboard-web) atualizados com regra estrita para bloquear `.env*`.
  * `.env.example` e `dashboard/.env.example`: Segredos reais removidos e substituídos por placeholders seguros.

#### [T04] XSS armazenado via websiteUrl e whitelist de campos editáveis pelo CLIENT
* **Responsáveis:** `@backend-specialist`, `@frontend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/controllers/clientController.ts`: `websiteUrl` validado via Zod com protocolo `http://` ou `https://`. `PUT /clients/:id` bloqueia alteração de `status`, `cnpj` e responsáveis técnicos por CLIENT (403 `CLIENT_FIELD_FORBIDDEN`).
  * `dashboard-web/src/utils/urlSecurity.ts`: Criado helper `safeHttpUrl()` e aplicado em `ClientsPage.tsx`, `CustomerDashboardPage.tsx` e `ScrapingPage.tsx`.

#### [T05] Isolamento multi-tenant em /agents e /scraped-pages
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/controllers/agentController.ts`: `listModules` e `getModuleById` filtram por tenant e suprimem `systemPrompt` para o perfil `Role.CLIENT`.
  * `dashboard/src/controllers/scrapedPageController.ts`: `getCompatibleAgents` isola agentes privados de outros clientes.

---

### ⚙️ Épico B: Sessão e Hardening (Sprint 1 - P1)

#### [T06] Ciclo de vida de sessão: logout efetivo, reuso de refresh token e single-flight
* **Responsáveis:** `@backend-specialist`, `@frontend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard-web/src/services/api.ts`: Interceptor com fila única (*single-flight mutex*) para renovações de sessão concorrentes em status 401.
  * `dashboard-web/src/context/AuthContext.tsx`: `logout` notifica `/auth/logout` no backend antes de expurgar o storage local.
  * `dashboard/src/controllers/authController.ts`: Revogação via hash SHA-256 no banco de dados.

#### [T07] Rate Limiting diferenciado por rota
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/routes/authRoutes.ts`: Limiter estrito contra brute force (10 reqs/15 min) para login/register/forgot-password e limiter flexível (60 reqs/15 min) para refresh.
  * `dashboard/src/routes/scrapedPageRoutes.ts` e `dashboard/src/routes/agentRoutes.ts`: Rate limiters dedicados para scraping e disparo de auditorias.

#### [T08] E-mails: escapar HTML de conteúdo gerado e corrigir destinatários
* **Responsáveis:** `@backend-specialist` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/services/emailService.ts`: Implementada sanitização com `escapeHtml()` para `clientName`, `targetUrl`, `verdict` e `summary`. Bloqueado envio para e-mail mock (`contato@clinica.com`).
  * `dashboard/src/controllers/clientController.ts`: Fallback hardcoded `contato@clinica.com` removido.

#### [T09] Limites de payload, /system/status sem vazamento e rate limit atrás de proxy
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/app.ts`: Limite global de payload reduzido para `100kb`. Rota `/scraped-pages/upload` aceita até `20mb`.
  * `dashboard/src/controllers/systemController.ts`: Respostas em produção ocultam `err.message` e detalhes de conexão do Mongo/Redis.

#### [T10] Modelos de IA: restringir baseUrl/edição a ADMIN e validar endpoints
* **Responsáveis:** `@backend-specialist`, `@ai-engineer` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/routes/modelRoutes.ts`: Rotas de criação, alteração, ativação e exclusão restritas exclusivamente a `Role.ADMIN`.
  * `dashboard/src/controllers/modelController.ts`: Validação de `baseUrl` contra SSRF.

---

### 🔬 Épico C: IA, RAG e Conformidade (Sprint 1 & 2 - P1/P2)

#### [T11] Grounding do artigo citado e catálogo normativo com vigência/revogação
* **Responsáveis:** `@ai-engineer`, `@backend-specialist`, `@architect` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/reconciliationTypes.ts`: Zod schema `violationSchema` com obrigatoriedade estrita de `normArticle` e `normCode`.
  * `dashboard/src/shared/aiGuardrails.ts`: Expurgadas violações com artigos inexistentes ou normas revogadas.

#### [T12] Detecção de ausência de CRM e RQE com severidade GRAVE/CRÍTICA
* **Responsáveis:** `@ai-engineer`, `@backend-specialist` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/services/ai/heuristicProvider.ts`: Ausência de CRM e especialidade anunciada sem RQE classificadas com severidade `GRAVE` ou `CRITICA` fundamentadas no Art. 1º e Art. 2º da Resolução CFM nº 2.336/2023.

#### [T13] Defesa em camadas contra prompt injection
* **Responsáveis:** `@ai-engineer` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/services/ai/geminiProvider.ts` e `ollamaProvider.ts`: Delimitação do conteúdo auditado em tags XML `<document_to_audit>` com diretriz explícita de dado passivo e não executável.

#### [T14] Normalização de status do laudo e tolerância a falhas de inferência
* **Responsáveis:** `@ai-engineer`, `@backend-specialist` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/services/auditExecutionService.ts` e `agentController.ts`: Transição garantida para `FAILED` com gravação em `SystemLog`, sem deixar execuções presas em `QUEUED`/`RUNNING`.

#### [T15] Auditoria de Imagens Docker e Integridade do Docker Compose (Anti-Crash)
* **Responsáveis:** `@devops-engineer`, `@qa-engineer` | Gate: `@security-reviewer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `docker-compose.yml`: Injeção de `ADMIN_EMAIL`, `ADMIN_PASSWORD` obrigatória e `CORS_ORIGIN` restrito em produção. Alinhamento de healthcheck leve `/health` com tolerância e retries.
  * `dashboard/src/__tests__/dockerIntegrity.test.ts`: Suíte automatizada com 8 testes cobrindo integridade sintática, dependências `depends_on`, validação Zod `envSchema` de produção, healthchecks e consistência com `.env.example`.

#### [T16] Idempotência do seed e migrações
* **Responsáveis:** `@architect`, `@backend-specialist` | Gate: `@security-reviewer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/autoMigrate.ts`: Removida injeção forçada de `contato@clinica.com` na autocura de clientes legados.

#### [T17] Testes de regressão de segurança e gates de validação
* **Responsáveis:** `@qa-engineer` | Gate: `@security-reviewer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard`: 17 arquivos de testes e **138 testes unitários/integração 100% verdes** (incluindo `securityAndAiCorrections.test.ts`).
  * `dashboard-web`: 4 arquivos de testes e **11 testes unitários 100% verdes**.
  * Total consolidado: **149 testes automatizados passando 100%**.

#### [T18] Golden Set Deontológico e Métricas de Qualidade do RAG
* **Responsáveis:** `@compliance-specialist`, `@ai-engineer`, `@qa-engineer` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/__tests__/datasets/deontologicalGoldenSet.ts`: Dataset 100% sintético e versionado com casos regulares, limítrofes, irregulares graves/críticos e injeções de prompt adversariais.
  * `dashboard/src/__tests__/goldenSetEvaluation.test.ts`: Suíte de avaliação com cálculo formal de métricas (acurácia de 92.3%, grounding normativo de 100%, recall de 100% em infrações e 0% de falso positivo).

#### [T19] Documentação Deontológica, Políticas, Licenciamento e Coerência de Regras
* **Responsáveis:** `@architect`, `@compliance-specialist`, `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `README.md`: Documentação completa com matriz regulatória (CFM 2.336/23, CEM, LGPD), arquitetura técnica, como executar com Docker em 1 comando, benchmark de economia de tokens e badges.
  * `SECURITY.md`: Política formal de Responsible Disclosure, canais privados criptografados, SLAs e safe harbor para pesquisadores.
  * `LICENSE`: Licença MIT com adendo deontológico mandatório de isenção médica e necessidade de revisão humana.
  * `.agents/rules/plan-pipeline.md`: Coerência dos tokens de autenticação (Access 1h e Refresh 7d).

---

### 🛡️ Épico D: Correções Complementares de Integridade, Governança e Blindagem (Sprint 1 - P0/P1)

#### [C01] Contrato de confiança da IA, Grounding estrito e eliminação de defaults
* **Responsáveis:** `@compliance-specialist`, `@ai-engineer`, `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/prisma/schema.prisma`: Adicionado status `INCONCLUSIVO` ao enum `Verdict`; removidos defaults hardcoded de `groundingScore: 100` e `hallucinationRisk: 'NONE'`; adicionado campo auditável `normSnapshots String?`.
  * `dashboard/src/shared/aiStructuredContract.ts`: `source_version` sem presunção de '2023' (preserva `null`); `findingSchema.evidence` preserva `null` estrito sem fabricação sintética; regra de ouro deontológica: se veredito for `CONFORME` mas o grounding não foi avaliado (`groundingScore === null`), reclassifica para `INCONCLUSIVO`, com confiança de `0.50` e `requires_human_review = true`.
  * `dashboard/src/services/auditExecutionService.ts`: Persistência de `effectiveVerdict` com suporte ao enum `INCONCLUSIVO` e campos de grounding.
* **Critério de Aceite:** `complementaryCorrections.test.ts` (C01) aprovado com ausência de presunção de conformidade.

#### [C02] Persistência mandatória e rastreabilidade de extração de conteúdo
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/services/firecrawlService.ts`: Lançamento de erro fatal `[PERSISTENCE_FAILED]` caso ocorra falha de banco ao persistir `moduleScrapeData` com `moduleId`; remoção de swallow silencioso de erro; status polimórficos de extração (`EXTRACTION_SUCCESS`, `EXTRACTION_PERSISTED`).
* **Critério de Aceite:** `complementaryCorrections.test.ts` (C02) aprovado com interrupção da auditoria sob falha de banco.

#### [C03] Bootstrap seguro, separação de migrações e isolamento de laudos legados
* **Responsáveis:** `@architect`, `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/autoMigrate.ts`: Separação atômica de `runDatabaseMigrations()`, `runInitialSeed()` e `runDataIntegrityCheck()`; eliminação de catches vazios; remoção da injeção de URL fictícia `https://conform-ia.med.br` e fim do vínculo forçado de laudos a clientes arbitrários.
* **Critério de Aceite:** `authAndResilience.test.ts` aprovado com idempotência e sem perda de histórico.

#### [C04] Defesa contra prompt injection multilíngue e delimitação com Nonce criptográfico
* **Responsáveis:** `@ai-engineer` | Gate: `@security-reviewer` | Compliance: `@compliance-specialist` (Aprovado)
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/aiGuardrails.ts`: Normalização Unicode `NFKC`; sanitização multilíngue em PT e EN no `AIGuardrails.sanitizeInputPrompt`; remoção de tokens de sistema (`<|im_start|>`, `[INST]`, `<<SYS>>`); função `generateSecureAuditBlock` com Nonce randômico dinâmico de 16 bytes.
  * `dashboard/src/services/ai/geminiProvider.ts` e `ollamaProvider.ts`: Integração com `generateSecureAuditBlock` para isolamento de dados passivos não confiáveis.
* **Critério de Aceite:** `complementaryCorrections.test.ts` (C04) aprovado com bloqueio de injeções em PT/EN.

#### [C05] Governança normativa, metadados de vigência e snapshot auditável SHA-256
* **Responsáveis:** `@compliance-specialist`, `@backend-specialist`, `@ai-engineer` | Gate: `@security-reviewer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/data/normsCatalog.ts`: Interface `NormValidityMetadata` com `publishedAt`, `effectiveDate`, `isRevoked`, `officialGazette` e `replacedByNormCode` em todas as normas; inclusão da Res. CFM 1.974/11 com `isRevoked: true` e `replacedByNormCode: 'Res. CFM 2.336/23'`.
  * `dashboard/src/services/normsResolver.ts`: Método `createNormsSnapshot` gerando snapshot serializado com hashes SHA-256 e timestamp.
  * `dashboard/src/services/reconciliationEngine.ts`: Expulso mandatório de normas revogadas de `activeNorms`.
* **Critério de Aceite:** `complementaryCorrections.test.ts` (C05) e `ragQuality.test.ts` 100% aprovados.

#### [C06] Segurança de autenticação frontend, refresh token em memória e cookies HttpOnly
* **Responsáveis:** `@frontend-specialist`, `@backend-specialist` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard-web/src/services/api.ts`: Expurgo total de `conformia_refresh_token` do `localStorage`; gerenciador em memória `inMemoryRefreshToken` anti-XSS; suporte a cookies HttpOnly via `withCredentials: true`; header anti-CSRF `X-Requested-With`; fila mutex *single-flight*; sincronização de abas com `BroadcastChannel`.
  * `dashboard-web/src/context/AuthContext.tsx`: Removida leitura/escrita de refresh token em `localStorage`.
  * `dashboard/src/controllers/authController.ts`: Emissão de cookie `HttpOnly`, `SameSite=Strict`, `Secure` e rotação contínua.
* **Critério de Aceite:** `axiosInterceptor.test.ts` e `authAndResilience.test.ts` 100% aprovados.

#### [C07] Blindagem avançada contra SSRF, variantes numéricas de IP e DNS Rebinding TOCTOU
* **Responsáveis:** `@backend-specialist`, `@architect` | Gate: `@security-reviewer` | QA: `@qa-engineer`
* **Status:** `Code Review`
* **Evidência no Código:**
  * `dashboard/src/shared/security.ts`: Normalização e bloqueio de variantes numéricas de IP (decimal inteiro `2130706433`, hexadecimal `0x7f000001`, octal `0177.0.0.1`, dotted abreviado, IPv6 com colchetes `[::1]`); decodificação de percent-encoding; agentes HTTP com `secureLookup` interceptando resolução de sockets contra ataques DNS Rebinding TOCTOU.
  * `dashboard/src/services/scraperService.ts`: Validação prévia assíncrona com `validateSafeUrlAsync(url)` integrada aos fluxos de Puppeteer, Firecrawl e Protocolo MCP.
* **Critério de Aceite:** `complementaryCorrections.test.ts` (C07) aprovado com bloqueio de variantes numéricas e metadados.

---

### 🛡️ Rodada Complementar de Correções Técnicas — Security, AI Governance & Data Integrity (P0)

| ID | Prioridade | Escopo Técnico | Arquivos Auditados e Corrigidos | Status de Execução | Testes Associados |
|:---:|:---:|---|---|:---:|:---:|
| **T01** | P0 | Healthcheck e readiness do Worker: diferenciação de liveness/readiness, HTTP 503 para DEGRADED/DOWN quando sem capacidade de processar, verificação de Redis e pausa. | `dashboard/src/worker.ts`, `docker-compose.yml` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T01) |
| **T02** | P0 | Proteção de `/metrics`: `MONITORING_API_KEY` obrigatória em produção, bloqueio estrito de query string (`?key=`), autenticação exclusiva por headers (`Authorization: Bearer` ou `X-API-Key`) e comparação segura `timingSafeCompare`. | `dashboard/src/worker.ts`, `dashboard/src/config/env.ts`, `docker-compose.yml` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T02) |
| **T03** | P0 | Bootstrap e provisionamento seguro: remoção de catch silencioso no boot da API, eliminação de comando destrutivo de exclusão de usuários na autocura e preservação idempotente de credenciais administrativas. | `dashboard/src/index.ts`, `dashboard/src/shared/autoMigrate.ts` | ✅ Concluído | `authAndResilience.test.ts` |
| **T04** | P0 (Bloqueador) | Integridade da extração de conteúdo: remoção total de fallback que fabricava Markdown sintético alegando serviços médicos sem dados reais, adoção de erro explícito `EXTRACTION_FAILED` e laudos incompletos com status `FAILED`. | `dashboard/src/services/firecrawlService.ts`, `dashboard/src/services/auditExecutionService.ts` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T04) |
| **T05** | P0 | Proteção SSRF mandatória em todos os fluxos de extração externa: validação assíncrona anti-SSRF com resolução de DNS antes do envio para Firecrawl API e motores de scraping. | `dashboard/src/services/firecrawlService.ts`, `dashboard/src/shared/security.ts` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T05) |
| **T06** | P0 | Contratos de confiança, grounding e alucinação: eliminação de premissas falsas de `100%` e `NONE` em motores heurísticos ou sem verificação; suporte a `null` e `NOT_EVALUATED` quando não calculado. | `dashboard/src/shared/reconciliationTypes.ts`, `dashboard/src/services/ai/heuristicProvider.ts`, `dashboard/src/shared/aiGuardrails.ts` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T06) |
| **T07** | P0 | AI Guardrails e neutralização de injeções de prompt: neutralização de tags delimitadoras (`</document_to_audit>`) e tags de controle de sistema no pré-processamento. | `dashboard/src/shared/aiGuardrails.ts`, `dashboard/src/services/ai/geminiProvider.ts`, `dashboard/src/services/ai/ollamaProvider.ts` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T07) |
| **T08** | P0 | Resolução estruturada e canônica de normas: identificadores canônicos (`authority`, `type`, `number`, `year`, `isRevoked`) e expurgo definitivo de normas revogadas da imputação deontológica. | `dashboard/src/services/normsResolver.ts` | ✅ Concluído | `securityAndAiCorrections.test.ts` (T08) |

---

### 🛡️ Rodada de Correções Complementares — Confiança, Extração, Autocura, SSRF & Governança (C01 a C07)

| ID | Prioridade | Escopo Técnico | Arquivos Auditados e Corrigidos | Status de Execução | Testes Associados |
|:---:|:---:|---|---|:---:|:---:|
| **C01** | P0 | **Contrato de Confiança da IA**: Eliminação de premissas de grounding=100 e hallucinationRisk=NONE; preservação estrita de `null` e `NOT_EVALUATED`; `source_version` sem presunção de 2023; vedação de evidências textuais fabricadas (`null` quando ausente); veredito `INCONCLUSIVO` mandatório se não houver fundamentação avaliada. | `dashboard/src/shared/aiStructuredContract.ts`, `dashboard/src/services/auditExecutionService.ts`, `dashboard/prisma/schema.prisma` | ✅ Concluído | `complementaryCorrections.test.ts` (C01) |
| **C02** | P0 | **Persistência e Integridade de Extração**: Exceção crítica `[PERSISTENCE_FAILED]` lançada em caso de falha no banco de dados ao salvar `moduleScrapeData`; remoção de swallow silencioso de erros; status polimórficos de extração (`EXTRACTION_SUCCESS`, `EXTRACTION_PERSISTED`). | `dashboard/src/services/firecrawlService.ts` | ✅ Concluído | `complementaryCorrections.test.ts` (C02) |
| **C03** | P1 | **Bootstrap e Autocura**: Modularização em etapas independentes (`runDatabaseMigrations`, `runInitialSeed`, `runDataIntegrityCheck`); remoção de catches silenciosos; eliminação de injeção de URL fictícia `https://conform-ia.med.br` e fim do vínculo forçado de laudos a cliente arbitrário. | `dashboard/src/shared/autoMigrate.ts` | ✅ Concluído | `authAndResilience.test.ts` |
| **C04** | P1 | **Blindagem contra Prompt Injection**: Sanitização multilíngue (PT/EN) no `AIGuardrails.sanitizeInputPrompt`; normalização Unicode NFKC; eliminação de tokens de template LLM (`<|im_start|>`, `[INST]`); isolamento criptográfico via `generateSecureAuditBlock` com Nonce randômico dinâmico em Gemini e Ollama. | `dashboard/src/shared/aiGuardrails.ts`, `dashboard/src/services/ai/geminiProvider.ts`, `dashboard/src/services/ai/ollamaProvider.ts` | ✅ Concluído | `complementaryCorrections.test.ts` (C04) |
| **C05** | P1 | **Governança e Vigência Normativa**: Metadados estruturados de vigência (`publishedAt`, `effectiveDate`, `officialGazette`, `isRevoked`, `replacedByNormCode`) em todo o catálogo; registro explícito da revogação da Res. CFM 1.974/11; snapshots auditáveis SHA-256 (`createNormsSnapshot`) persistidos em `AuditReport.normSnapshots`. | `dashboard/src/data/normsCatalog.ts`, `dashboard/src/services/normsResolver.ts`, `dashboard/src/services/auditExecutionService.ts` | ✅ Concluído | `complementaryCorrections.test.ts` (C05), `ragQuality.test.ts` |
| **C06** | P1 | **Segurança da Autenticação Frontend**: Remoção total do `conformia_refresh_token` do `localStorage` no frontend; refresh token em memória estrita anti-XSS (`inMemoryRefreshToken`); suporte a cookies HttpOnly, Secure e SameSite=Strict; header anti-CSRF `X-Requested-With`; fila mutex *single-flight*; sincronização via `BroadcastChannel`. | `dashboard-web/src/services/api.ts`, `dashboard-web/src/context/AuthContext.tsx`, `dashboard/src/controllers/authController.ts` | ✅ Concluído | `axiosInterceptor.test.ts`, `authAndResilience.test.ts` |
| **C07** | P1 | **Blindagem Estrita contra SSRF & DNS Rebinding**: Normalização e bloqueio de variantes numéricas de IP (decimal inteiro `2130706433`, hexadecimal `0x7f000001`, octal `0177.0.0.1`, dotted abreviado, IPv6 com colchetes `[::1]`); decodificação de percent-encoding; agentes HTTP com `secureLookup` interceptando resolução de sockets contra ataques DNS Rebinding TOCTOU; validação prévia assíncrona em Puppeteer, Cheerio, Firecrawl e MCP. | `dashboard/src/shared/security.ts`, `dashboard/src/services/scraperService.ts` | ✅ Concluído | `complementaryCorrections.test.ts` (C07), `taggingAndContext.test.ts` |

