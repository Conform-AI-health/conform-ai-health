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

const tasks = [
  {
    title: "[TASK 1] Remoção da Tela e Rotas de Catálogo Normativo no Frontend",
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Auditor regulatório ou Administrador da Conform.AI  
**Quero:** Que a tela legada de Catálogo Normativo & Deontologia em Saúde seja removida dos menus e rotas de navegação da UI  
**Para:** Simplificar a arquitetura da interface, evitando duplicidade com a base de normas indexadas do MongoDB (/scraping) e mantendo apenas as APIs necessárias para alimentação de contexto.

---

### ⚖️ Contexto Regulatório & Deontológico
- As normas do CFM (Res. 2.336/23, 2.314/22), LGPD, ANVISA e ANS continuam estruturadas e servidas via endpoints do backend para os agentes e varreduras.
- A visualização das normas passa a ser centralizada no repositório de documentos indexados no MongoDB.

---

### 🧪 Critérios de Aceitação (BDD / Gherkin)
\`\`\`gherkin
Cenário: Remoção dos links de Catálogo de Normas no Menu Lateral
  Dado que o usuário está navegando no sistema
  Quando visualiza a barra lateral (MainLayout)
  Então não devem existir os links "Diretrizes do CFM" nem "Catálogo de Normas" apontando para /norms.

Cenário: Proteção de Rotas
  Dado que um usuário tenta acessar diretamente a URL /norms
  Quando a rota for avaliada pelo React Router
  Então o usuário deve ser redirecionado para /cockpit ou para a base de normas indexadas.
\`\`\`

---

### 🛠️ Entregáveis Técnicos
1. [MODIFY] \`dashboard-web/src/components/MainLayout.tsx\`: Remover itens de menu para \`/norms\`.
2. [MODIFY] \`dashboard-web/src/App.tsx\`: Remover rota \`/norms\` e importação de \`NormsPage\`.
3. [SAFEGUARD]: Manter os endpoints de API (\`/api/v1/norms/catalog\`) intactos para preenchimento de seletores de agentes.
`
  },
  {
    title: "[TASK 2] Blindagem da Tela de Login: Remoção de Credenciais Oficiais e Autofill",
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance & SecOps)
**Como:** Especialista de Segurança & Encarregado de Proteção de Dados (DPO)  
**Quero:** Que a tela de login não exiba credenciais administrativas em texto claro nem possua botões de auto-preenchimento (autofill)  
**Para:** Garantir conformidade com as boas práticas da LGPD (Art. 46) e OWASP Top 10 (A07: Identification and Authentication Failures), impedindo acesso facilitado não autorizado em ambientes compartilhados.

---

### ⚖️ Contexto Regulatório & Deontológico
- **LGPD Art. 46:** Dever de adotar medidas de segurança, técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados.
- **OWASP ASVS & Top 10:** Credenciais administrativas nunca devem ser expostas na UI ou pré-populadas em formulários de autenticação.

---

### 🧪 Critérios de Aceitação (BDD / Gherkin)
\`\`\`gherkin
Cenário: Formulário de login limpo e sem credenciais expostas
  Dado que um usuário acessa a página de login (/login)
  Quando a tela é renderizada
  Então os campos de e-mail e senha devem iniciar estritamente vazios
  E o card "Credenciais Administrativas Oficiais: admin@conform.ai" e botão "Preencher" não devem existir na tela.
\`\`\`

---

### 🛠️ Entregáveis Técnicos
1. [MODIFY] \`dashboard-web/src/pages/LoginPage.tsx\`:
   - Remover função \`fillQuickLogin\`.
   - Remover bloco JSX com credenciais administrativas e botão "Preencher".
   - Garantir estados iniciais \`email = ''\` e \`password = ''\`.
`
  },
  {
    title: "[TASK 3] Migração Dinâmica do Motor de IA do .env para Banco de Dados (CRUD AiModelConfig)",
    body: `## 📋 Visão Geral & História de Usuário (Arquitetura & Backend)
**Como:** Administrador do Sistema Conform.AI  
**Quero:** Gerenciar os modelos de Inteligência Artificial diretamente via banco de dados MongoDB através de um CRUD completo  
**Para:** Poder adicionar, editar, ativar e alternar novos modelos (Gemini 2.0 Flash, Gemini Pro, Ollama Qwen2.5, Llama 3, Heurística) sem necessidade de alterar arquivos de ambiente (.env) ou reiniciar containers em produção.

---

### ⚖️ Contexto Regulatório & Deontológico
- **Auditoria CFM 2.336/2023:** Permite testar modelos com diferentes parâmetros de temperatura, tokens e system prompts para auditoria regulatória.
- **Rastreabilidade:** Cada laudo de auditoria deve registrar o modelo exato que realizou a inferência.

---

### 🧪 Critérios de Aceitação (BDD / Gherkin)
\`\`\`gherkin
Cenário: CRUD de Modelos de IA
  Dado que o administrador envia uma requisição POST /api/v1/models
  Quando cadastra um novo modelo com provider, modelId e parâmetros
  Então o modelo deve ser persistido no MongoDB na coleção ai_model_configs.

Cenário: Ativação em Tempo Real sem Restart
  Dado que existe mais de um modelo cadastrado
  Quando o administrador ativa um modelo via POST /api/v1/models/:id/activate
  Então o ReconciliationEngine deve carregar imediatamente as credenciais e parâmetros deste modelo.
\`\`\`

---

### 🛠️ Entregáveis Técnicos
1. [PRISMA] \`dashboard/prisma/schema.prisma\`: Adicionar model \`AiModelConfig\` (nome, provider, modelId, baseUrl, apiKey, temperature, maxTokens, isActive, isDefault).
2. [BACKEND] Controller & Rotas:
   - \`GET /api/v1/models\` (listagem paginada)
   - \`POST /api/v1/models\` (criação com validação Zod)
   - \`PUT /api/v1/models/:id\` (atualização)
   - \`DELETE /api/v1/models/:id\` (remoção segura)
   - \`POST /api/v1/models/:id/activate\` (ativação em runtime)
3. [ENGINE] \`ReconciliationEngine.ts\`: Leitura do modelo ativo via MongoDB (com cache in-memory de alta performance).
4. [SEED]: Inserção inicial dos 3 modelos padrão (Gemini 2.0 Flash, Ollama Local e Heurística) no banco.
`
  },
  {
    title: "[TASK 4] Refatoração de Layout com Abas em Módulos de Agente e Cockpit do Auditor",
    body: `## 📋 Visão Geral & História de Usuário (Frontend & UX)
**Como:** Auditor Deontológico e Administrador do Conform.AI  
**Quero:** Uma interface organizada e fluida utilizando abas (tabs) e cards agrupados nas telas "Módulos de Agente" e "Cockpit do Auditor"  
**Para:** Eliminar botões e seletores soltos, proporcionando uma navegação ergonômica, moderna e produtiva.

---

### ⚖️ Contexto de Usabilidade & Ergonomia
- Resolução dos botões flutuantes e desalinhados:
  - Na tela **Módulos de Agente & Auditoria Deontológica**: Unificar o seletor de provedor, o botão "Testar Modelo de IA" e o botão "Cadastrar Novo Agente" em um Header/Toolbar harmonioso com abas estruturadas:
    - Aba 1: **Módulos de Agente Cadastrados** (Grid paginada de agentes)
    - Aba 2: **Configuração & CRUD de Modelos de IA** (Gestão visual dos modelos do banco)
    - Aba 3: **Disparo Rápido de Auditoria**
  - No **Cockpit do Auditor Deontológico (Dashboard)**:
    - Aba 1: **Métricas & Visão Geral Deontológica** (KPIs de conformidade, scores semáforo)
    - Aba 2: **Nova Auditoria Imediata** (Formulário integrado e limpo de disparo)
    - Aba 3: **Últimos Laudos de Conformidade**

---

### 🧪 Critérios de Aceitação (BDD / Gherkin)
\`\`\`gherkin
Cenário: Navegação por Abas em Módulos de Agente
  Dado que o usuário está na tela AgentsPage.tsx
  Quando alterna entre as abas "Módulos de Agente" e "Modelos de IA"
  Então o conteúdo deve transicionar suavemente sem botões desconectados ou quebras de layout.

Cenário: Navegação por Abas no Cockpit do Auditor
  Dado que o usuário está na tela DashboardPage.tsx
  Quando visualiza o Cockpit
  Então o botão "Nova Auditoria Imediata" e os seletores devem estar agrupados na aba correspondente de execução.
\`\`\`

---

### 🛠️ Entregáveis Técnicos
1. [COMPONENT] Criação ou padronização de componente de Abas (\`Tabs\`).
2. [MODIFY] \`dashboard-web/src/pages/AgentsPage.tsx\`: Refatoração da barra de ações e inclusão de abas organizadas.
3. [MODIFY] \`dashboard-web/src/pages/DashboardPage.tsx\`: Refatoração do Cockpit com abas analíticas e formulário de auditoria estruturado.
`
  }
];

async function createAllTasks() {
  console.log("🚀 Estágio 1: Registrando as 4 tarefas detalhadas no GitHub Projects Board...");

  for (const t of tasks) {
    console.log(`\n📌 Criando: ${t.title}...`);
    const createDraftMutation = `
      mutation($projectId: ID!, $title: String!, $body: String!) {
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

    const createRes = await requestGraphQL(createDraftMutation, {
      projectId,
      title: t.title,
      body: t.body
    });

    const item = createRes?.data?.addProjectV2DraftIssue?.projectItem;
    if (!item?.id) {
      console.error("Falha ao criar draft issue:", JSON.stringify(createRes, null, 2));
      continue;
    }

    console.log(`✅ Item criado com ID: ${item.id} (databaseId: ${item.databaseId})`);

    // Posicionar na coluna Backlog
    const updateFieldMutation = `
      mutation($input: UpdateProjectV2ItemFieldValueInput!) {
        updateProjectV2ItemFieldValue(input: $input) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await requestGraphQL(updateFieldMutation, {
      input: {
        projectId,
        itemId: item.id,
        fieldId: statusFieldId,
        value: { singleSelectOptionId: backlogOptionId }
      }
    });

    console.log(`📌 Posicionado na coluna BACKLOG com sucesso.`);
  }

  console.log("\n🎉 Todas as 4 tarefas foram criadas e registradas com sucesso no Backlog do GitHub Projects!");
}

createAllTasks().catch(console.error);
