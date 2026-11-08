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

const COMMIT_URL = "https://github.com/Conform-AI-health/conform-ai-health/commit/1824928";
const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feature/cockpit-telemetria-revogado-normas";
const BRANCH = "feature/cockpit-telemetria-revogado-normas";
const draftId = "PVTI_lADOFOE58c4BqQlUzhG5iHY";

const body = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico e Motor de IA do ConformIA  
**Quero:** Que qualquer norma, resolução ou ato normativo indexado que possua a tag 'REVOGADO' seja sumariamente desconsiderado e expurgado da resolução de contexto das auditorias imediatas  
**Para:** Garantir o Princípio da Eficácia Normativa e Segurança Jurídica (CFM / LGPD / ANVISA / ANS), impedindo que normas revogadas continuem alimentando o contexto do modelo de IA e gerando apontamentos indevidos.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Princípio da Legalidade e Vigência Normativa:** Dispositivos deontológicos expressamente revogados (ex: Res. CFM 1.974/2011 superada pela 2.336/2023) não possuem eficácia executiva.
- **Eficiência de Tokens e IA Governance:** Evitar injeção desnecessária de tokens e ruído no prompt do modelo de IA.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Resolução de normas para auditoria imediata
  Dado que existem normas indexadas no banco MongoDB com tags "CFM" e "REVOGADO"
  E existem normas ativas vigentes com tag "CFM"
  Quando o sistema executar o NormsResolver e ReconciliationEngine para um agente com tag "CFM"
  Então as normas contendo a tag "REVOGADO" devem ser expurgadas da lista de normas ativas
  E nenhuma norma revogada deve ser injetada no contexto do modelo de IA
  E a telemetria não deve registrar normas revogadas como fontes ativas de análise
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git (Estágio 5)
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** [${COMMIT_URL}](${COMMIT_URL})
- **Status:** Implementado, testado (100% verde) e posicionado em In Review.`;

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
      title: "[TASK] Desconsiderar Normas Revogadas (Tag REVOGADO) na Análise de Auditoria Imediata",
      body: body
    }
  });
  console.log(`✅ Draft ${draftId} atualizada com commit:`, res?.data?.updateProjectV2DraftIssue?.draftIssue?.title);
}

main().catch(console.error);
