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

const payload = JSON.stringify({
  title: 'feat: crud de modelos de IA no MongoDB, remoção de catálogo legado, blindagem de login e refatoração com abas',
  head: 'feat/crud-modelos-e-refatoracao-layout',
  base: 'main',
  body: `## 📋 Resumo da Demanda (P.O. & Engenharia)

Esta PR atende integralmente à demanda estruturada em 4 tarefas no GitHub Projects, aderindo estritamente às regras do \`plan-pipeline.md\`.

### 🎯 Tarefas Atendidas:
- **[TASK 1]** Remoção da tela legada de Catálogo Normativo & Deontologia em Saúde (\`/norms\`) da barra de navegação e rotas do frontend.
- **[TASK 2]** Blindagem da tela de login (\`LoginPage.tsx\`), eliminando credenciais oficiais expostas (\`admin@conform.ai\`) e o botão de autofill de demonstração.
- **[TASK 3]** Desacoplamento da seleção de modelos de IA do \`.env\` e migração para MongoDB com CRUD dinâmico (\`AiModelConfig\`), ativação em tempo de execução, mascaramento de credenciais e suporte a Gemini, Ollama e Heurística.
- **[TASK 4]** Refatoração da interface pelo @frontend-engineer, organizando "Módulos de Agente" e "Cockpit Deontológico" em abas responsivas e ergonômicas, eliminando botões flutuantes.

---

### 🛡️ Conformidade e Deontologia em Saúde
- **CFM nº 2.314/2022 & 2.336/2023:** Segregação e auditoria contínua de modelos utilizados em laudos médicos.
- **LGPD (Lei 13.709/2018):** Blindagem da autenticação e proteção de credenciais de infraestrutura de IA.

---

### 🧪 Testes e Validação
- **Backend (\`dashboard\`):** 7/7 suítes aprovadas (29 testes unitários e de integração, incluindo \`modelCrud.test.ts\`).
- **Frontend (\`dashboard-web\`):** 2/2 suítes aprovadas (5 testes).
- **Total:** 34 testes 100% verdes, sem regressões.

---

### 🔗 Rastreabilidade das Tarefas (GitHub Projects #3):
- Task 1: \`PVTI_lADOFOE58c4BqQlUzhGtvLc\`
- Task 2: \`PVTI_lADOFOE58c4BqQlUzhGtvMQ\`
- Task 3: \`PVTI_lADOFOE58c4BqQlUzhGtvNE\`
- Task 4: \`PVTI_lADOFOE58c4BqQlUzhGtvOM\`
`
});

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/Conform-AI-health/conform-ai-health/pulls',
  method: 'POST',
  headers: {
    'User-Agent': 'ConformIA-Bot',
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    try {
      const json = JSON.parse(d);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`✅ Pull Request #${json.number} criado com sucesso!`);
        console.log(`URL: ${json.html_url}`);
      } else {
        console.error('Falha ao criar PR:', json);
      }
    } catch (e) {
      console.error('Erro:', d);
    }
  });
});

req.write(payload);
req.end();

