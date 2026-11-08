# 📘 Conform.AI Health — Fluxo Detalhado do Projeto e Arquitetura do Sistema

> **Documento Oficial de Engenharia & Arquitetura de Software**  
> **Versão:** 1.2.0  
> **Última Atualização:** 2026-11-08  
> **Marcos Regulatórios:** Resolução CFM nº 2.336/2023, Resolução CFM nº 2.314/2022, Lei Geral de Proteção de Dados (LGPD - Lei 13.709/18, Art. 11), ANVISA RDC nº 727/2022 e ANS RN 509/395.

---

## 📑 Sumário Executivo

O **Conform.AI Health** é uma plataforma distribuída de alta disponibilidade voltada para a **governança ética, deontológica e regulatória automatizada de instituições e profissionais de saúde** em seus canais digitais (websites, portais de agendamento e redes públicas).

O ecossistema realiza vigilância contínua 24/7 combinando **raspagem limpa de dados via Firecrawl**, **resolução dinâmica de normas jurídicas no MongoDB Atlas**, **orquestração de Inteligência Artificial generativa com fallback resiliente de três camadas** e **agendamento temporal autônomo (Cron/BullMQ)**.

---

## 🏛️ 1. Arquitetura Geral do Ecossistema

O sistema adota uma arquitetura em camadas orientada a microsserviços e workers concorrentes, desacoplando a experiência visual no navegador do processamento pesado de extração e reconciliação com IA:

```mermaid
flowchart TB
    subgraph Frontend ["🖥️ Cliente Web (dashboard-web)"]
        UI_Login["Tela de Autenticação (LoginPage)"]
        UI_Cockpit["Cockpit do Auditor (DashboardPage)"]
        UI_Agents["Gestão de Módulos & Cron (AgentsPage)"]
        UI_Scraping["Varredura & Tags (ScrapingPage)"]
        UI_Clients["Onboarding de Clínicas (ClientsPage)"]
        UI_Reports["Laudos & Auditoria (ReportsPage)"]
        UI_Telemetry["Telemetria IA & Logs (LogsTelemetryPage)"]
        UI_Portal["Portal do Cliente Regulado (CustomerDashboardPage)"]
    end

    subgraph API_Gateway ["🚪 API RESTful (Express & TypeScript)"]
        AuthMiddleware["JWT & RBAC Middleware\n(enforceTenantIsolation)"]
        AgentCtrl["AgentController\n(Validação Zod & Cron)"]
        ClientCtrl["ClientController\n(CRM, RQE, CNPJ)"]
        ScraperCtrl["ScraperController\n(Varredura DOU & PDFs)"]
        ReportCtrl["ReportController\n(Laudos & Histórico)"]
        SystemCtrl["SystemController\n(Diagnóstico de IA)"]
    end

    subgraph Scheduler_Queue ["⏱️ Mensageria & Agendamento Assíncrono"]
        SchedulerService["AuditSchedulerService\n(Parser Cron UNIX + PollTimer 30s)"]
        RedisServer[("⚡ Redis Server 7.x")]
        BullQueue["BullMQ\n('auditQueue' - Repeatable Jobs)"]
        WorkerProcess["Worker de Auditoria\n(worker.ts)"]
    end

    subgraph Extraction_Layer ["🕷️ Ingestão & Raspagem Web"]
        FirecrawlService["FirecrawlService\n(Markdown Limpo + SHA-256)"]
        ScraperService["ScraperService Cheerio / PDF\n(DOU jsonArray & Detecção WAF)"]
        SecuritySanitizer["Security Engine\n(SSRF / RFC 1918 Block)"]
    end

    subgraph Intelligence_Layer ["🧠 Inteligência Deontológica & IA"]
        NormsResolver["NormsResolver\n(Filtro de Tags & Exclusão REVOGADO)"]
        PromptAssembler["Montador de Contexto\n(Persona + Normas + Markdown Raspado)"]
        ReconciliationEngine["ReconciliationEngine\n(Orquestrador Multimodelos)"]
        GeminiFlash["Google Gemini 3.5 Flash\n(Nuvem Primária)"]
        OllamaLocal["Ollama Local\n(Fallback On-Premise)"]
        HeuristicEngine["Motor Heurístico Determinístico\n(Fallback Offline de Segurança)"]
    end

    subgraph Storage_Layer ["💾 Camada de Persistência (MongoDB Atlas)"]
        DB_Users[("users\n(Contas & Roles)")]
        DB_Clients[("clients\n(Instituições Médicas)")]
        DB_Modules[("agent_modules\n(Agentes, Skills & Crons)")]
        DB_Scraped[("scraped_pages\n(Catálogo de Normas)")]
        DB_ScrapeData[("module_scrape_data\n(Markdowns & ContentHashes)")]
        DB_Reports[("audit_reports\n(Laudos, Infrações & Scores)")]
        DB_Logs[("system_logs\n(Telemetria, Tokens & Fontes)")]
    end

    %% Conexões Frontend -> API
    Frontend --> AuthMiddleware
    AuthMiddleware --> AgentCtrl & ClientCtrl & ScraperCtrl & ReportCtrl & SystemCtrl

    %% Conexões API -> Serviços
    AgentCtrl --> SchedulerService
    SchedulerService --> BullQueue
    SchedulerService --> DB_Modules
    BullQueue --> RedisServer
    RedisServer --> WorkerProcess

    %% Execução de Auditoria
    WorkerProcess --> FirecrawlService
    AgentCtrl -. Disparo Imediato .-> FirecrawlService
    FirecrawlService --> DB_ScrapeData
    FirecrawlService --> ReconciliationEngine
    ReconciliationEngine --> NormsResolver
    NormsResolver --> DB_Scraped
    NormsResolver --> PromptAssembler
    PromptAssembler --> GeminiFlash
    GeminiFlash -. Falha/503 .-> OllamaLocal
    OllamaLocal -. Falha/404 .-> HeuristicEngine
    ReconciliationEngine --> DB_Reports
    ReconciliationEngine --> DB_Logs
```

---

## 🔄 2. Detalhamento dos Fluxos Operacionais

### 2.1. Fluxo de Onboarding de Clínicas Médicas e Isolamento Multi-Tenant

Garante a segregação estrita de dados clínicos conforme exigido pela LGPD e pelos códigos de ética médica.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrador / Auditor
    participant UI as Portal Web (ClientsPage)
    participant API as ClientController
    participant Prisma as Prisma ORM
    participant DB as MongoDB Atlas

    Admin->>UI: Preenche Razão Social, CNPJ, CRM/UF e RQE
    UI->>API: POST /api/v1/clients (Payload com validação Zod)
    API->>API: Valida formato do CNPJ e CRM/UF obrigatórios
    API->>Prisma: client.create(data)
    Prisma->>DB: Inserção na collection 'clients'
    DB-->>Prisma: Registro persistido com ObjectId
    API->>Prisma: user.create(role: 'CLIENT', clientId)
    Prisma->>DB: Inserção do usuário credenciado
    API-->>UI: Retorna HTTP 201 Created + Token de Acesso da Clínica
    UI-->>Admin: Notificação Toast de Onboarding Concluído
```

---

### 2.2. Fluxo de Varredura Normativa, Ingestão no DOU e Etiquetagem de Revogação

O sistema alimenta seu repositório de dispositivos legais através de scrapers especializados:

```mermaid
flowchart TD
    StartVarredura["Início da Varredura Normativa"] --> InputURL["Recebe URL Alvo Oficial\n(ex: Imprensa Nacional DOU ou Diário Oficial)"]
    InputURL --> Fetch["ScraperService.scrape(url)"]
    
    Fetch --> CheckWAF{"Detectou WAF / Anti-Bot\nou Desafio Interativo?"}
    CheckWAF -- Sim --> SafeBlock["Bloqueio Seguro Ético:\nRegistra alerta de bloqueio e orienta\nuso da fonte aberta direta."]
    
    CheckWAF -- Não --> CheckPDF{"A resposta é\num arquivo PDF?"}
    CheckPDF -- Sim --> ParsePDF["Ingestão via 'pdf-parse':\nExtrai texto estruturado preservando artigos."]
    CheckPDF -- Não --> CheckDOU{"A página possui\npayload 'jsonArray' (DOU)?"}
    
    CheckDOU -- Sim --> SplitArticles["Decomposição em Múltiplos Documentos:\nItera cada item do array gerando um\nregistro individual para cada ato/resolução."]
    CheckDOU -- Não --> CheerioClean["Extração via Cheerio:\nRemove scripts, banners e converte para Markdown."]

    ParsePDF --> DetectTags
    SplitArticles --> DetectTags
    CheerioClean --> DetectTags["Auto-Tagging Regulatória:\nDetecta menções a CFM, LGPD, ANVISA, ANS"]

    DetectTags --> CheckRevogado{"Conteúdo contém\n'revogado', 'revoga-se'\nou 'sem efeito'?"}
    CheckRevogado -- Sim --> ApplyRevogadoTag["Aplica a Tag: REVOGADO\nNorma sinalizada como inativa."]
    CheckRevogado -- Não --> ApplyActiveTag["Aplica Tags Vigentes\n(ex: CFM, LGPD, ANVISA)"]

    ApplyRevogadoTag --> SaveMongo["Persiste na collection 'scraped_pages'\ncom contentHash SHA-256 e metadata."]
    ApplyActiveTag --> SaveMongo
```

---

### 2.3. Fluxo de Configuração do Módulo de Agente & Agendamento Contínuo (Cron)

O módulo de agente reúne a **Skill deontológica**, as **Tags de vínculo** e o **Padrão temporal** de auditoria:

```mermaid
sequenceDiagram
    autonumber
    actor Auditor as Auditor Deontológico
    participant Cockpit as AgentsPage (Cockpit)
    participant API as AgentController
    participant Scheduler as AuditSchedulerService
    participant BullMQ as BullMQ / Redis
    participant DB as MongoDB Atlas

    Auditor->>Cockpit: Seleciona módulo e define URL Alvo Canônica
    Auditor->>Cockpit: Aplica Template da Skill (ex: Deontologia CFM 2.336/23)
    Auditor->>Cockpit: Define periodicidade (ex: '0 */6 * * *' - A cada 6 horas)
    Auditor->>Cockpit: Clica em "Salvar Diretrizes & Configuração"
    Cockpit->>API: PUT /api/v1/agents/:id (name, targetUrl, systemPrompt, tags, cronSchedule)
    API->>API: Valida expressão Cron via AuditSchedulerService.isValidCron (5 campos UNIX)
    API->>DB: prisma.agentModule.update(cronSchedule, systemPrompt, etc.)
    API->>Scheduler: syncAgentSchedule(agentId)
    Scheduler->>Scheduler: Calcula próxima execução (getNextRunDate)
    Scheduler->>BullMQ: Registra/Atualiza Repeatable Job com padrão Cron
    Scheduler->>Scheduler: Atualiza mapa de estados ativos em memória
    API-->>Cockpit: HTTP 200 OK + Agente Atualizado
    Cockpit-->>Auditor: Exibe toast de sucesso e badge com o cron ativo
```

---

### 2.4. Fluxo do Motor de Agendamento em Background (Loop 24/7)

O motor atua de forma ininterrupta, garantindo a execução programada tanto em clusters com Redis quanto em instâncias isoladas com timer de contingência:

```mermaid
stateDiagram-v2
    [*] --> Inicializacao: index.ts / worker.ts bootstrap
    Inicializacao --> Sincronizacao: AuditSchedulerService.init()
    Sincronizacao --> RegistroBullMQ: Registra repeatable jobs na fila 'auditQueue'
    Sincronizacao --> AtivacaoTimer: Inicia pollTimer (verificação a cada 30s)
    
    state "Verificação Contínua (a cada 30 segundos)" as Loop30s {
        AtivacaoTimer --> ChecaHorarios: Compara now >= nextRunAt
        ChecaHorarios --> Ignora: Horário ainda não alcançado
        ChecaHorarios --> AvaliaConcorrencia: Horário vencido!
        
        AvaliaConcorrencia --> JaEmExecucao: agentId já presente em runningAudits?
        JaEmExecucao --> Ignora: Aguarda ciclo anterior finalizar
        
        AvaliaConcorrencia --> DisparaAuditoria: Sem concorrência ativa
        DisparaAuditoria --> CriaLaudoPendente: Cria Laudo 'PENDING' no MongoDB Atlas
        CriaLaudoPendente --> RegistraLog: Log operacional com correlationId
        CriaLaudoPendente --> ExecutaReconciliacao: Chama AuditExecutionService.execute()
        ExecutaReconciliacao --> AtualizaProximaData: Recalcula nextRunAt e remove de runningAudits
    }
```

---

### 2.5. Fluxo de Reconciliação Deontológica com IA & Resolução de Normas

O núcleo analítico onde ocorre o confronto entre o conteúdo digital capturado e o acervo normativo:

```mermaid
flowchart TD
    Trigger["Disparo da Auditoria\n(Manual Imediato ou Cron Programado)"] --> ScrapeTarget["FirecrawlService.scrape(targetUrl)\nExtração limpa para Markdown e\ncálculo do contentHash SHA-256"]
    
    ScrapeTarget --> SaveScrape["Salva snapshot em 'module_scrape_data'\ncom URL, markdown e hash único."]
    SaveScrape --> ResolveNorms["NormsResolver.resolveByTags(agent.tags)"]
    
    subgraph Norms_Filter ["Filtro Rigoroso de Deontologia"]
        ResolveNorms --> QueryDB["Consulta collection 'scraped_pages'\nfiltrando pelas tags do módulo (ex: CFM, LGPD)"]
        QueryDB --> CheckTagRevogada{"Documento possui a\ntag 'REVOGADO'?"}
        CheckTagRevogada -- Sim --> ExcludeRevogada["🚫 EXCLUI ESTRITAMENTE:\nNorma revogada é descartada e não entra no prompt."]
        CheckTagRevogada -- Não --> IncludeVigente["⚖️ INCLUI NO CONTEXTO:\nNorma oficial ativa é selecionada."]
    end

    ExcludeRevogada --> AssemblePrompt
    IncludeVigente --> AssemblePrompt["Montagem do Prompt Deontológico:\n1. Persona & Skill Comportamental do Agente\n2. Normas Vigentes Selecionadas\n3. Markdown Oficial Raspado via Firecrawl\n4. Schema JSON Estrito de Veredito"]

    AssemblePrompt --> SendToGemini["Tentativa Primária:\nGoogle Gemini 3.5 Flash API"]
    SendToGemini --> CheckGemini{"Resposta Gemini\nVálida e Rápida?"}
    
    CheckGemini -- Sim --> ParseJSON["Parsing & Validação do JSON do Laudo"]
    CheckGemini -- Não / Erro 503 --> FallbackOllama["Fallback Camada 2:\nOllama Local (On-Premise)"]
    
    FallbackOllama --> CheckOllama{"Resposta Ollama\nRecebida com Sucesso?"}
    CheckOllama -- Sim --> ParseJSON
    CheckOllama -- Não / Erro 404 --> FallbackHeuristic["Fallback Camada 3:\nMotor Heurístico Baseado em Regras\n(Valida CRM, RQE, Antes/Depois, Preços e Consentimento)"]

    FallbackHeuristic --> ParseJSON
    
    ParseJSON --> ComputeScore["Cálculo de Indicadores:\n- Score Deontológico (0 a 100)\n- Veredito (CONFORME, PARCIALMENTE_CONFORME, NAO_CONFORME)\n- Lista de Violações com Dispositivo Legal e Recomendação"]
    
    ComputeScore --> PersistReport["Atualiza Laudo em 'audit_reports'\ncom Status 'COMPLETED' e veredito."]
    ComputeScore --> PersistTelemetry["Registra em 'system_logs':\nTokens consumidos, latência em ms,\nprovedor de IA utilizado e\nlista exata de normas/fontes consideradas."]
```

---

## 📊 3. Modelo de Dados Relacional & NoSQL (MongoDB Atlas / Prisma)

```mermaid
erDiagram
    Client ||--o{ User : "possui"
    Client ||--o{ AuditReport : "alvo de"
    Client ||--o{ AgentModule : "configura"

    AgentModule ||--o{ ModuleScrapeData : "histórico de raspagem"
    AgentModule ||--o{ AuditReport : "executa"

    Client {
        string id PK
        string name
        string tradeName
        string cnpj
        string crmResponsavel
        string crmUf
        string rqe
        string[] digitalChannels
        datetime createdAt
    }

    User {
        string id PK
        string email
        string password
        string role "ADMIN | AUDITOR | CLIENT"
        string clientId FK
    }

    AgentModule {
        string id PK
        string name
        string code UK
        string targetUrl
        string systemPrompt "Skill / Persona"
        string[] tags
        string extractionMode "FIRECRAWL | CHEERIO"
        string cronSchedule "Expressão UNIX"
        boolean enabled
        string clientId FK
    }

    ModuleScrapeData {
        string id PK
        string agentModuleId FK
        string targetUrl
        string cleanMarkdown
        string contentHash "SHA-256"
        string source "FIRECRAWL_API | FIRECRAWL_FALLBACK"
        datetime scrapedAt
    }

    ScrapedPage {
        string id PK
        string url UK
        string title
        string cleanText
        string contentHash "SHA-256"
        string[] tags "CFM, LGPD, REVOGADO"
        string category
        datetime updatedAt
    }

    AuditReport {
        string id PK
        string clientId FK
        string targetUrl
        string verdict "CONFORME | PARCIAL | NAO_CONFORME"
        int score "0 a 100"
        json violations "Lista de Infrações"
        string summary
        string status "PENDING | RUNNING | COMPLETED | FAILED"
        int tokensUsed
        datetime createdAt
    }

    SystemLog {
        string id PK
        string level "INFO | WARN | ERROR"
        string module "AUDIT_SCHEDULER | RECONCILIATION"
        string correlationId FK
        string message
        json details "Fontes, Normas e Tokens"
        datetime createdAt
    }
```

---

## 🛠️ 4. Matriz de Componentes e Responsabilidades no Código

| Componente | Caminho do Arquivo | Responsabilidade Técnica Principal |
| :--- | :--- | :--- |
| **AuditSchedulerService** | `dashboard/src/services/auditSchedulerService.ts` | Motor temporal autônomo. Validação de expressões Cron de 5 campos, cálculo de `nextRunAt`, registro de repeatable jobs no BullMQ e polling de segurança a cada 30 segundos. |
| **ReconciliationEngine** | `dashboard/src/services/reconciliationEngine.ts` | Orquestrador de IA de 3 camadas (Gemini -> Ollama -> Heurística). Processa vereditos deontológicos, score e violações normativas. |
| **NormsResolver** | `dashboard/src/services/normsResolver.ts` | Resolução dinâmica de dispositivos legais no MongoDB Atlas via tags, com **exclusão incondicional de normas com a tag `REVOGADO`**. |
| **FirecrawlService** | `dashboard/src/services/firecrawlService.ts` | Extração de páginas web para Markdown limpo via API do Firecrawl ou motor nativo, calculando hashes SHA-256 para auditoria rastreável. |
| **ScraperService** | `dashboard/src/services/scraperService.ts` | Varredura de páginas regulatórias complexas, Diário Oficial da União (DOU com decomposição `jsonArray`) e leitura de PDFs oficiais via `pdf-parse`. |
| **MainLayout** | `dashboard-web/src/components/MainLayout.tsx` | Layout corporativo responsivo em dark glass, incorporando o novo logotipo oficial 3D `CONFORM.AI`, menu lateral RBAC e monitor em tempo real dos marcos regulatórios. |
| **AgentsPage** | `dashboard-web/src/pages/AgentsPage.tsx` | Cockpit central de módulos. Permite configuração unificada da URL Alvo Oficial, Persona/Skill deontológica, seletor de tags e campo de Cron com presets recomendados. |
| **LoginPage** | `dashboard-web/src/pages/LoginPage.tsx` | Tela de autenticação com apresentação do emblema 3D da Conform.AI, aura azul/ciano e formulário estilizado com credenciais seguras. |
| **LogsTelemetryPage** | `dashboard-web/src/pages/LogsTelemetryPage.tsx` | Painel de observabilidade de IA, telemetria de tokens consumidos e diálogo modal para inspeção detalhada de todas as fontes/normas utilizadas na inferência. |

---

## 🛡️ 5. Ciclo de Vida e Pipeline de Engenharia (`plan-pipeline.md`)

Qualquer nova funcionalidade ou refatoração no projeto segue **obrigatoriamente o ciclo em 5 estágios sequenciais**:

```mermaid
flowchart LR
    S1["1. PO & Backlog\n@compliance-specialist\nCria Issue no Board #3"] --> S2["2. Engenharia Full-Stack\n@software-architect\n@backend-engineer\n@frontend-engineer\nStatus: [In Progress]"]
    S2 --> S3["3. SecOps & LGPD\n@security-engineer\nQuality Gate OWASP/SSRF"]
    S3 --> S4["4. QA & Testes\n@test-specialist\n100% Verde (Vitest)\nStatus: [In review]"]
    S4 --> S5["5. Git & Rastreabilidade\n@devops-engineer\nBranch dedicada,\nCommit refs e PR"]
```

1. **Estágio 1 (Product Owner):** Decomposição em Histórias de Usuário, critérios de aceitação e registro no GitHub Projects Board #3 (`Backlog`).
2. **Estágio 2 (Arquitetura & Engenharia):** Movimentação para `In Progress`, implementação no backend/frontend com TypeScript estrito.
3. **Estágio 3 (Segurança & SecOps):** Validação contra SSRF, sanitização de inputs, limites de taxa e segregação de tenants.
4. **Estágio 4 (Engenharia de Testes):** Criação e execução de testes unitários e de integração (100% aprovados), transição da issue para `In review`.
5. **Estágio 5 (Git & Rastreabilidade):** Branch dedicada com Conventional Commits referenciando o ID da tarefa (`refs #PVTI_...`) e envio para o repositório remoto.

---

## 🚀 6. Guia Rápido de Execução

### Execução Local dos Testes
```bash
# Executa todos os testes de frontend e backend
npx vitest run
```

### Compilação de Produção
```bash
# Compila o backend (TypeScript) e o frontend (Vite)
npm run build
```

### Inicialização com Docker Compose
```bash
# Sobe todo o ecossistema (MongoDB, Redis, API, Worker e Frontend Web)
docker compose up -d --build
```
