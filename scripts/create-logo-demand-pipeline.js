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
  title: "[TASK] Identidade Visual 3D Conform.AI & Refatoração UI do Portal Web",
  body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Gestor Regulatório, Auditor Deontológico e Usuário do Sistema ConformIA  
**Quero:** Incorporar a nova identidade visual oficial 3D (logotipo Conform.AI) e refatorar a interface gráfica do portal web (\`dashboard-web\`)  
**Para:** Proporcionar uma experiência visual de padrão corporativo moderno, alinhada à autoridade tecnológica e ética da plataforma em saúde digital, com alto contraste, legibilidade e harmonia com as diretrizes do CFM e LGPD.

### Critérios de Aceite
- [ ] Logotipo oficial 3D (\`be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg\`) integrado na Sidebar do \`MainLayout\`, na tela de Login (\`LoginPage\`) e no favicon da aplicação.
- [ ] Refatoração visual da navegação, cabeçalhos, painéis e cartões harmonizados com a paleta deep blue / cyan do logotipo.
- [ ] Feedback visual aprimorado para estados ativos de navegação, status de conformidade e perfil de usuário autenticado.
- [ ] Responsividade e acessibilidade preservadas com zero erros de compilação (\`tsc\` e \`vite build\`).
- [ ] Suíte de testes automatizados 100% verde.
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
  
  // Salva o itemId em arquivo temporário para os estágios seguintes
  const fs = require('fs');
  fs.writeFileSync('scripts/current-logo-item.json', JSON.stringify({ itemId, title: task.title }, null, 2));
}

main().catch(console.error);
