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

const projectId = "PVT_kwDOFOE58c4BqQlU";
const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
const backlogOptionId = "f75ad846";

const task = {
  title: "[TASK] Refresh Token (1h), Recuperação de Senha & Notificação de Laudo via Resend, Circuit Breaker e Bulkhead",
  body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Gestor de Conformidade Médica, DPO e Responsável Técnico de Clínica  
**Quero:** Sessões seguras com Refresh Token e expiração de 1 hora, recuperação de senha via e-mail transacional (Resend), notificações automáticas de laudos concluídos para a clínica, e blindagem de resiliência com Circuit Breaker e Bulkhead  
**Para:** Garantir conformidade com a LGPD (Art. 11 e 46 - Segurança e Acesso), comunicação ágil de inconformidades éticas (Res. CFM nº 2.336/2023) e alta disponibilidade e tolerância a falhas na infraestrutura de IA e scraping.

### Critérios de Aceite
- [ ] **Atividade 1 (Refresh Token & 1h):** Endpoint \`/auth/refresh\` com rotação de refresh token, expiração do access token reduzida para 1h, e renovação automática no cliente web via interceptor Axios.
- [ ] **Atividade 2 (Recuperação de Senha):** Endpoints \`/auth/forgot-password\` e \`/auth/reset-password\` com envio de link seguro com token temporário via Resend Email API, além de interface web para solicitação e redefinição.
- [ ] **Atividade 3 (Notificação de Laudo Concluído):** Ao finalizar a auditoria (status COMPLETED), disparo automático de e-mail via Resend para o e-mail cadastrado na clínica com score, veredito, resumo e link do laudo.
- [ ] **Atividade 4 (Circuit Breaker & Bulkhead):** Implementação dos padrões de resiliência:
  - Circuit Breaker (estados CLOSED, OPEN, HALF_OPEN) protegendo chamadas de IA e Firecrawl contra efeito cascata de falhas.
  - Bulkhead isolando pools de concorrência máxima e filas para evitar esgotamento de recursos do servidor.
- [ ] Testes unitários e de integração 100% aprovados (\`npx vitest run\`).
- [ ] Compilação de produção (\`npm run build\`) executada com sucesso.
`
};

async function main() {
  console.log('📌 [Estágio 1] Criando Draft Issue no GitHub Projects #3...');
  const addDraftMutation = `
    mutation AddDraft($projectId: ID!, $title: String!, $body: String!) {
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

  const addRes = await requestGraphQL(addDraftMutation, {
    projectId,
    title: task.title,
    body: task.body
  });

  if (addRes.errors) {
    console.error('Erro GraphQL:', JSON.stringify(addRes.errors, null, 2));
    process.exit(1);
  }

  const itemId = addRes.data.addProjectV2DraftIssue.projectItem.id;
  console.log(`✅ Draft Issue criada com ID: ${itemId}`);

  console.log('📌 Movendo item para a coluna [Backlog]...');
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

  console.log(`🎯 [Estágio 1 Concluído] Item ${itemId} posicionado no Backlog com sucesso!`);
  
  const fs = require('fs');
  fs.writeFileSync('scripts/current-resilience-item.json', JSON.stringify({ itemId, title: task.title }, null, 2));
}

main().catch(console.error);
