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
  title: "[EPIC] Blindagem Docker, Contrato Estruturado de IA, Telemetria Avançada & Estrutura .agents",
  body: `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist)
**Como:** DPO, Arquiteto de Software e Auditor Regulatório em Saúde  
**Quero:**
1. Auditoria e blindagem de segurança no \`docker-compose.yml\` (remover fallbacks de segredos em plaintext, isolar portas, restringir privilégios e adicionar healthchecks/limites de recursos);
2. Novo contrato de saída estruturado na integração com a IA com campos de \`audit_id\`, \`risk_level\`, \`confidence\`, \`findings\` e \`requires_human_review\`;
3. Telemetria avançada de IA e observabilidade completa (latência de inferência, tokens entrada/saída, custo em USD/BRL por auditoria, taxa de respostas sem evidências, taxa de citações inválidas, divergência humano vs IA, falhas por modelo e histórico de prompts/versões);
4. Reestruturação do repositório de agentes em \`.agents/agents/\` e \`.agents/skills/\` conforme a taxonomia corporativa solicitada.  
**Para:** Garantir máxima segurança de infraestrutura (OWASP/LGPD), precisão cirúrgica sem dependência de texto livre do LLM em conformidade com as resoluções do CFM (ex: 2.336/2023) e rastreabilidade total do ciclo de vida dos modelos.

### Critérios de Aceite
- [ ] **Atividade 1 (Segurança Docker):** Remoção de segredos hardcoded, bloqueio de portas expostas do Redis no host, healthcheck em todas as etapas, limites de memória/CPU e segurança de privilégios.
- [ ] **Atividade 2 (Contrato Estruturado):** Implementação e validação Zod do contrato com \`audit_id\`, \`risk_level\`, \`confidence\`, \`findings\` com \`source_version\` e \`requires_human_review\`.
- [ ] **Atividade 3 (Telemetria Avançada):** Endpoint e UI de observabilidade com latência, custo em USD/BRL, taxas de alucinação de evidência e citação, divergência humano/IA, falhas por modelo e versionamento de prompts.
- [ ] **Atividade 4 (Estrutura .agents):** Criação dos agentes (\`architect.md\`, \`backend-specialist.md\`, etc.) e skills (\`rag-engineering\`, \`prompt-engineering\`, etc.).
- [ ] Suíte de testes automatizados com 100% de aprovação.
- [ ] Compilação de frontend e backend com 0 erros.
`
};

async function main() {
  console.log(`📌 [Estágio 1] Criando draft issue no projeto ${projectId}...`);
  const createDraftMutation = `
    mutation CreateDraft($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: {
        projectId: $projectId
        title: $title
        body: $body
      }) {
        projectItem {
          id
        }
      }
    }
  `;

  const createRes = await requestGraphQL(createDraftMutation, {
    projectId,
    title: task.title,
    body: task.body
  });

  if (!createRes.data || !createRes.data.addProjectV2DraftIssue) {
    console.error("Erro ao criar draft issue:", JSON.stringify(createRes));
    process.exit(1);
  }

  const itemId = createRes.data.addProjectV2DraftIssue.projectItem.id;
  console.log(`✅ Draft issue criada com id: ${itemId}`);

  console.log(`📌 Posicionando item ${itemId} em [Backlog]...`);
  const setStatusMutation = `
    mutation SetStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `;

  const statusRes = await requestGraphQL(setStatusMutation, {
    projectId,
    itemId,
    fieldId: statusFieldId,
    optionId: backlogOptionId
  });

  console.log(`✅ Item posicionado no Backlog:`, JSON.stringify(statusRes));

  const currentItemData = {
    itemId,
    title: task.title
  };
  fs.writeFileSync(path.join(__dirname, 'current-security-telemetry-item.json'), JSON.stringify(currentItemData, null, 2));
  console.log(`💾 Item salvo em scripts/current-security-telemetry-item.json`);
}

main().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
