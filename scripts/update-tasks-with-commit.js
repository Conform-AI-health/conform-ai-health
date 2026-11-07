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

const COMMIT_URL = "https://github.com/Conform-AI-health/conform-ai-health/commit/fd1531c7784fb7923769c36868dfd6eb3eaeb157";
const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/crud-modelos-e-refatoracao-layout";
const BRANCH = "feat/crud-modelos-e-refatoracao-layout";

const taskUpdates = {
  'PVTI_lADOFOE58c4BqQlUzhGtvLc': {
    title: '[TASK 1] Remoção da Tela e Rotas de Catálogo Normativo no Frontend',
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Auditor regulatório ou Administrador da Conform.AI  
**Quero:** Que a tela legada de Catálogo Normativo & Deontologia em Saúde seja removida dos menus e rotas de navegação da UI  
**Para:** Simplificar a arquitetura da interface, evitando duplicidade com a base de normas indexadas do MongoDB (/scraping) e mantendo apenas as APIs necessárias para alimentação de contexto.

---

## 🏛️ Contexto Regulatório & Deontológico
- **CFM nº 2.314/2022 & 2.336/2023:** A indexação de normas médicas e deontológicas deve ocorrer de forma unificada e transparente no módulo de base regulatória ativa.
- **LGPD em Saúde:** Evitar exposição de dados duplicados ou interfaces legadas sem auditoria de acesso.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Acesso ao menu de navegação lateral
  Dado que o usuário está autenticado no dashboard
  Quando visualizar o menu lateral
  Então não deve mais constatar o item "Diretrizes do CFM" nem "Catálogo de Normas" apontando para /norms

Cenário: Tentativa de acesso direto à rota legada /norms
  Dado que o usuário digita a URL "/norms" na barra de navegação
  Quando a aplicação processar a rota
  Então deve redirecionar automaticamente para "/cockpit" sem gerar erros 404
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Alteração de \`dashboard-web/src/components/MainLayout.tsx\`.
2. Alteração de \`dashboard-web/src/App.tsx\` removendo a rota e importação de \`NormsPage\`.

---

## 🔗 Rastreabilidade e Pipeline
- **Branch:** \`${BRANCH}\` (criada a partir da \`main\` atualizada)
- **Commit:** [fd1531c](${COMMIT_URL})
- **Pull Request:** [Abrir PR no GitHub](${PR_URL})
- **Status:** In review`
  },
  'PVTI_lADOFOE58c4BqQlUzhGtvMQ': {
    title: '[TASK 2] Blindagem do Login e Remoção de Credenciais Expostas e Autofill',
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Administrador do Sistema e Encarregado de Proteção de Dados (DPO)  
**Quero:** Que a tela de login não exiba credenciais administrativas oficiais (admin@conform.ai / admin123456) nem o botão de autofill ("Preencher")  
**Para:** Proteger o acesso de produção e mitigar riscos de segurança da informação e não conformidade com a LGPD.

---

## 🏛️ Contexto Regulatório & Deontológico
- **LGPD (Art. 46):** Obrigatoriedade de medidas de segurança técnicas e administrativas aptas a proteger dados pessoais de acessos não autorizados.
- **OWASP Top 10 - Identification and Authentication Failures:** Eliminação de hardcoded/exposed credentials em interfaces públicas.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Acesso à tela de autenticação
  Dado que um usuário não autenticado acessa a tela de Login
  Quando a página for renderizada
  Então os campos de e-mail e senha devem iniciar estritamente em branco
  E nenhum bloco de credenciais oficiais ou botão "Preencher" deve ser exibido
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Refatoração de \`dashboard-web/src/pages/LoginPage.tsx\`.
2. Remoção do estado de autofill e dos blocos informativos com senhas em texto puro.

---

## 🔗 Rastreabilidade e Pipeline
- **Branch:** \`${BRANCH}\` (criada a partir da \`main\` atualizada)
- **Commit:** [fd1531c](${COMMIT_URL})
- **Pull Request:** [Abrir PR no GitHub](${PR_URL})
- **Status:** In review`
  },
  'PVTI_lADOFOE58c4BqQlUzhGtvNE': {
    title: '[TASK 3] Desacoplamento da Seleção de Modelos do .env e CRUD Dinâmico no MongoDB',
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Administrador e Engenheiro de IA da plataforma Conform.AI  
**Quero:** Que a parametrização do modelo de IA seja desacoplada das variáveis de ambiente (.env) e migrada para o MongoDB com um CRUD completo gerenciável via painel  
**Para:** Permitir a alternância dinâmica de motores de inteligência artificial em tempo de execução sem reinicialização de containers.

---

## 🏛️ Contexto Regulatório & Deontológico
- **CFM nº 2.314/2022 (Telemedicina e IA Médica):** Rastreabilidade explícita da infraestrutura e dos modelos utilizados na geração de pareceres e diagnósticos.
- **Governança de IA:** Flexibilidade operacional entre Gemini, Ollama Local e Motor Heurístico com segregação de chaves de API e segredos institucionais.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Criação de novo modelo de IA no banco
  Dado que um administrador acessa o CRUD de Modelos
  Quando cadastrar um novo provedor com credenciais e modelo
  Então o registro deve ser persistido no MongoDB na coleção AiModelConfig

Cenário: Alternância do modelo ativo
  Dado que existem múltiplos modelos cadastrados
  Quando o administrador selecionar um modelo como "Ativo"
  Então o ReconciliationEngine deve invalidar o cache e passar a utilizar o novo modelo imediatamente
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Atualização do Prisma Schema (\`schema.prisma\`) com a model \`AiModelConfig\`.
2. Seed automático em \`autoMigrate.ts\` garantindo Gemini, Ollama e Heurística.
3. Rotas e Controller em \`/models\` protegidos por JWT e role ADMIN com paginação e mascaramento de senhas.
4. Atualização de \`reconciliationEngine.ts\` com consulta dinâmica e cache em memória.
5. Suíte de testes automatizados \`modelCrud.test.ts\` com 100% de cobertura.

---

## 🔗 Rastreabilidade e Pipeline
- **Branch:** \`${BRANCH}\` (criada a partir da \`main\` atualizada)
- **Commit:** [fd1531c](${COMMIT_URL})
- **Pull Request:** [Abrir PR no GitHub](${PR_URL})
- **Status:** In review`
  },
  'PVTI_lADOFOE58c4BqQlUzhGtvOM': {
    title: '[TASK 4] Refatoração Ergonômica de Layout em Abas no Módulo de Agentes e Cockpit',
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Auditor regulatório ou Médico Auditor  
**Quero:** Que as telas "Módulos de Agente & Auditoria Deontológica" e "Cockpit do Auditor Deontológico" possuam layouts organizados em abas lógicas e ergonômicas  
**Para:** Eliminar poluição visual e botões soltos, garantindo uma navegação coesa para operação de auditorias imediatas, diagnóstico de modelos e visualização analítica.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Ergonomia e Usabilidade Clínica:** Interfaces em saúde exigem clareza visual, prevenção de erros operacionais e fácil localização de alertas críticos.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Navegação na tela de Módulos de Agentes
  Dado que o usuário acessa a página de Agentes
  Quando visualizar a interface
  Então o conteúdo deve estar organizado em 3 abas claras:
    1. "Módulos de Auditoria"
    2. "Modelos de IA & Conexões (CRUD)"
    3. "Disparar Auditoria Imediata"

Cenário: Navegação no Cockpit do Auditor Deontológico
  Dado que o usuário acessa o Cockpit
  Quando visualizar a interface
  Então o conteúdo deve estar organizado em 3 abas claras:
    1. "Panorama & Indicadores"
    2. "Nova Auditoria Imediata"
    3. "Últimos Laudos Concluídos"
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Refatoração de \`dashboard-web/src/pages/AgentsPage.tsx\`.
2. Refatoração de \`dashboard-web/src/pages/DashboardPage.tsx\`.
3. Integração com o CRUD de modelos de IA e teste de conectividade.
4. Total aderência ao Tailwind CSS e design system corporativo.

---

## 🔗 Rastreabilidade e Pipeline
- **Branch:** \`${BRANCH}\` (criada a partir da \`main\` atualizada)
- **Commit:** [fd1531c](${COMMIT_URL})
- **Pull Request:** [Abrir PR no GitHub](${PR_URL})
- **Status:** In review`
  }
};

async function main() {
  for (const [itemId, info] of Object.entries(taskUpdates)) {
    const queryNode = `
      query GetItemContent($itemId: ID!) {
        node(id: $itemId) {
          ... on ProjectV2Item {
            content {
              ... on DraftIssue {
                id
              }
            }
          }
        }
      }
    `;
    const nodeRes = await requestGraphQL(queryNode, { itemId });
    const draftIssueId = nodeRes?.data?.node?.content?.id;
    if (!draftIssueId) {
      console.log(`Could not find draftIssueId for ${itemId}:`, JSON.stringify(nodeRes));
      continue;
    }

    const mutation = `
      mutation UpdateDraftIssue($draftIssueId: ID!, $title: String!, $body: String!) {
        updateProjectV2DraftIssue(input: {
          draftIssueId: $draftIssueId
          title: $title
          body: $body
        }) {
          draftIssue {
            id
            title
          }
        }
      }
    `;
    const res = await requestGraphQL(mutation, {
      draftIssueId,
      title: info.title,
      body: info.body
    });
    console.log(`Updated Task ${itemId} (DraftIssue ${draftIssueId}):`, JSON.stringify(res));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
