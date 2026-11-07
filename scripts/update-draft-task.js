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

const detailedBody = `## 📋 Visão Geral & História de Usuário (P.O. Compliance)

**Épico:** Observabilidade Deontológica e Escalabilidade de Dados  
**Como:** Auditor regulatório ou Administrador do sistema Conform.AI  
**Quero:** Poder testar a conectividade, prontidão e latência do modelo de IA ativo em runtime e navegar pelos dados do MongoDB de forma paginada e veloz  
**Para:** Garantir que as auditorias de conformidade com a **Resolução CFM 2.336/2023** e **LGPD** estejam sempre operacionais e que grandes volumes de dados não degradem a performance ou esgotem a memória da aplicação.

---

### ⚖️ Contexto Regulatório & Deontológico
- **Resolução CFM nº 2.336/2023:** Regula os critérios de publicidade médica. O modelo de IA precisa estar online com prompt calibrado para detectar promessas de resultado, "antes e depois" e ausência de identificação médica (CRM/RQE).
- **LGPD (Lei nº 13.709/2018, Art. 11):** Proteção e governança de dados sensíveis de saúde em canais de captação e formulários.
- **Conformidade ANS & ANVISA:** Garantia de catálogo normativo estruturado e rastreável.

---

### 🧪 Critérios de Aceitação (BDD / Gherkin)

\`\`\`gherkin
Cenário: Teste de conectividade com o modelo de IA ativo
  Dado que o administrador está na página "Módulos de Agente & Auditoria"
  Quando clica no botão "Testar Modelo de IA"
  Então o sistema deve consultar o endpoint POST /api/v1/system/test-ai
  E abrir um modal exibindo o status (ONLINE/DEGRADED/OFFLINE), a latência em ms, o motor/modelo e a amostra de resposta.

Cenário: Paginação com teto de segurança OWASP DoS
  Dado que uma tabela possui mais de 10 registros persistidos no MongoDB
  Quando o usuário navega entre páginas ou ajusta o limite por página
  Então o backend deve calcular o skip e take correspondentes
  E o parâmetro limit nunca deve exceder 100 itens por requisição.
\`\`\`

---

### 🛠️ Arquitetura Técnica & Entregáveis

1. **Botão de Teste & Modal Diagnóstico de IA:**
   - **Backend:** \`ReconciliationEngine.testModelResponse()\` implementado com fallback resiliente (Gemini / Ollama / Heurística) e telemetria de latência.
   - **Endpoint REST:** \`POST /api/v1/system/test-ai\` protegido com autenticação e RBAC (\`Role.ADMIN\`, \`Role.AUDITOR\`).
   - **Frontend:** Atualização de \`AgentsPage.tsx\` com botão estilizado, indicador de carregamento e modal de diagnóstico em tempo real.

2. **Paginação Universal de Banco de Dados:**
   - **Componente React:** Criação de \`dashboard-web/src/components/Pagination.tsx\` com navegação completa (Primeira, Anterior, Numeração com elipses, Próxima, Última) e seletor de itens por página.
   - **Segurança Backend:** Criação de \`dashboard/src/shared/pagination.ts\` (\`getPaginationParams\`, \`buildPaginatedResponse\`) com teto obrigatório (\`maxLimit = 100\`).
   - **Tabelas Integradas:**
     - Módulos de Agente (\`AgentsPage.tsx\`)
     - Instituições Médicas / Clientes (\`ClientsPage.tsx\`)
     - Laudos de Auditoria (\`ReportsPage.tsx\`)
     - Base de Normas Raspadas (\`ScrapingPage.tsx\`)
     - Telemetria de Auditorias (\`LogsTelemetryPage.tsx\`)

---

### 🧪 Evidências de Testes Automatizados (100% Green)

- **Total:** 28 testes automatizados executados e aprovados com 100% de sucesso (\`npm test\`).
- **Backend (23 testes):**
  - \`src/__tests__/tenantIsolation.test.ts\` (4 testes)
  - \`src/__tests__/scraperBatch.test.ts\` (4 testes)
  - \`src/__tests__/taggingAndContext.test.ts\` (3 testes)
  - \`src/__tests__/reconciliation.test.ts\` (2 testes)
  - \`src/__tests__/paginationAndAiTest.test.ts\` (6 testes)
  - \`src/__tests__/apiValidation.test.ts\` (4 testes)
- **Frontend (5 testes):**
  - \`src/__tests__/paginationComponent.test.ts\` (3 testes)
  - \`src/__tests__/taggingAndContext.test.ts\` (2 testes)

---

### 🌿 Rastreabilidade Git & Links

- **Branch Criada:** [\`feat/teste-ia-e-paginacao\`](https://github.com/Conform-AI-health/conform-ai-health/tree/feat/teste-ia-e-paginacao)
- **Commit Realizado:** [\`4cb8d2e\` - feat(agents-pagination): botao de teste de modelo ia e paginacao universal de tabelas](https://github.com/Conform-AI-health/conform-ai-health/commit/4cb8d2e67f7bb106316238b1d9bf5b3644fcfda5)
- **Link do Pull Request:** [Criar Pull Request feat/teste-ia-e-paginacao](https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/teste-ia-e-paginacao)
`;

async function updateTask() {
  const draftIssueId = "DI_lADOFOE58c4BqQlUzgLoHTs";

  const mutation = `
    mutation($input: UpdateProjectV2DraftIssueInput!) {
      updateProjectV2DraftIssue(input: $input) {
        draftIssue {
          id
          title
          body
        }
      }
    }
  `;

  console.log("Atualizando corpo da tarefa com documentação detalhada...");
  const res = await requestGraphQL(mutation, {
    input: {
      draftIssueId,
      body: detailedBody
    }
  });

  console.log("Resultado da atualização:", JSON.stringify(res, null, 2));
}

updateTask().catch(console.error);

