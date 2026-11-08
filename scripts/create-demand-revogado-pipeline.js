const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync('powershell -Command "[System.Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\', \'User\')"', { encoding: 'utf8' }).trim();
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
  title: "[TASK] Desconsiderar Normas Revogadas (Tag REVOGADO) na Análise de Auditoria Imediata",
  body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico e Motor de IA do ConformIA  
**Quero:** Que qualquer norma, resolução ou ato normativo indexado que possua a tag 'REVOGADO' seja sumariamente desconsiderado e expurgado da resolução de contexto das auditorias imediatas  
**Para:** Garantir o Princípio da Eficácia Normativa e Segurança Jurídica (CFM / LGPD / ANVISA / ANS), impedindo que normas revogadas continuem alimentando o contexto do modelo de IA e gerando apontamentos indevidos.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Princípio da Legalidade e Vigência Normativa:** Dispositivos deontológicos expressamente revogados (ex: Res. CFM 1.974/2011 superada pela 2.336/2023) não possuem eficácia executiva.
- **Eficiência de Tokens e IA Governance:** Evitar injeção desnecessária de tokens e ruído no prompt do modelo de IA.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Resolução de normas para auditoria imediata
  Dado que existem normas indexadas no banco MongoDB com tags "CFM" e "REVOGADO"
  E existem normas ativas vigentes com tag "CFM"
  Quando o sistema executar o NormsResolver e ReconciliationEngine para um agente com tag "CFM"
  Então as normas contendo a tag "REVOGADO" devem ser expurgadas da lista de normas ativas
  E nenhuma norma revogada deve ser injetada no contexto do modelo de IA
  E a telemetria não deve registrar normas revogadas como fontes ativas de análise
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Atualizar \`NormsResolver.ts\` para filtrar estritamente normas com tag \`REVOGADO\` (ou variações de revogação) ao consultar \`scraped_pages\`, catálogo e arquivos físicos.
2. Atualizar \`ReconciliationEngine.ts\` para garantir que apenas normas plenamente vigentes componham \`activeNorms\` e \`sourcesUsed\`.
3. Testes automatizados cobrindo a exclusão de normas revogadas na resolução de contexto.
`
};

async function main() {
  console.log("🚀 [Estágio 1] Criando Draft Issue no GitHub Project 3...");
  const mutation = `
    mutation AddTask($projectId: ID!, $title: String!, $body: String!) {
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
  const res = await requestGraphQL(mutation, {
    projectId,
    title: task.title,
    body: task.body
  });

  const itemId = res?.data?.addProjectV2DraftIssue?.projectItem?.id;
  console.log(`✅ Draft Issue criada: ${itemId} - ${task.title}`);

  if (itemId) {
    // Posiciona em Backlog
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
    await requestGraphQL(setStatusMutation, {
      projectId,
      itemId,
      fieldId: statusFieldId,
      optionId: backlogOptionId
    });
    console.log(`📌 Item ${itemId} posicionado no [Backlog] (Estágio 1 OK)`);

    const fs = require('fs');
    fs.writeFileSync('scripts/current-revogado-item.json', JSON.stringify({ itemId, title: task.title }, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
