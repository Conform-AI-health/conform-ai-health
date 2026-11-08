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

const COMMIT_HASH = "6bcd4a6";
const COMMIT_URL = `https://github.com/Conform-AI-health/conform-ai-health/commit/${COMMIT_HASH}`;
const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/issue-auth-email-resilience";
const BRANCH = "feat/issue-auth-email-resilience";
const draftId = "PVTI_lADOFOE58c4BqQlUzhHBCSA";

const body = `## 📋 Estágio 1: Product Owner Regulatória & Arquitetura (@compliance-specialist / @security-engineer)
**Como:** Administrador, Auditor Deontológico e Cliente Regulado da plataforma ConformIA  
**Quero:**
1. Expiração do JWT Access Token reduzida estritamente para 1 hora (\`1h\`) com rotação de **Refresh Token** de 7 dias e renovação automática sem interrupção de navegação;
2. Fluxo seguro de **Recuperação de Senha** com geração de token criptográfico temporário de 1h e disparo de e-mail estilizado via **Resend Email API**;
3. Disparo automático de e-mail transacional com o **Laudo Deontológico Concluído** (\`COMPLETED\`) para o endereço cadastrado da clínica médica auditada;
4. Implementação arquitetural dos padrões **Circuit Breaker** (fail-fast e contingência) e **Bulkhead** (isolamento de concorrência e fila) protegendo integrações de IA e scraping.  
**Para:** Blindar a plataforma contra abusos e sequestro de sessão, garantir comunicação tempestiva dos resultados de conformidade deontológica (CFM 2.336/2023) e assegurar alta disponibilidade e estabilidade sob sobrecarga.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Segurança da Informação e LGPD em Saúde:** Tokens com tempo de vida limitado a 1 hora minimizam a janela de exposição em caso de vazamento no cliente. A recuperação de senha via token criptográfico assinado previne invasão de contas clínicas.
- **Transparência Regulatória:** O envio automático do laudo para a clínica garante publicidade tempestiva sobre o índice de conformidade com as resoluções do CFM.
- **Disponibilidade e Resiliência (Bulkhead & Circuit Breaker):** Evita indisponibilidade sistêmica e consumo descontrolado de cotas de APIs terceiras durante falhas transitórias.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Emissão e renovação de tokens JWT
  Dado que um usuário efetua login com credenciais válidas
  Então deve receber um access token com validade de exatamente 1 hora
  E um refresh token criptograficamente assinado com validade de 7 dias
  Quando a rota POST /api/v1/auth/refresh for acionada com o refresh token
  Então um novo par de tokens deve ser emitido e persistido com rotação de segurança

Cenário: Recuperação de credenciais via Resend Email
  Dado que o usuário aciona "Esqueci minha senha" informando seu e-mail
  Então o sistema deve gerar um token temporário com validade de 1 hora
  E disparar um e-mail com o link de recuperação formatado através da API do Resend
  Quando o usuário submeter a nova senha na página /reset-password
  Então a senha deve ser atualizada com bcrypt e o token de recuperação deve ser invalidado

Cenário: Notificação de Laudo Finalizado
  Dado que uma auditoria imediata ou agendada atinge o status COMPLETED
  Então o sistema deve localizar o e-mail da clínica auditada
  E despachar e-mail transacional contendo o score de conformidade, veredito e quantidade de não conformidades

Cenário: Proteção por Circuit Breaker e Bulkhead
  Dado que um downstream (IA ou Scraping) falha repetidamente atingindo o failureThreshold
  Então o Circuit Breaker deve abrir (OPEN) e bloquear novas chamadas imediatamente (fail-fast)
  E o Bulkhead deve rejeitar tarefas que excedam a capacidade máxima de concorrência e fila
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git (Estágio 5)
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** [${COMMIT_HASH}](${COMMIT_URL})
- **PR URL:** [Criar PR no GitHub](${PR_URL})
- **Status:** Implementado, 64/64 testes automatizados aprovados (100%), builds frontend/backend verdes e posicionado em In Review no GitHub Project Board #3.`;

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
      title: "[TASK] Refresh Token (1h), Recuperação de Senha & Notificação de Laudo via Resend, Circuit Breaker e Bulkhead",
      body: body
    }
  });
  console.log(`✅ Draft ${draftId} atualizada com commit:`, res?.data?.updateProjectV2DraftIssue?.draftIssue?.title);
}

main().catch(err => {
  console.error('❌ Erro ao atualizar draft issue:', err);
  process.exit(1);
});
