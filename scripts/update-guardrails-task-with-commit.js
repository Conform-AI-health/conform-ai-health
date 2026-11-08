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

const COMMIT_HASH = "refs/heads/feat/issue-guardrails-anti-alucinacao-ia";
const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/issue-guardrails-anti-alucinacao-ia";
const BRANCH = "feat/issue-guardrails-anti-alucinacao-ia";
const draftId = "PVTI_lADOFOE58c4BqQlUzhHB1EI";

const body = `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist / @ai-software-engineer)
**Como:** Auditor Deontológico em Saúde e Responsável Técnico Regulatório  
**Quero:** Um sistema robusto de Guardrails Anti-Alucinação pré e pós-inferência da IA  
**Para:** Garantir que o modelo de linguagem JAMAIS invente resoluções fictícias, não cite artigos inexistentes ou revogados, e não aponte infrações deontológicas sem comprovação fática estrita no conteúdo auditado, assegurando segurança jurídica e fidelidade às resoluções do CFM (ex: 2.336/2023) e LGPD.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Segurança Jurídica & Deontologia CFM:** O CFM veda terminantemente imputações de infrações éticas baseadas em premissas falsas ou normas sem vigência (ex: Res. CFM 1.974/2011 revogada). O guardrail normativo expurga resoluções revogadas e códigos inexistentes.
- **Fidelidade Fática & LGPD:** Exige que qualquer evidência de violação tenha correspondência fática literal ou de alta correlação no conteúdo auditado, mitigando acusações levianas contra clínicas reguladas.
- **Explicabilidade da IA:** O sistema gera métricas públicas de ancoragem (\`groundingScore\` 0-100) e classificação de risco (\`hallucinationRisk\`: NONE, LOW, MEDIUM, HIGH) em cada laudo emitido.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Tentativa de injeção de prompt ou quebra de diretrizes
  Dado que um conteúdo auditado possui comandos maliciosos de injeção de prompt
  Quando o Pre-Execution Guardrails processar o texto
  Então os delimitadores maliciosos e caracteres de controle devem ser neutralizados
  E as diretrizes mandatórias de grounding devem ser preservadas

Cenário: Modelo de IA alucina citação de norma inexistente ou revogada
  Dado que a resposta do LLM acusa infração de norma fictícia ou da Res. CFM 1.974/2011 (revogada)
  Quando o Post-Execution Guardrails auditar a saída
  Então a infração alucinada deve ser sumariamente expurgada
  E o laudo deve recalcular a nota e o veredito matematicamente

Cenário: Modelo de IA forja evidência fática inexistente no site
  Dado que a resposta do LLM alega uma frase acusatória que não existe na página raspada
  Quando o Post-Execution Guardrails executar a verificação fática
  Então a acusação deve ser rejeitada como FABRICATED_EVIDENCE
  E se todas as acusações forem alucinações, o veredito deve ser restaurado para CONFORME com nota 100
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git (Estágio 5)
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Status:** Implementado, 74/74 testes automatizados aprovados (100%), builds frontend/backend verdes e posicionado em In Review no GitHub Project Board #3.`;

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
      title: "[TASK] Guardrails Anti-Alucinação para Integrações de IA (Validação Normativa, Fática e Grounding)",
      body: body
    }
  });
  console.log(`✅ Draft ${draftId} atualizada com rastreabilidade:`, res?.data?.updateProjectV2DraftIssue?.draftIssue?.title);
}

main().catch(err => {
  console.error('❌ Erro ao atualizar draft issue:', err);
  process.exit(1);
});
