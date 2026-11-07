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

function requestREST(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'ConformIA-Bot',
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

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

const issueTitle = `[STORY] Teste Interativo de IA em Agentes e Paginação Universal de Tabelas do Banco`;

const issueBody = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Épico:** Cockpit de Inteligência Regulatória, Auditoria Deontológica e Escalabilidade de Dados

### 🎯 Contexto e Necessidade de Negócio
1. **Diagnóstico Imediato do Modelo de IA:** Auditores e administradores precisam verificar em tempo real se o modelo de inteligência artificial ativo (Google Gemini 2.0 Flash / Ollama / Heurístico) está respondendo adequadamente antes de disparar auditorias em lote que consomem recursos e tokens.
2. **Escalabilidade & Performance na Visualização (Paginação):** À medida que a base de clientes, laudos, logs e normas cresce no MongoDB Atlas, consultas sem paginação sobrecarregam a API e a memória do navegador. É mandatório implementar paginação server-side com controles interativos na UI.

### 📝 Critérios de Aceitação (User Stories)
- **História 1 (Teste de IA):**
  - *Como auditor regulatório, quero clicar em um botão 'Testar Modelo de IA' na página de Agentes para verificar se a IA está ativa, medindo latência e integridade da resposta.*
  - **Critérios:** Exibir status (ONLINE/OFFLINE), latência em ms, provedor ativo e amostra de inferência em modal/toast.
- **História 2 (Paginação Universal):**
  - *Como usuário do sistema, quero navegar de forma paginada nas tabelas do banco com controles de próxima/anterior e seletor de limite.*
  - **Critérios:** Paginação no backend via \`skip\` e \`take\` com retorno do total de registros e total de páginas; controles responsivos no frontend.

---

## 🏗️ Estágio 2: Arquitetura & Engenharia Full-Stack (@software-architect, @backend-engineer, @frontend-engineer)
- **Backend:**
  - Novo endpoint: \`POST /api/v1/system/test-ai\` para executar ping estruturado de inferência com medição de latência.
  - Paginação nos endpoints: \`GET /api/v1/agents\`, \`GET /api/v1/clients\`, \`GET /api/v1/reports\`, \`GET /api/v1/system/logs\` e \`GET /api/v1/scraped-pages\`.
- **Frontend:**
  - Botão 'Testar Modelo' e modal de diagnóstico em \`AgentsPage.tsx\`.
  - Componente reutilizável \`Pagination.tsx\` aplicado em todas as tabelas de dados.

---

## 🛡️ Estágio 3: Segurança & DevSecOps (@security-engineer)
- Teto estrito de paginação (\`limit <= 100\`) contra ataques de DoS por memória.
- Sanitização de prompts de teste de IA para evitar vazamento ou injeção.
- Autenticação e RBAC mantidos em todos os endpoints paginados.

---

## 🧪 Estágio 4: QA & Testes Automatizados (@test-specialist)
- Testes unitários para o endpoint de teste de IA.
- Testes de validação dos parâmetros de paginação (\`page\`, \`limit\`, limites inválidos).
- Teste de renderização do componente de paginação no frontend.
`;

async function main() {
  console.log('1. Criando GitHub Issue formal...');
  const createRes = await requestREST('POST', '/repos/Conform-AI-health/conform-ai-health/issues', {
    title: issueTitle,
    body: issueBody,
    labels: ['user-story', 'padrão-po', 'compliance', 'backend', 'frontend']
  });

  if (createRes.status !== 201) {
    console.error('Falha ao criar issue:', createRes);
    return;
  }

  const issue = createRes.data;
  console.log(`✅ Issue #${issue.number} criada com sucesso! URL: ${issue.html_url}`);

  console.log('\n2. Adicionando Issue ao Project 3 (Conform.AI - Backlog & Roadmap)...');
  const projectId = "PVT_kwDOFOE58c4BqQlU";
  const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
  const backlogOptionId = "f75ad846"; // "Backlog"

  const addMutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  `;

  const addRes = await requestGraphQL(addMutation, {
    projectId,
    contentId: issue.node_id
  });

  const itemId = addRes.data?.addProjectV2ItemById?.item?.id;
  console.log(`✅ Item adicionado ao Projeto 3! Item ID: ${itemId}`);

  console.log('\n3. Posicionando card na coluna [Backlog]...');
  const updateMutation = `
    mutation($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) {
        projectV2Item {
          id
        }
      }
    }
  `;

  await requestGraphQL(updateMutation, {
    input: {
      projectId,
      itemId,
      fieldId: statusFieldId,
      value: { singleSelectOptionId: backlogOptionId }
    }
  });

  console.log(`✅ Issue #${issue.number} posicionada com sucesso no [Backlog] do board!`);
}

main().catch(console.error);

