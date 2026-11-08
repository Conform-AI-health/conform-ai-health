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
  title: 'feat: simplificacao do cockpit, modal de normas na telemetria e auto-tagging REVOGADO',
  head: 'feature/cockpit-telemetria-revogado-normas',
  base: 'main',
  body: `## 📋 Resumo da Demanda (P.O. & Engenharia)

Esta PR atende integralmente à demanda de governança do Cockpit, Observabilidade e Tagging Deontológico, aderindo às regras do \`plan-pipeline.md\`.

### 🎯 Tarefas Atendidas:
- **[TASK 1]** Simplificação do Cockpit do Auditor (\`DashboardPage.tsx\`):
  - Remoção das abas secundárias duplicadas ("Nova auditoria Imediata" e "Últimos Laudos Concluídos").
  - Remoção da frase de subtítulo no header: *"Monitoramento analítico em tempo real de conformidade com a Resolução CFM nº 2.336/2023 e LGPD."*.
  - Redirecionamento da ação rápida para o cockpit de agentes oficial (\`/agents\`).
- **[TASK 2]** Observabilidade & Telemetria de IA (\`LogsTelemetryPage.tsx\`):
  - Na aba "Detalhamento de Tokens e Fontes por Auditoria", o campo de fontes/normas foi transformado em um ícone/botão interativo com contador de normas.
  - Ao clicar, abre um Dialog/Modal acessível e responsivo listando todas as normas/arquivos utilizados com badges de identificação.
- **[TASK 3]** Tagging Deontológico de Normas (\`scraperService.ts\`, \`scrapedPageController.ts\` e \`ScrapingPage.tsx\`):
  - O motor de extração agora detecta automaticamente termos de revogação normativa (\`revogado\`, \`revogada\`, \`revoga-se\`, \`revogação\`, \`revogou\`).
  - Aplica automaticamente a tag \`REVOGADO\` ao documento indexado no MongoDB Atlas.
  - Atualização dos filtros e badges na UI de Scraping.

---

### 🛡️ Conformidade Deontológica & Segurança
- **Segurança Jurídica (CFM / LGPD / ANVISA / ANS):** O flagging de normas revogadas impede a aplicação errônea de resoluções sem vigência durante auditorias automáticas.
- **Explicabilidade da IA:** O modal de fontes assegura transparência total sobre o contexto normativo injetado nas decisões do modelo.

---

### 🧪 Testes e Validação
- **Backend:** Testes em \`taggingAndContext.test.ts\` e \`scraperBatch.test.ts\` 100% verdes.
- **Frontend:** Testes em \`taggingAndContext.test.ts\` 100% verdes.
- **Builds:** \`tsc\` e \`vite build\` executados com zero erros.

---

### 🔗 Rastreabilidade das Tarefas (GitHub Projects #3):
- Task 1: \`PVTI_lADOFOE58c4BqQlUzhG4xX8\`
- Task 2: \`PVTI_lADOFOE58c4BqQlUzhG4xYw\`
- Task 3: \`PVTI_lADOFOE58c4BqQlUzhG4xZs\`
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
