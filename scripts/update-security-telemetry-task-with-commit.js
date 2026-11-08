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

const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/security-telemetry-agents-structure";
const BRANCH = "feat/security-telemetry-agents-structure";
const draftId = "PVTI_lADOFOE58c4BqQlUzhHCI9Q";

const body = `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist / @architect)
**Como:** DPO, Arquiteto de Software e Auditor Regulatório em Saúde  
**Quero:**
1. Auditoria e blindagem de segurança no \`docker-compose.yml\` (remover fallbacks de segredos em plaintext, isolar portas, restringir privilégios e adicionar healthchecks/limites de recursos);
2. Novo contrato de saída estruturado na integração com a IA com campos de \`audit_id\`, \`risk_level\`, \`confidence\`, \`findings\` e \`requires_human_review\`;
3. Telemetria avançada de IA e observabilidade completa (latência de inferência, tokens entrada/saída, custo em USD/BRL por auditoria, taxa de respostas sem evidências, taxa de citações inválidas, divergência humano vs IA, falhas por modelo e histórico de prompts/versões);
4. Reestruturação do repositório de agentes em \`.agents/agents/\` e \`.agents/skills/\` conforme a taxonomia corporativa solicitada.  
**Para:** Garantir máxima segurança de infraestrutura (OWASP/LGPD), precisão cirúrgica sem dependência de texto livre do LLM em conformidade com as resoluções do CFM (ex: 2.336/2023) e rastreabilidade total do ciclo de vida dos modelos.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Segurança de Infraestrutura e LGPD:** Mitigação de vazamentos de credenciais, blindagem do Redis contra acessos externos não autenticados e prevenção de DoS no host.
- **Confiabilidade Médica Superior:** O modelo de IA não emite pareceres em texto livre sem validação fática e normativa estrita. O contrato estruturado exige versão da norma (\`source_version\`), evidência literal (\`evidence\`) e flag para auditoria humana (\`requires_human_review\`).
- **Transparência e Observabilidade Financeira:** Telemetria com cálculo preciso de custos por token e acompanhamento de taxa de falhas e divergências de julgamento entre humanos e IA.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Blindagem de infraestrutura Docker
  Dado que o docker-compose.yml é analisado
  Então nenhuma chave secreta JWT deve possuir fallback fraco em texto plano
  E a porta do Redis deve estar vinculada estritamente ao loopback 127.0.0.1 com senha
  E todos os serviços devem possuir healthcheck e limites de recursos

Cenário: Reconciliação via Contrato Estruturado
  Dado que a auditoria deontológica é executada
  Então o retorno deve aderir estritamente ao structuredAuditContractSchema
  E cada finding deve conter description, regulation, article, evidence, source_version e requires_human_review

Cenário: Telemetria Analítica Completa
  Dado que o endpoint GET /api/v1/system/telemetry é consultado
  Então deve retornar latência média/P95, custo USD/BRL, taxa sem evidências, taxa de citações inválidas, divergência humano vs IA, falhas por modelo e histórico de prompts
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git (Estágio 5)
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Status:** Implementado, testes automatizados aprovados (100%), builds frontend/backend verdes e posicionado em In Review no GitHub Project Board #3.`;

async function main() {
  const mutation = `
    mutation($input: UpdateProjectV2DraftIssueInput!) {
      updateProjectV2DraftIssue(input: $input) {
        draftIssue {
          id
          title
        }
      }
    }
  `;
  const res = await requestGraphQL(mutation, {
    input: {
      draftIssueId: draftId,
      title: "[EPIC] Blindagem Docker, Contrato Estruturado de IA, Telemetria Avançada & Estrutura .agents",
      body: body
    }
  });
  console.log(`✅ Draft ${draftId} atualizada com rastreabilidade:`, res?.data?.updateProjectV2DraftIssue?.draftIssue?.title);
}

main().catch(err => {
  console.error('❌ Erro ao atualizar draft issue:', err);
  process.exit(1);
});
