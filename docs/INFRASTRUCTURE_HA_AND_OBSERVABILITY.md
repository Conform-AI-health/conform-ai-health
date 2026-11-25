# Infraestrutura de Alta Disponibilidade, Releases Imutáveis & Observabilidade

Este documento consolida os controles operacionais e de conformidade (LGPD Art. 11/46 e rastreabilidade forense de laudos deontológicos) implementados na plataforma **Conform.AI Health**.

---

## 1. Versionamento Imutável, Staging & Rollback em 1 Clique

### Fluxo de Release (`ci-deploy.yml`)
1. Cada push em `main` ou `staging` dispara validação completa (Gitleaks, `typecheck`, Vitest, `build`).
2. As imagens Docker são construídas uma única vez e publicadas no GHCR com **tag imutável** `sha-<7chars>` (sem sobrescrever `latest` ou tags estáticas).
3. **Promoção Staging ➔ Produção:**
   - O job `deploy-staging` implanta a tag `sha-<7chars>` em `/opt/conformia-staging` utilizando [`docker-compose.staging.yml`](../docker-compose.staging.yml).
   - O job `deploy-production` depende explicitamente de `deploy-staging` e promove a **mesma imagem imutável** (sem rebuild) para `/opt/conformia`.
4. **Gate de Aprovação no GitHub:**
   - Em *Settings ➔ Environments*, crie os ambientes `staging` e `production`.
   - Em `production`, habilite **Required reviewers** e associe apenas a branch `main`.
   - Em `staging`, cadastre os secrets isolados: `STAGING_EC2_HOST`, `STAGING_EC2_USER`, `STAGING_EC2_SSH_KEY` e provisione [`.env.staging.example`](../.env.staging.example) apontando para `conformia_staging` e `RESEND_API_KEY=` vazia.

### Rollback Automático e Manual (`rollback.yml` + `scripts/ec2-deploy-release.sh`)
- Antes de atualizar os contêineres, [`scripts/ec2-deploy-release.sh`](../scripts/ec2-deploy-release.sh) persiste `.current_version`, `.previous_version` e registra a trilha em `/opt/conformia/releases.log`.
- Se `/health` da API (`:3333/health`) ou do Worker (`:3001/health`) não convergir para a versão alvo, o script executa **auto-rollback imediato** para `.previous_version`.
- Para rollback manual em 1 clique: acesse **Actions ➔ ConformIA Manual Version Rollback ➔ Run workflow**, escolha `production` ou `staging`, informe `previous` (ou uma tag `sha-XXXX` específica) e descreva o motivo regulatório/técnico.
- [`scripts/ec2-disk-cleanup.sh`](../scripts/ec2-disk-cleanup.sh) retém as **3 últimas versões imutáveis** + `.current_version` + `.previous_version` e **nunca trunca logs ativos**.

---

## 2. Logger Estruturado LGPD & Tracing OpenTelemetry (W3C)

### Logging Estruturado (`pino`)
- Módulo central: [`dashboard/src/shared/logger.ts`](../dashboard/src/shared/logger.ts).
- Formato JSON em `stdout` contendo `timestamp`, `level`, `service` (`conformia-api` | `conformia-worker`), `env`, `version`, `module` e contexto dinâmico via `AsyncLocalStorage` (`requestId`, `traceId`, `spanId`, `auditReportId`, `clientId`, `jobId`).
- **Redação LGPD (`redact`):** campos sensíveis (`password`, `passwordHash`, `authPassword`, `apiKey`, `token`, `refreshToken`, `secret`, `cpf`, `authorization`, `cookie`) são substituídos por `[REDACTED]`.
- Rotação nativa no Docker Compose: driver `json-file` com `max-size: "20m"` e `max-file: "5"`.

### Tracing Distribuído Ponta a Ponta
- Módulo central: [`dashboard/src/shared/tracing.ts`](../dashboard/src/shared/tracing.ts).
- Toda requisição HTTP passa por [`requestObservability`](../dashboard/src/middlewares/requestObservability.ts), recebendo `X-Request-Id` e `X-Trace-Id` W3C (32 hex) e criando span `SpanKind.SERVER`.
- Ao enfileirar jobs no BullMQ (`auditQueue` / `normCrawlQueue`), o carrier W3C (`traceparent`, `tracestate`, `x-request-id`) é injetado no payload e extraído pelo Worker, conectando:
  `HTTP Request` ➔ `BullMQ Job` ➔ `AuditExecutionService` (`audit.scrape`, `audit.reconcile`, `audit.persist_report`) ➔ `ReconciliationEngine` (`audit.rag_retrieval`, `audit.ai_inference`, `audit.guardrails`).
- Para exportar traces a um backend centralizado (Grafana Tempo, AWS X-Ray via ADOT Collector ou SigNoz), basta configurar no `.env`:
  ```env
  OTEL_ENABLED=true
  OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway.seu-provedor/v1/traces
  OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic SEU_TOKEN
  ```

---

## 3. Blueprint de Saída da EC2 Única (Alta Disponibilidade Multi-AZ)

Para eliminar o ponto único de falha (SPOF) e garantir zero-downtime real:

1. **Frontend Estático (`dashboard-web`):**
   - Publicar `dashboard-web/dist` em **Amazon S3 + CloudFront** com OAC, certificado AWS ACM e versionamento de bucket para rollback instantâneo de assets.
2. **Fila & Estado Compartilhado:**
   - **MongoDB Atlas** em M10+ Replica Set Multi-AZ com PITR (*Point-in-Time Recovery*).
   - **Redis Gerenciado** em **AWS ElastiCache** (Replication Group Multi-AZ, TLS em trânsito e senha forte), removendo o container local da EC2.
3. **Compute Desacoplado em ECS Fargate (Multi-AZ):**
   - **Service `conformia-api`:** usar [`infra/aws/ecs-api-task.json`](./aws/ecs-api-task.json), mínimo de **2 tasks** em 2 Availability Zones atrás de um **Application Load Balancer (ALB)** com healthcheck em `/health` e deploy *Rolling / Blue-Green*.
   - **Service `conformia-worker`:** usar [`infra/aws/ecs-worker-task.json`](./aws/ecs-worker-task.json), isolado da API, com auto-scaling baseado no tamanho da fila `auditQueue` e healthcheck na porta `3001`.
4. **Segurança & Coleta:**
   - AWS WAF no CloudFront/ALB, segredos injetados via AWS Secrets Manager (bloco `secrets` já mapeado nos JSONs), logs centralizados no CloudWatch Logs (`/ecs/conformia-prod/*`) e sidecar **AWS Distro for OpenTelemetry (ADOT)** recebendo spans OTLP na porta `4318`.
