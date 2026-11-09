const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const projectId = "PVT_kwDOFOE58c4BqQlU";
const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
const backlogOptionId = "f75ad846";

const task = {
  title: "[EPIC] Resiliência Redis/Worker, Abstração de Provedores de IA, Contratos de Auditoria, Testes RAG & Regras Arquiteturais",
  body: `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist)
**Como:** DPO, Arquiteto de Software e Auditor Regulatório em Saúde
**Quero:**
1. Corrigir a política de memória do Redis (\`noeviction\` para integridade de filas BullMQ) e remover senha padrão hardcoded em \`docker-compose.yml\`;
2. Implementar health check e monitoramento ativo do Worker de Auditoria com servidor HTTP dedicado, métricas de uptime/jobs e healthcheck no Docker;
3. Consolidar a abstração desacoplada dos provedores de IA (\`IAIProvider\`, \`GeminiProvider\`, \`OllamaProvider\`, \`HeuristicProvider\` e \`AIProviderFactory\`);
4. Criar contratos estruturados formais para resultados das auditorias (\`AuditResultContract\`, integração no \`AuditReport\` e endpoints dedicados);
5. Implementar testes automatizados de qualidade de RAG (precisão, recall, relevância de contexto, filtragem de revogações e grounding);
6. Formalizar as regras arquiteturais (\`.agents/rules/architecture-rules.md\`) e os 6 agentes de desenvolvimento.

**Para:** Garantir máxima integridade operacional de filas assíncronas, resiliência de infraestrutura em saúde, abstração desacoplada de modelos de linguagem, confiabilidade formal dos laudos deontológicos e conformidade rigorosa com normas do CFM, LGPD e OWASP.

---

### Critérios de Aceite
- [ ] **Atividade 1 (Redis):** \`maxmemory-policy noeviction\`, remoção de senhas default vulneráveis no \`docker-compose.yml\` e documentação em \`.env.example\`.
- [ ] **Atividade 2 (Worker Health & Monitoring):** Servidor HTTP leve em \`dashboard/src/worker.ts\` com endpoints \`/health\` e \`/metrics\`, além de healthcheck nativo configurado no Docker Compose.
- [ ] **Atividade 3 (Abstração IA):** Criação de \`IAIProvider\`, implementações isoladas para Gemini, Ollama e Heurística com Circuit Breakers e gerenciamento via Factory.
- [ ] **Atividade 4 (Contratos Estruturados de Auditoria):** Contrato tipado com Zod integrado ao schema Prisma (\`AuditReport\`), com persistência e endpoint \`GET /api/v1/audits/:id/contract\`.
- [ ] **Atividade 5 (Testes de Qualidade do RAG):** Suíte dedicada \`ragQuality.test.ts\` avaliando acurácia de recuperação, descarte de normas revogadas e ancoragem fática/normativa.
- [ ] **Atividade 6 (Regras Arquiteturais & Agentes):** Criação de \`.agents/rules/architecture-rules.md\` e formalização completa de papéis e diretrizes dos agentes.
- [ ] **Quality Gate:** 100% dos testes unitários e de integração aprovados (\`npm test\`) e builds frontend/backend sem erros.
`
};

async function main() {
  console.log(`📌 [Estágio 1] Criando draft issue no projeto ${projectId}...`);
  const createDraftMutation = `
    mutation CreateDraft($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: {
        projectId: $projectId,
        title: $title,
        body: $body
      }) {
        projectItem {
          id
        }
      }
    }
  `;

  const res = await requestGraphQL(createDraftMutation, {
    projectId,
    title: task.title,
    body: task.body
  });

  if (!res.data || !res.data.addProjectV2DraftIssue) {
    console.error("❌ Erro ao criar draft issue:", JSON.stringify(res, null, 2));
    process.exit(1);
  }

  const itemId = res.data.addProjectV2DraftIssue.projectItem.id;
  console.log(`✅ Item criado com sucesso no Board: ID ${itemId}`);

  console.log(`📌 Posicionando item ${itemId} na coluna Backlog...`);
  const updateStatusMutation = `
    mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $value }
      }) {
        projectItem {
          id
        }
      }
    }
  `;

  await requestGraphQL(updateStatusMutation, {
    projectId,
    itemId,
    fieldId: statusFieldId,
    value: backlogOptionId
  });

  console.log(`✅ Item posicionado na coluna 'Backlog'.`);

  fs.writeFileSync(
    path.join(__dirname, 'current-infra-rag-item.json'),
    JSON.stringify({ itemId, title: task.title }, null, 2)
  );
  console.log(`💾 ID salvo em scripts/current-infra-rag-item.json`);
}

main().catch(err => {
  console.error('❌ Erro inesperado:', err);
  process.exit(1);
});
