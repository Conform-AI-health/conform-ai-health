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

const newTasks = [
  {
    title: "[TASK 1] Ajuste no Fluxo e Modal de Cadastro de Clínicas/Clientes Regulados",
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Encarregado de Conformidade ou Gestor de Instituição Médica  
**Quero:** Cadastrar um novo cliente/clínica regulada através de um modal com os campos essenciais: Razão Social, Nome Fantasia, CNPJ formatado, Status (Ativo/Inativo), E-mail de Compliance e Telefone de Plantão  
**Para:** Simplificar o onboarding da clínica na plataforma em estrita conformidade com a LGPD (Art. 46) e Resoluções CFM nº 2.336/2023, eliminando campos desnecessários no fluxo inicial.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Resolução CFM nº 2.336/2023:** Identificação fidedigna da instituição médica e dos canais de notificação ética.
- **LGPD em Saúde (Lei nº 13.709/2018, Art. 46):** Coleta orientada ao princípio da necessidade e minimização de dados no cadastro de clínicas.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Abertura do modal "Novo Cliente Regulado"
  Dado que o usuário está na tela de Clínicas/Clientes
  Quando clicar no botão para adicionar novo cliente
  Então deve abrir o modal com cabeçalho "Novo Cliente Regulado"
  E exibir os campos: Razão Social *, Nome Fantasia, CNPJ *, Status (Ativo/Inativo), E-mail de Notificação / Compliance e Telefone de Plantão

Cenário: Submissão de cadastro com dados válidos
  Dado que o usuário preenche Razão Social, CNPJ e E-mail de Compliance
  Quando acionar o botão "Cadastrar"
  Então a clínica deve ser persistida com sucesso no MongoDB
  E a listagem atualizada sem erros de validação
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Atualização do schema Prisma (\`schema.prisma\`) tornando campos secundários (\`crmResponsavel\`, \`crmUf\`, \`websiteUrl\`) opcionais para acomodar o fluxo de onboarding inicial.
2. Atualização de validação Zod no backend (\`clientController.ts\`).
3. Refatoração visual do modal em \`dashboard-web/src/pages/ClientsPage.tsx\` replicando fielmente o layout fornecido na imagem.
`
  },
  {
    title: "[TASK 2] Ajuste no Fluxo e Modal de Cadastro de Módulos de Agentes Regulatórios",
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Auditor Deontológico ou Engenheiro de IA da Conform.AI  
**Quero:** Cadastrar módulos de agentes regulatórios com vínculo de cliente, marco regulatório (CFM 2.336/2023, etc.), nome, slug identificador, descrição/escopo, frequência de execução com atalhos de Cron e modo de extração polimórfico (Scraping Web, Datalink/API, MCP Server) com seus parâmetros  
**Para:** Permitir a orquestração precisa e rastreável de agentes de auditoria segundo as diretrizes de IA do CFM nº 2.314/2022.

---

## 🏛️ Contexto Regulatório & Deontológico
- **CFM nº 2.314/2022 (Telemedicina e IA):** Vinculação estrita entre o agente autônomo e o marco regulatório auditado.
- **CFM nº 2.336/2023 (Publicidade Médica):** Agendamento e parâmetros de extração direcionados para auditoria de canais digitais.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Abertura do modal "Cadastrar Módulo de Agente"
  Dado que o usuário está na aba "Módulos de Auditoria" da tela de Agentes
  Quando acionar "Cadastrar Novo Agente"
  Então deve ser exibido o modal com:
    - Cliente Vinculado (Select dinâmico)
    - Marco Regulatório (Select: CFM 2.336/2023, CFM 2.314/2022, LGPD)
    - Nome do Agente e Código Identificador (Slug)
    - Descrição e Escopo
    - Frequência de Execução (Cron) com botões rápidos (1 hora, 6 horas padrão, 10 min, 5s teste)
    - Status do Agente (Ativo/Inativo)
    - Seção Modo de Extração Polimórfico com 3 cards: Scraping Web, Datalink/API, MCP Server
    - Parâmetros condicionais de extração (URL Alvo / Target URL para Scraping)

Cenário: Seleção do modo de extração
  Dado que o modal de cadastro está aberto
  Quando o usuário alternar entre "Scraping Web", "Datalink / API" e "MCP Server"
  Então o sub-bloco de parâmetros deve se adaptar dinamicamente ao modo escolhido
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Atualização do \`schema.prisma\` no modelo \`AgentModule\` para suportar campos adicionais (\`clientId\`, \`regulatoryFramework\`, \`cronSchedule\`, \`targetUrl\`).
2. Ajustes na API de agentes (\`agentController.ts\`).
3. Reestruturação completa do formulário modal em \`dashboard-web/src/pages/AgentsPage.tsx\` replicando o design visual e botões da imagem.
`
  },
  {
    title: "[TASK 3] Painel de Teste de Modelo de IA com Seleção de Modelos Cadastrados e Ação de Ativação",
    body: `## 📋 Visão Geral & História de Usuário (P.O. Compliance)
**Como:** Administrador e Engenheiro de IA da Conform.AI  
**Quero:** Que o modal de Teste de Modelo de IA liste os modelos cadastrados no banco de dados (MongoDB), permita selecionar qual modelo testar, exiba o diagnóstico de resposta/latência e ofereça a ação direta de Ativar o modelo selecionado  
**Para:** Simplificar a validação operacional e a alternância rápida do modelo ativo de produção diretamente pela interface.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Resolução CFM nº 2.314/2022:** Garantia de disponibilidade e aferição de latência dos motores de IA aplicados a laudos e auditorias de saúde.
- **Governança de IA:** Rastreamento transparente de qual modelo está ativo e capacidade de failover manual/automático entre provedores (Gemini, Ollama, Heurística).

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Abertura do modal de Teste de Modelo de IA
  Dado que o usuário aciona "Testar Modelo de IA"
  Quando o modal for renderizado
  Então deve carregar e listar os modelos cadastrados do banco de dados (/api/v1/models)
  E indicar claramente qual modelo é o atualmente "Ativo"

Cenário: Execução do teste de conectividade
  Dado que um modelo foi selecionado no modal
  Quando o usuário clicar em "Executar Diagnóstico"
  Então o sistema deve testar o modelo correspondente e exibir o status HTTP, tempo de resposta em ms e amostra de retorno

Cenário: Ativação do modelo testado
  Dado que o modelo selecionado respondeu com sucesso
  Quando o usuário acionar o botão "Ativar Este Modelo"
  Então a API deve atualizar o modelo para isActive: true e invalidar o cache de inferência
\`\`\`

---

## 🛠️ Entregas Técnicas
1. Endpoint no backend (\`modelController.ts\` / \`systemRoutes.ts\`) para testar um modelo específico por ID ou provedor.
2. Integração do modal de teste em \`dashboard-web/src/pages/AgentsPage.tsx\` com select dinâmico dos modelos, feedback de latência e botão "Ativar Modelo".
`
  }
];

async function main() {
  for (const t of newTasks) {
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
      title: t.title,
      body: t.body
    });

    const itemId = res?.data?.addProjectV2DraftIssue?.projectItem?.id;
    console.log(`Created Draft Issue: ${itemId} - ${t.title}`);

    if (itemId) {
      const updateStatusMutation = `
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
      const statusRes = await requestGraphQL(updateStatusMutation, {
        projectId,
        itemId,
        fieldId: statusFieldId,
        optionId: backlogOptionId
      });
      console.log(`Set ${itemId} to Backlog:`, JSON.stringify(statusRes));
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

