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
  title: 'feat: seguranca docker-compose, contrato estruturado ia, telemetria analitica e taxonomia de agentes',
  head: 'feat/security-telemetry-agents-structure',
  base: 'main',
  body: `## 📋 Resumo da Demanda (Segurança, Contrato Estruturado IA, Telemetria e Reestruturação de Agentes)

Esta PR atende integralmente ao ciclo completo do \`.agents/rules/plan-pipeline.md\`, implementando as 4 atividades fundamentais para conformidade e confiabilidade em regulação de saúde:

---

### 🎯 Entregáveis Implementados:

#### Atividade 1: Análise e Blindagem de Segurança no Docker Compose
- **docker-compose.yml:**
  - Remoção de qualquer fallback fraco ou padrão estático para chaves criptográficas sensíveis (\`JWT_SECRET\`).
  - Isolamento estrito do serviço Redis no host (\`127.0.0.1:6379:6379\`) e autenticação protegida por senha (\`--requirepass \${REDIS_PASSWORD}\`).
  - Prevenção de escalonamento de privilégios com \`security_opt: [no-new-privileges:true]\` em todos os contêineres de aplicação e proxy.
  - Implementação de \`healthcheck\` contínuo para \`dashboard-api\` (\`curl -f http://localhost:3000/api/v1/system/status\`) e \`nginx\` (\`curl -f http://localhost/\`).
  - Limites de recursos (CPU e Memória RAM) em conformidade com as melhores práticas de produção.
- **Auditoria DevSecOps:**
  - Relatório formal e documentado em \`docs/security/docker-compose-security-audit.md\` com matriz de conformidade OWASP / CIS Docker Benchmark.

#### Atividade 2: Contrato de Saída Estruturado de Alta Confiabilidade para IA
- **Schema Zod e Validação:** (\`dashboard/src/shared/aiStructuredContract.ts\`)
  - Contrato formal:
    \`\`\`json
    {
      "audit_id": "AUD-001",
      "risk_level": "HIGH",
      "confidence": 0.94,
      "findings": [
        {
          "description": "Ausência de informação obrigatória",
          "regulation": "CFM",
          "article": "Art. X",
          "evidence": "Trecho da norma",
          "source_version": "2026",
          "recommendation": "Adequar a informação",
          "requires_human_review": true
        }
      ]
    }
    \`\`\`
  - Adaptador bidirecional robusto \`AIStructuredContractAdapter\` conectando a esteira existente ao contrato padronizado.
  - Integração no motor \`ReconciliationEngine.reconcileStructured\`.

#### Atividade 3: Telemetria Analítica Completa de IA
- **Métricas no Backend (\`dashboard/src/controllers/telemetryController.ts\`):**
  - Latência por chamada de LLM: Média, Mínima, Máxima e Percentil 95 (P95).
  - Contabilização precisa de Tokens: Entrada, Saída e Total.
  - Custo Financeiro por Auditoria: Calculado em USD e convertido para BRL.
  - Taxa de Respostas sem Evidências (\`evidenceMissingRate\`).
  - Taxa de Citações Inválidas (\`invalidCitationsRate\`).
  - Taxa de Falhas por Modelo (\`modelFailureRates\`).
  - Taxa de Divergência entre Avaliadores Humanos e IA (\`humanAiDivergenceRate\`).
  - Histórico de Prompts e Versões (\`promptVersionHistory\`).
- **Dashboard Web (\`dashboard-web/src/pages/LogsTelemetryPage.tsx\`):**
  - Cards analíticos com métricas em tempo real, painel de falhas por modelo de IA, tabela de histórico de versões de prompts e custos discriminados em Reais (R$).

#### Atividade 4: Reestruturação da Taxonomia de Agentes e Skills
- **Estrutura \`.agents/\` padronizada:**
  - \`.agents/agents/\`: \`architect.md\`, \`backend-specialist.md\`, \`frontend-specialist.md\`, \`ai-engineer.md\`, \`qa-engineer.md\`, \`security-reviewer.md\`.
  - \`.agents/skills/\`: \`rag-engineering/SKILL.md\`, \`prompt-engineering/SKILL.md\`, \`testing/SKILL.md\`, \`architecture-review/SKILL.md\`.
- **Governança (\`.agents/rules/plan-pipeline.md\`):**
  - Atualizado para sincronizar as responsabilidades dos 5 estágios com os novos agentes e skills.

---

### 🧪 Testes & Quality Gate
- Nova suíte de testes unitários e de integração: \`dashboard/src/__tests__/structuredContractAndTelemetry.test.ts\`.
- **77 testes passando em 13 arquivos de teste (100% verde)** no Backend.
- **8 testes passando em 3 arquivos de teste (100% verde)** no Frontend.
- Builds do TypeScript (\`tsc\`) e Vite sem nenhum aviso ou erro.
- Sincronização e merge limpo concluído com a branch \`main\`.
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
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const parsed = JSON.parse(data);
    if (res.statusCode === 201) {
      console.log('PR Criada com Sucesso!');
      console.log('Número:', parsed.number);
      console.log('URL:', parsed.html_url);
      console.log('Mergeable:', parsed.mergeable);
    } else {
      console.error('Erro ao criar PR:', parsed);
    }
  });
});

req.on('error', (e) => {
  console.error('Erro de requisição:', e.message);
});

req.write(payload);
req.end();
