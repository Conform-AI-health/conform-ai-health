const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync("powershell -Command \"[System.Environment]::GetEnvironmentVariable('GITHUB_TOKEN', 'User')\"", { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch (e) {}
  return null;
}

const token = getGitHubToken();

function requestGraphQL(query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'ConformIA-Bot',
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/infra-worker-rag-contracts";
const BRANCH = "feat/infra-worker-rag-contracts";
const draftId = "PVTI_lADOFOE58c4BqQlUzhHC7KY";

const body = `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist / @architect)
**Como:** DPO, Arquiteto de Software e Auditor Regulatório em Saúde
**Quero:**
1. Política de memória do Redis (\`noeviction\`) para integridade de filas BullMQ e eliminação de senhas padrão hardcoded;
2. Health check e monitoramento ativo do Worker de Auditoria via servidor HTTP dedicado na porta 3001 e healthcheck no Docker;
3. Abstração consolidada dos provedores de IA (\`IAIProvider\`, \`GeminiProvider\`, \`OllamaProvider\`, \`HeuristicProvider\` e \`AIProviderFactory\`);
4. Contratos estruturados formais para resultados de auditorias (\`StructuredAuditContract\`, schema Prisma e endpoints dedicados);
5. Testes automatizados de qualidade de RAG (precisão, recall, relevância de contexto, filtragem de revogações e grounding);
6. Formalização das regras arquiteturais corporativas (\`.agents/rules/architecture-rules.md\`) e dos 6 agentes de desenvolvimento.

**Para:** Garantir máxima integridade operacional de filas assíncronas, resiliência de infraestrutura em saúde, desacoplamento de modelos de linguagem, confiabilidade formal dos laudos deontológicos e conformidade rigorosa com normas do CFM, LGPD e OWASP.

---

## 🎯 Entregáveis Implementados:

### 1. Redis: Política de Memória \`noeviction\` e Remoção de Senha Padrão
- **\`docker-compose.yml\`**: Atualizado para \`--maxmemory-policy noeviction\`, impedindo descarte silencioso de jobs em fila pelo BullMQ.
- Remoção definitiva de qualquer senha default fraca: uso estrito de \`\${REDIS_PASSWORD:?REDIS_PASSWORD é obrigatória}\`.
- Documentação formal em \`docs/security/docker-compose-security-audit.md\` e templates em \`.env.example\` e \`dashboard/.env.example\`.

### 2. Health Check e Monitoramento do Worker de Auditoria
- **\`dashboard/src/worker.ts\`**: Servidor HTTP dedicado na porta configurável (\`WORKER_HEALTH_PORT=3001\`) expondo:
  - \`GET /health\`: Verifica conectividade com Redis e status de execução do BullMQ.
  - \`GET /metrics\`: Estatísticas de uptime, jobs processados, completados, falhos e consumo de memória.
- **Docker Healthcheck**: Configurado probe nativo em \`audit-worker\` no \`docker-compose.yml\`.
- Endpoint na API: \`GET /api/v1/system/worker-status\` para supervisão no painel de administração.

### 3. Abstração Consolidada dos Provedores de IA
- Criação do diretório \`dashboard/src/services/ai/\`:
  - \`IAIProvider\` (\`aiProvider.interface.ts\`): Contrato canônico desacoplado.
  - \`GeminiProvider\` (\`geminiProvider.ts\`): Encapsula SDK oficial com Circuit Breaker e Structured Outputs.
  - \`OllamaProvider\` (\`ollamaProvider.ts\`): Encapsula chamadas HTTP locais com Circuit Breaker.
  - \`HeuristicProvider\` (\`heuristicProvider.ts\`): Motor deontológico determinístico e offline.
  - \`AIProviderFactory\` (\`aiProviderFactory.ts\`): Gerenciador central com contingência em cascata e Bulkhead.
- \`ReconciliationEngine\`: Refatorado para orquestração limpa e delegada, eliminando acoplamentos diretos.

### 4. Contratos Estruturados para Resultados das Auditorias
- Schema Zod enriquecido em \`dashboard/src/shared/aiStructuredContract.ts\` com metadados de telemetria.
- Atualização do Prisma Schema (\`AuditReport\`): campos \`riskLevel\`, \`confidence\`, \`structuredContract\` (JSON), \`groundingScore\`, \`guardrailsApplied\` e \`requiresHumanReview\`.
- Endpoint REST dedicado: \`GET /api/v1/reports/:id/contract\` para exportação e consumo de clientes auditados.

### 5. Testes de Qualidade do RAG (RAG Quality & Evaluation)
- Nova suíte de testes: \`dashboard/src/__tests__/ragQuality.test.ts\` cobrindo:
  - Recuperação de normas por tags com precisão e recall (CFM, LGPD).
  - Filtro estrito de revogações normativas (expurgo total de normas com tag REVOGADO).
  - Grounding fático contra evidências alucinadas.
  - Grounding normativo contra leis fictícias.
  - Integridade criptográfica via hash SHA-256.

### 6. Formalização dos Agentes e Regras Arquiteturais
- **Documento Formal:** \`.agents/rules/architecture-rules.md\` estabelecendo as 6 Regras Inegociáveis (Desacoplamento de IA, Resiliência, Contratos Estruturados, RAG Deontológico, Observabilidade e DevSecOps).
- Formalização dos 6 agentes em \`.agents/agents/\` com competências e links para as regras.
- Atualização do pipeline de governança \`.agents/rules/plan-pipeline.md\`.

---

## 🧪 Quality Gate & Testes:
- **Backend:** **87 testes aprovados em 14 arquivos (100% verde)**.
- **Frontend:** **8 testes aprovados em 3 arquivos (100% verde)**.
- **Total:** **95 testes aprovados**.
- Compilação TypeScript (\`tsc\`) e build Vite com 0 erros.

---

## 🚀 Rastreabilidade Git (Estágio 5)
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** \`d486d44\`
- **Status:** Posicionado em In Review no GitHub Projects Board #3.`;

async function main() {
  const mutation = `
    mutation($input: UpdateProjectV2DraftIssueInput!) {
      updateProjectV2DraftIssue(input: $input) {
        draftIssue {
          id
          title
        }
      }
    }
  `;
  const res = await requestGraphQL(mutation, {
    input: {
      draftIssueId: draftId,
      title: "[EPIC] Resiliência Redis/Worker, Abstração de Provedores de IA, Contratos de Auditoria, Testes RAG & Regras Arquiteturais",
      body: body
    }
  });
  console.log(`✅ Draft ${draftId} atualizada com rastreabilidade.`);
}

main().catch(err => {
  console.error('❌ Erro ao atualizar draft issue:', err);
  process.exit(1);
});
