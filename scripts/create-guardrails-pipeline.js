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
  title: "[TASK] Guardrails Anti-Alucinação para Integrações de IA (Validação Normativa, Fática e Grounding)",
  body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico em Saúde e Responsável Técnico Regulatório  
**Quero:** Um sistema robusto de Guardrails Anti-Alucinação pré e pós-inferência da IA  
**Para:** Garantir que o modelo de linguagem JAMAIS invente resoluções fictícias, não cite artigos inexistentes ou revogados, e não aponte infrações deontológicas sem comprovação fática estrita no conteúdo auditado, assegurando segurança jurídica e fidelidade às resoluções do CFM (ex: 2.336/2023) e LGPD.

### Critérios de Aceite
- [ ] **Pre-Execution Guardrails:**
  - Sanitização de inputs contra injeção de prompt e delimitadores maliciosos.
  - Injeção obrigatória de diretrizes rígidas de ancoragem (Grounding Rules) no prompt do sistema e do usuário.
- [ ] **Post-Execution Guardrails (Auditoria em Tempo de Execução):**
  - **Normative Grounding:** Validação cruzada de cada infração apontada contra o rol oficial de normas ativas carregadas no contexto. Normas inexistentes, adulteradas ou marcadas como REVOGADO são interceptadas e expurgadas.
  - **Factuality Verification:** Verificação fática se o trecho citado (\`detectedText\`) de fato existe ou possui correlação fidedigna com o conteúdo auditado. Citações forjadas são sinalizadas como alucinação fática.
  - **Score & Verdict Consistency:** Recálculo e ajuste matemático determinístico da nota e veredito para impedir discrepâncias ilógicas causadas por alucinação.
  - **Hallucination Risk & Grounding Score:** Cálculo do score de ancoragem (\`groundingScore\` 0-100) e índice de risco de alucinação (\`hallucinationRisk\`: NONE, LOW, MEDIUM, HIGH).
- [ ] **Observabilidade & Telemetria:**
  - Registro de auditoria operacional no \`system_logs\` toda vez que uma alucinação for interceptada e tratada.
  - Retorno das métricas de guardrails no payload do laudo e visualização no painel/telemetria.
- [ ] **Testes & QA:**
  - Testes unitários cobrindo detecção de normas inventadas, evidências forjadas, injeção de prompt e expurgo de alucinações (100% verde).
  - Builds frontend e backend sem erros.
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
  fs.writeFileSync(path.join(__dirname, 'current-guardrails-item.json'), JSON.stringify(currentItemData, null, 2));
  console.log(`💾 Item salvo em scripts/current-guardrails-item.json`);
}

main().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
